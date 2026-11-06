// 配色生成エンジン。層別サンプリング（温度×彩度×調和）で方向性の枠を配分し、
// 印象適合度の下限を守りつつ、最遠点選抜で似た案を避ける。DOM に触れない純粋関数。
// 同じ (moods, usage非依存, mode, seed, page) からは必ず同じ結果になる（rng は seed 由来のみ）。

import {
  ROLES, oklchToHex, hexToOklch, hexToOklab, deltaE, ensureContrast, contrastRatio, hueDiff, AA_NORMAL,
} from './color-utils.js';
import { createRng, mixSeed } from './rng.js';
import { mergeProfile, fitScore, applyHueFamily } from './semantic-model.js';
import { visionIssues } from './vision.js';

export const TEMPS = ['warm', 'cool', 'neutral'];
export const SATS = ['vivid', 'mid', 'muted'];
export const HARMONIES = ['analogous', 'complementary', 'split', 'triad', 'mono'];

export const TEMP_LABEL = { warm: '暖色系', cool: '寒色・緑系', neutral: '無彩色＋差し色' };
export const SAT_LABEL = { vivid: '鮮やか', mid: '中間', muted: 'くすみ・淡め' };
export const HARMONY_LABEL = {
  analogous: '類似色', complementary: '補色', split: '分裂補色', triad: 'トライアド', mono: '単色階調', neutralAccent: '差し色',
};

export const FIT_MIN = 0.8; // 印象適合度の下限（これ未満は採用しない）
const ROLE_WEIGHT = { primary: 0.3, background: 0.25, accent: 0.2, secondary: 0.15, text: 0.1 };
const AREA = { background: 0.6, primary: 0.2, secondary: 0.1, accent: 0.05, text: 0.05 };
export const MIN_DIST_FLOOR = 4.5; // 語彙が狭いときでも、これより近い案は並べない
const PRINT_CHROMA_SCALE = 0.85; // 印刷向け: 再現しにくい高彩度を避ける

const mod360 = (h) => ((h % 360) + 360) % 360;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const tempOfHue = (h) => (mod360(h) < 115 || mod360(h) >= 300 ? 'warm' : 'cool');

/** 全セル（温度×彩度×調和）。neutral は「差し色」調和のみ。 */
export function allCells() {
  const cells = [];
  for (const temp of ['warm', 'cool']) for (const sat of SATS) for (const harm of HARMONIES) cells.push({ temp, sat, harm });
  for (const sat of SATS) cells.push({ temp: 'neutral', sat, harm: 'neutralAccent' });
  return cells;
}

export function cellLabel(c) {
  return `${TEMP_LABEL[c.temp]} × ${SAT_LABEL[c.sat]} × ${HARMONY_LABEL[c.harm]}`;
}

function satRange([lo, hi], sat) {
  const t = (hi - lo) / 3;
  if (sat === 'vivid') return [hi - t, hi];
  if (sat === 'mid') return [lo + t, hi - t];
  return [lo, lo + t];
}

function sampleHue(profile, temp, rng) {
  for (let i = 0; i < 24; i++) {
    let h;
    if (profile.hue.length) {
      const [c, w] = rng.pick(profile.hue);
      h = mod360(c + rng.range(-w, w));
    } else {
      h = mod360(rng.range(-60, 360 - 60)); // 全周
    }
    if (temp === 'neutral' || tempOfHue(h) === temp) return h;
  }
  return null;
}

function bgColor(profile, h, rng, fixedBg) {
  if (fixedBg) return fixedBg;
  // もう一つの地を持つ語（ネオンの白い地）は、その割合だけそちらを使う（その語のときだけ乱数を1つ多く使う）
  const range = profile.bgAlt && rng.range(0, 1) < profile.bgAltShare ? profile.bgAlt : profile.bgL;
  const L = rng.range(range[0], range[1]);
  const [cLo, cHi] = tuningOf(profile.usage).bgC ?? [0.004, 0.018];
  return oklchToHex(L, rng.range(cLo, cHi), h);
}

/** その明度・色相で sRGB に入る最大彩度。色相ごとの「出せる鮮やかさ」の上限。
 * oklchToHex が色域外の彩度を上限まで下げるので、十分大きい彩度を渡して戻り値を測る。 */
export function maxChroma(L, h) {
  return hexToOklch(oklchToHex(L, 0.4, h)).C;
}

/** 明度 lo〜hi のうち、その色相で最も彩度を出せる明度（色域の頂点に近い明度）。
 * 濃い地（ネオン）で、色を蛍光色のように光らせるのに使う。マゼンタ・赤は低め、黄緑・水色は高めになる。 */
export function glowL(h, lo, hi) {
  let best = lo;
  let bc = -1;
  for (let L = lo; L <= hi + 1e-9; L += 0.01) {
    const c = maxChroma(L, h);
    if (c > bc + 1e-4) { bc = c; best = L; }
  }
  return best;
}

// 白い地でも読める濃さのまま鮮やかさを保てる蛍光色の色相（マゼンタ・ピンク・紫・青・赤橙）。
// 黄・ライム・水色・緑の蛍光色は白い地では文字にならないので、面（サブ）で使う。
const GLOW_INK_HUES = [350, 325, 295, 265, 25];
const nearestInkHue = (h) => GLOW_INK_HUES.reduce((best, c) => (hueDiff(h, c) < hueDiff(h, best) ? c : best));

// 黄〜黄緑（OKLCH の色相 80〜125°）は、淡い地で読める濃さまで下げるとオリーブに濁る。
// この色相はメインにせず、淡い面（サブ）で使い、メインは隣の暖色側へずらす。
const isYellowZone = (h) => mod360(h) >= 80 && mod360(h) <= 125;

// 役割ごとの品質の基準（docs/palette-analysis.md §3）。淡い地を前提にする（濃い地の語はネオンだけ。
// コントラスト比は地の明暗によらず同じ基準で見る）
export const QUALITY = {
  primaryOnBg: 3.2, // メインは見出しの大きさで読める濃さ（大きい文字の AA 3:1 に余裕）
  accentOnBg: 2.2, // 差し色は小さな面でも背景から見分けられる
  minPrimarySecondaryDE: 12, // メインとサブははっきり別の色
  minSecondaryBgDL: 0.06, // サブの面が背景に溶けない
  maxVivid: 2, // 高彩度（C>0.16）は2色まで
  textOnSecondary: AA_NORMAL, // サブ（帯・囲みの面）の上の本文も 4.5:1
};

/**
 * 用途ごとの生成の調整（独自に決めた目安値。評価前）。キーは export.js の USAGES と同じ。
 * chroma=主役色の彩度の倍率, bgL/bgC=背景の明度・彩度の範囲（印象語の範囲を置き換える）,
 * sats=使う彩度の枠（省略時はすべて）, primaryOnBg/accentOnBg=背景とのコントラスト比の下限,
 * textOnBg=本文の下限, cud=P型・D型で見分けにくい案を除く。
 */
export const USAGE_TUNING = {
  general: {},
  // カバーは色のついた地で面の印象をつくり、タイトル（メイン）は遠目でも読める濃さに
  'book-cover': { chroma: 1.1, bgL: [0.84, 0.94], bgC: [0.02, 0.05], primaryOnBg: 4.0 },
  // チラシ・ポスターは遠目に目立つ。彩度を上げ、差し色もはっきり
  flyer: { chroma: 1.3, sats: ['vivid', 'mid'], primaryOnBg: 4.0, accentOnBg: 3.0 },
  // 教材・学級通信は淡い紙面・本文 7:1（WCAG AAA の目安）・色覚の多様性に配慮
  'teaching-material': { chroma: 0.8, bgL: [0.96, 0.995], bgC: [0.003, 0.012], textOnBg: 7, cud: true },
  // Web・SNS は差し色をボタン等の部品に使うので、非テキストの 3:1（WCAG 1.4.11）を満たす
  web: { accentOnBg: 3.0 },
};
const tuningOf = (usage) => USAGE_TUNING[usage] ?? USAGE_TUNING.general;

/** 印象語・色の系統・用途から、生成に使うプロファイルを作る */
export function buildProfile(index, moods, { usage = 'general', hue = null } = {}) {
  const t = tuningOf(usage);
  let p = applyHueFamily(mergeProfile(index, moods), hue);
  if (t.chroma) p = { ...p, pC: [p.pC[0] * t.chroma, p.pC[1] * t.chroma] };
  if (t.bgL) p = { ...p, bgL: t.bgL, bgAlt: null };
  return { ...p, usage };
}

/**
 * 配色の品質上の問題を返す（空配列なら合格）。印象の良し悪しではなく、
 * 読みやすさと役割の区別がつくかだけを見る。純粋関数。
 */
export function qualityIssues(c, usage = 'general') {
  const t = tuningOf(usage);
  const o = Object.fromEntries(ROLES.map((r) => [r, hexToOklch(c[r])]));
  const out = [];
  if (contrastRatio(c.primary, c.background) < (t.primaryOnBg ?? QUALITY.primaryOnBg)) out.push('primary-weak');
  if (contrastRatio(c.accent, c.background) < (t.accentOnBg ?? QUALITY.accentOnBg)) out.push('accent-weak');
  if (t.textOnBg && contrastRatio(c.text, c.background) < t.textOnBg) out.push('text-weak');
  if (contrastRatio(c.text, c.secondary) < QUALITY.textOnSecondary) out.push('text-on-secondary-weak');
  if (t.cud && visionIssues(c).some((v) => v.type === 'protan' || v.type === 'deutan')) out.push('cvd-confusable');
  if (deltaE(c.primary, c.secondary) < QUALITY.minPrimarySecondaryDE) out.push('secondary-near-primary');
  if (Math.abs(o.secondary.L - o.background.L) < QUALITY.minSecondaryBgDL) out.push('secondary-near-bg');
  if (['primary', 'secondary', 'accent'].filter((r) => o[r].C > 0.16).length > QUALITY.maxVivid) out.push('too-vivid');
  const muddy = ['primary', 'secondary', 'accent'].filter((r) => o[r].C > 0.03 && o[r].C < 0.075 && o[r].L > 0.42 && o[r].L < 0.72);
  if (muddy.length >= 2) out.push('muddy');
  return out;
}

/**
 * 1セルから1案を作る。fixed={role: hex} の役割は値をそのまま使う（ロック用）。
 * 手順: 背景（淡い地。ネオンは濃い地）→ メイン（色相・彩度は印象から、明度は背景との差を確保）→
 * サブ（淡い面か、メインより暗い締め色）→ 差し色（調和の関係は差し色にだけ効かせ、一番鮮やかに）→ 文字。
 * 印象適合度は「読みやすさの補正をする前の主役色」で評価する（補正は可読性のためで、印象の向きは変えない）。
 * 失敗（その温度で使える色相が無い等）は null。
 */
export function generatePalette(cell, profile, rng, { mode = 'rgb', fixed = {} } = {}) {
  const t = tuningOf(profile.usage);
  const scale = mode === 'print' ? PRINT_CHROMA_SCALE : 1;
  const pC = [profile.pC[0] * scale, profile.pC[1] * scale];
  const fx = fixed.primary ? hexToOklch(fixed.primary) : null;

  let h0;
  if (fx && fx.C > 0.02) h0 = fx.h;
  else h0 = sampleHue(profile, cell.temp === 'neutral' ? 'neutral' : cell.temp, rng);
  if (h0 == null) return null;

  const [cLo, cHi] = satRange(pC, cell.sat);
  let Lp = fx ? fx.L : rng.range(profile.pL[0], profile.pL[1]);
  const Cp = fx ? fx.C : rng.range(cLo, cHi);

  const background = bgColor(profile, h0, rng, fixed.background);
  const bg = hexToOklch(background);
  // 濃い地（ネオン）: 色を明るく光らせ、サブは地より少し明るい暗色の面にする
  const dark = bg.L < 0.5;
  // 濃い地のメインは、その色相で一番鮮やかになる明度の近く（乱数の消費は変えず、引いた明度を小さな揺らぎに使う）
  const span = Math.max(1e-6, profile.pL[1] - profile.pL[0]);
  if (dark && !fx) Lp = glowL(h0, profile.pL[0], profile.pL[1]) - ((Lp - profile.pL[0]) / span) * 0.03;
  const b = rng.pick([-1, 1]);
  const capC = (L, C, h) => Math.min(C, maxChroma(L, h) * 0.92 * scale);

  let primary, secondary, accent, featured;
  // 差し色の色相: 調和の関係はここにだけ使う
  let hA;
  if (cell.harm === 'neutralAccent' || cell.harm === 'mono') hA = h0 + rng.range(-12, 12);
  else if (cell.harm === 'analogous') hA = h0 - b * rng.range(45, 65);
  else if (cell.harm === 'complementary') hA = h0 + 180 + rng.range(-10, 10);
  else if (cell.harm === 'split') hA = h0 + 150 * b + rng.range(-8, 8);
  else hA = h0 - 120 * b; // triad
  // サブの色相: メインと同系（トライアドだけは3つ目の色相を淡い面で使う）
  const hS = cell.harm === 'triad' ? h0 + 120 * b : h0 + b * rng.range(cell.harm === 'mono' ? 0 : 8, cell.harm === 'mono' ? 6 : 28);

  // 白い地のネオン: 蛍光色を「面」か「読める濃さの色」で使う。くすませて読みやすくはしない
  const lightGlow = profile.glow && !dark && !fx;
  const neon = (L, h) => oklchToHex(L, capC(L, 0.4, h), h);

  if (lightGlow) {
    const hInk = nearestInkHue(h0);
    const inkable = hueDiff(h0, hInk) <= 20;
    if (cell.harm !== 'neutralAccent' && inkable && rng.range(0, 1) < 0.6) {
      // 蛍光色の文字: メイン=白地で読めるマゼンタ・青など、サブ=同系の淡い面、差し色=別の読める蛍光色
      const L0 = glowL(h0, 0.5, 0.8);
      primary = neon(L0, h0);
      const sL = clamp(bg.L - rng.range(0.07, 0.13), 0.84, 0.92);
      secondary = oklchToHex(sL, capC(sL, 0.09, hS), hS);
      const hI = nearestInkHue(hA) === hInk ? GLOW_INK_HUES[(GLOW_INK_HUES.indexOf(hInk) + 1) % GLOW_INK_HUES.length] : nearestInkHue(hA);
      accent = neon(glowL(hI, 0.5, 0.8), hI);
      featured = { L: L0, C: hexToOklch(primary).C, h: h0 };
    } else {
      // 黒文字＋蛍光の面: メイン=ほぼ黒、サブ=蛍光色の面（黄・ライムも可）、差し色=読める蛍光色
      primary = oklchToHex(rng.range(0.16, 0.28), rng.range(0.005, 0.03), h0);
      const sL = Math.min(glowL(h0, 0.5, 0.95), bg.L - 0.08);
      secondary = neon(sL, h0);
      const hI = nearestInkHue(hA);
      accent = neon(glowL(hI, 0.5, 0.8), hI);
      featured = { L: sL, C: hexToOklch(secondary).C, h: h0 };
    }
  } else if (cell.harm === 'neutralAccent') {
    // 無彩色寄りの基調に、印象色を差し色として載せる
    const nL = dark ? rng.range(0.85, 0.95) : rng.range(0.28, 0.45);
    primary = fixed.primary ?? oklchToHex(nL, rng.range(0.008, 0.03), h0);
    const sL = dark ? clamp(bg.L + rng.range(0.1, 0.18), 0.22, 0.4) : clamp(bg.L - rng.range(0.12, 0.2), 0.62, 0.86);
    secondary = oklchToHex(sL, rng.range(0.006, 0.025), h0);
    const aL = dark ? Lp : clamp(Lp, 0.5, 0.78);
    accent = oklchToHex(aL, capC(aL, Math.max(Cp, cLo, 0.1), h0), h0);
    featured = { L: Lp, C: Math.max(Cp, cLo), h: h0 };
  } else {
    featured = { L: Lp, C: Cp, h: h0 };
    // 色の系統を指定したときは、その系統の外へはずらさない（黄系だけは、からし色寄りまで小さくずらす）
    // 濃い地では黄〜黄緑も濁らずに光るので、ずらさない
    const yellow = !fx && !dark && isYellowZone(h0) && (!profile.family || profile.family === 'yellow');
    // 黄系: メインは暖色側の隣（橙〜赤み）へずらし、黄は淡い面（サブ）に回す
    const hP = !yellow ? h0 : profile.family === 'yellow' ? h0 - rng.range(15, 25) : h0 - rng.range(35, 55);
    primary = fixed.primary ?? oklchToHex(Lp, capC(Lp, Cp, hP), hP);
    // サブ: 淡い面（帯・囲み）か、メインより暗い締め色。メインの「少し明るい版」は作らない
    if (dark) {
      const sL = clamp(bg.L + rng.range(0.1, 0.18), 0.22, 0.4);
      secondary = oklchToHex(sL, capC(sL, Math.min(0.12, Math.max(0.04, Cp * rng.range(0.3, 0.5))), hS), hS);
    } else if (yellow) {
      const sL = clamp(bg.L - rng.range(0.06, 0.12), 0.82, 0.92);
      secondary = oklchToHex(sL, capC(sL, Math.max(Cp, 0.08), h0), h0);
    } else if (rng.range(0, 1) < 0.7) {
      const sL = clamp(bg.L - rng.range(0.09, 0.17), 0.74, 0.9);
      secondary = oklchToHex(sL, capC(sL, Math.max(0.03, Cp * rng.range(0.35, 0.6)), hS), hS);
    } else {
      // 少し濃い面（中間の明るさで色みをはっきり）。以前はメインより暗い締め色にしていたが、
      // サブは帯・囲みの面に使うので、上の文字が読めず、明るい語の印象も重くなった（docs/eval/2026-11-06-findings.md）
      const sL = clamp(bg.L - rng.range(0.18, 0.26), 0.66, 0.8);
      secondary = oklchToHex(sL, capC(sL, Math.max(0.05, Cp * rng.range(0.6, 0.9)), hS), hS);
    }
    // 差し色: 3色の中で一番鮮やかに（色域の上限まで）。黄系は濃くすると濁るので橙側へ
    if (!dark && isYellowZone(hA)) hA = mod360(hA) - rng.range(25, 40);
    let aL = rng.range(0.6, 0.78);
    // 濃い地の差し色は、その色相で一番鮮やかになる明度（0.5〜0.95）で光らせる
    if (dark) aL = glowL(hA, 0.5, 0.95) - ((aL - 0.6) / 0.18) * 0.03;
    const want = Math.max(Cp * 1.15, (cell.sat === 'muted' ? 0.09 : 0.13) * (t.chroma ?? 1)) * scale;
    accent = oklchToHex(aL, capC(aL, want, hA), hA);
  }
  if (fixed.secondary) secondary = fixed.secondary;

  // メインと差し色を、背景から読み分けられる濃さにする（明度だけを動かす。ロックは触らない）
  if (!fixed.primary) primary = ensureContrast(primary, background, (t.primaryOnBg ?? QUALITY.primaryOnBg) + 0.1);
  accent = fixed.accent ?? ensureContrast(accent, background, (t.accentOnBg ?? QUALITY.accentOnBg) + 0.1);

  let text = fixed.text;
  if (!text) text = ensureContrast(oklchToHex(bg.L > 0.5 ? 0.25 : 0.95, 0.02, h0), background, t.textOnBg ? t.textOnBg + 0.05 : AA_NORMAL);
  // サブは帯・囲みの面なので、その上の本文も読めるように、サブの明度を文字から遠ざける（ロックしたサブは触らない）
  if (!fixed.secondary) {
    secondary = ensureContrast(secondary, text, AA_NORMAL + 0.05);
    // 明るくした結果メインに近づいたら（淡いメインの語。例: 清潔）、淡い面に寄せて別の色にする
    if (bg.L > 0.5 && deltaE(primary, secondary) < QUALITY.minPrimarySecondaryDE + 1) {
      const s = hexToOklch(secondary);
      secondary = ensureContrast(oklchToHex(clamp(bg.L - 0.08, 0.8, 0.92), Math.min(s.C, 0.06), s.h), text, AA_NORMAL + 0.05);
    }
  }

  const fit = fitScore(profile, featured, bg.L);
  return { cell, colors: { primary, secondary, accent, background, text }, fit };
}

/** パレット間距離。役割ごとの色差＋主役色相の差＋面積加重の見た目の差。 */
export function paletteDistance(a, b) {
  let d = 0;
  const ma = [0, 0, 0];
  const mb = [0, 0, 0];
  for (const r of ROLES) {
    const la = hexToOklab(a[r]);
    const lb = hexToOklab(b[r]);
    d += ROLE_WEIGHT[r] * 100 * Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]); // = deltaE
    for (let i = 0; i < 3; i++) { ma[i] += la[i] * AREA[r]; mb[i] += lb[i] * AREA[r]; }
  }
  const ha = hexToOklch(a.primary);
  const hb = hexToOklch(b.primary);
  if (ha.C > 0.03 && hb.C > 0.03 && hueDiff(ha.h, hb.h) > 30) d += 8;
  d += 0.5 * 100 * Math.hypot(ma[0] - mb[0], ma[1] - mb[1], ma[2] - mb[2]);
  return d;
}

const minDistTo = (colors, list) => (list.length ? Math.min(...list.map((p) => paletteDistance(colors, p))) : Infinity);

/** 温度ごとの枠配分（暖:寒:無彩 ≒ 5:5:2）。使えない温度の枠は残りへ回す。 */
function quotaByTemp(total, temps) {
  const w = { warm: 5, cool: 5, neutral: 2 };
  const sum = temps.reduce((s, t) => s + w[t], 0);
  const q = Object.fromEntries(temps.map((t) => [t, Math.floor((total * w[t]) / sum)]));
  let rest = total - Object.values(q).reduce((s, n) => s + n, 0);
  for (let i = 0; rest > 0; i++, rest--) q[temps[i % temps.length]]++;
  return q;
}

// 調和ごとの出やすさ。トライアドは3色相が散って派手になりやすく、しかも最遠点選抜で選ばれやすいため
// 全調和の中で最も多く出ていた（30語×2seed で約22%）。試す順を後ろに寄せ、1ページあたりの上限も設ける。
export const HARMONY_WEIGHT = { analogous: 1, complementary: 1, split: 1, triad: 0.35, mono: 1, neutralAccent: 1 };
export const HARMONY_MAX_SHARE = { triad: 0.08 }; // 24案なら2案まで。他で埋まらないときだけ上限を外す

/** 調和の重み。印象語が指定した調和（例: カラフル）は語の値で置き換える */
const harmWeight = (profile, harm) => profile.harm?.[harm] ?? HARMONY_WEIGHT[harm] ?? 1;

/** 重み付きの並べ替え（重みが小さいほど後ろに来やすい。Efraimidis–Spirakis の鍵 u^(1/w)） */
function weightedOrder(cells, rng, profile) {
  return cells
    .map((c) => ({ c, k: rng.next() ** (1 / harmWeight(profile, c.harm)) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.c);
}

/** 彩度→調和の順に交互に並べ、連続する枠が似た系統にならないようにする */
function interleave(cells, rng, profile) {
  const bySat = Object.fromEntries(SATS.map((s) => [s, weightedOrder(cells.filter((c) => c.sat === s), rng, profile)]));
  const out = [];
  while (SATS.some((s) => bySat[s].length)) {
    for (const s of SATS) if (bySat[s].length) out.push(bySat[s].shift());
  }
  return out;
}

const makeId = (seed, page, n) => `p${seed.toString(36)}-${page}-${n}`;

/**
 * 「幅広く探す」。count 案を返す。exclude に既存案を渡すと、それらと十分離れた案だけを返す。
 * @returns {Array<{id,seed,cell,label,colors,fit}>}
 */
export function generateWide({ index, moods, mode = 'rgb', usage = 'general', hue = null, seed, page = 0, count = 24, exclude = [] }) {
  const profile = buildProfile(index, moods, { usage, hue });
  const rng = createRng(mixSeed(seed, page, 7919));
  const sats = tuningOf(usage).sats;
  const cells = sats ? allCells().filter((c) => sats.includes(c.sat)) : allCells();
  // その印象語で作れる温度を探る（色相窓が一方の温度に偏る語がある）
  const probe = createRng(mixSeed(seed, 1));
  const eligibleTemps = TEMPS.filter((t) => cells.filter((c) => c.temp === t).some((c) => {
    for (let i = 0; i < 8; i++) {
      const p = generatePalette(c, profile, probe, { mode });
      if (p && p.fit >= FIT_MIN) return true;
    }
    return false;
  }));
  if (!eligibleTemps.length) return [];
  const quota = quotaByTemp(count, eligibleTemps);
  const queues = Object.fromEntries(eligibleTemps.map((t) => [t, interleave(cells.filter((c) => c.temp === t), rng, profile)]));

  const chosen = [];
  const existing = exclude.map((p) => p.colors ?? p);
  let minDist = 14;
  const slots = [];
  const taken = Object.fromEntries(eligibleTemps.map((t) => [t, 0]));
  // 温度を交互に並べた枠順
  while (slots.length < count) {
    let progressed = false;
    for (const t of eligibleTemps) {
      if (taken[t] < quota[t] && slots.length < count) {
        slots.push(t);
        taken[t]++;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  const cursor = Object.fromEntries(eligibleTemps.map((t) => [t, 0]));
  // 印象語が調和を指定した場合（カラフル等）は、その調和の上限を外す
  const harmMax = Object.fromEntries(Object.entries(HARMONY_MAX_SHARE).filter(([h]) => profile.harm?.[h] == null).map(([h, r]) => [h, Math.round(count * r)]));
  let capOn = true;
  const capped = (harm) => capOn && harm in harmMax && chosen.filter((c) => c.cell.harm === harm).length >= harmMax[harm];
  const tryPlace = (t) => {
    for (let attempt = 0; attempt < queues[t].length; attempt++) {
      const cell = queues[t][cursor[t]++ % queues[t].length];
      if (capped(cell.harm)) continue;
      const pool = [];
      for (let k = 0; k < 12; k++) {
        const p = generatePalette(cell, profile, rng, { mode });
        if (p && p.fit >= FIT_MIN && !qualityIssues(p.colors, usage).length) pool.push(p);
      }
      const all = [...existing, ...chosen.map((c) => c.colors)];
      // 最遠点選抜: 既存全案から最も離れた候補を採る
      let best = null;
      let bestD = -1;
      for (const p of pool) {
        const d = minDistTo(p.colors, all);
        if (d > bestD) { best = p; bestD = d; }
      }
      if (best && bestD >= minDist) {
        chosen.push({
          id: makeId(seed, page, chosen.length), seed, cell: best.cell, label: cellLabel(best.cell), colors: best.colors, fit: best.fit,
        });
        return true;
      }
    }
    return false;
  };

  for (const t of slots) tryPlace(t);
  // 枠が埋まらなければ、距離の閾値を段階的に緩めて（下限 4.5）温度を交互に補充する
  for (let pass = 0; chosen.length < count && pass < 12; pass++) {
    minDist = Math.max(MIN_DIST_FLOOR, minDist * 0.85);
    for (const t of eligibleTemps) if (chosen.length < count) tryPlace(t);
  }
  // それでも足りなければ、調和の上限を外して埋める（案数を優先）
  capOn = false;
  for (let pass = 0; chosen.length < count && pass < 4; pass++) {
    for (const t of eligibleTemps) if (chosen.length < count) tryPlace(t);
  }
  return chosen;
}

/** 「この系統を深掘り」。基準案と同じセルで、近傍だけを小刻みに変える。 */
export function generateDeep({ index, moods, mode = 'rgb', usage = 'general', hue = null, seed, base, count = 12, page = 0, exclude = [] }) {
  const rng = createRng(mixSeed(seed, page, 104729));
  const profile = buildProfile(index, moods, { usage, hue });
  const textTarget = tuningOf(usage).textOnBg ?? AA_NORMAL;
  const o = Object.fromEntries(['primary', 'secondary', 'accent'].map((r) => [r, hexToOklch(base.colors[r])]));
  const bg = hexToOklch(base.colors.background);
  const maxD = 14; // 幅広い探索の最小距離(6〜14)より近い範囲に収める
  const minD = 3;
  const pool = [];
  for (let i = 0; i < 80; i++) {
    const col = {};
    for (const r of ['primary', 'secondary', 'accent']) {
      col[r] = oklchToHex(
        clamp(o[r].L + rng.range(-0.07, 0.07), 0.1, 0.97),
        Math.max(0, o[r].C + rng.range(-0.05, 0.05)),
        o[r].h + rng.range(-20, 20),
      );
    }
    col.background = oklchToHex(clamp(bg.L + rng.range(-0.015, 0.015), 0.05, 0.995), bg.C, bg.h);
    col.text = ensureContrast(base.colors.text, col.background, textTarget);
    const d = paletteDistance(col, base.colors);
    if (d < minD || d > maxD || qualityIssues(col, usage).length) continue;
    const fit = fitScore(profile, base.cell.harm === 'neutralAccent' ? hexToOklch(col.accent) : hexToOklch(col.primary), hexToOklch(col.background).L);
    pool.push({ colors: col, fit });
  }
  const chosen = [];
  const all = () => [base.colors, ...exclude.map((p) => p.colors ?? p), ...chosen.map((c) => c.colors)];
  while (chosen.length < count && pool.length) {
    let bi = -1;
    let bd = -1;
    pool.forEach((p, i) => {
      const d = minDistTo(p.colors, all());
      if (d > bd) { bd = d; bi = i; }
    });
    if (bd < 2) break;
    const [p] = pool.splice(bi, 1);
    chosen.push({
      id: makeId(seed, 1000 + page, chosen.length), seed, cell: base.cell, label: cellLabel(base.cell) + '（深掘り）', colors: p.colors, fit: p.fit,
    });
  }
  return chosen;
}

/**
 * ロック以外を再提案する。locked に含まれる役割の HEX は 1 桁も変えない。
 * 現在の値と十分違う案を優先する（変化が見えないと「再提案」にならない）。
 */
export function reproposeUnlocked({ index, moods, mode = 'rgb', usage = 'general', hue = null, seed, current, locks = [] }) {
  const profile = buildProfile(index, moods, { usage, hue });
  const rng = createRng(mixSeed(seed, 31337));
  const fixed = Object.fromEntries(locks.filter((r) => ROLES.includes(r)).map((r) => [r, current.colors[r]]));
  const unlocked = ROLES.filter((r) => !fixed[r]);
  if (!unlocked.length) return { ...current, colors: { ...current.colors } };
  let best = null;
  let bestD = -1;
  for (let i = 0; i < 30; i++) {
    const p = generatePalette(current.cell, profile, rng, { mode, fixed });
    if (!p) continue;
    // 念のため: ロック色を最終的に上書きして不変を保証する
    for (const r of Object.keys(fixed)) p.colors[r] = fixed[r];
    if (!fixed.text) p.colors.text = ensureContrast(p.colors.text, p.colors.background, tuningOf(usage).textOnBg ?? AA_NORMAL);
    const d = unlocked.reduce((s, r) => s + deltaE(p.colors[r], current.colors[r]), 0);
    const score = d + (p.fit >= FIT_MIN ? 100 : 0);
    if (score > bestD) { bestD = score; best = p; }
  }
  if (!best) return { ...current, colors: { ...current.colors } };
  return { ...current, colors: best.colors, fit: best.fit };
}

/** 文字と背景のコントラスト情報 */
export function contrastInfo(colors) {
  const ratio = contrastRatio(colors.text, colors.background);
  return { ratio, passAA: ratio >= AA_NORMAL };
}

/** text が背景に対して AA を満たす近い色を提案する（強制はしない） */
export function suggestTextFix(colors) {
  return ensureContrast(colors.text, colors.background, AA_NORMAL);
}
