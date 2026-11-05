// 配色生成エンジン。層別サンプリング（温度×彩度×調和）で方向性の枠を配分し、
// 印象適合度の下限を守りつつ、最遠点選抜で似た案を避ける。DOM に触れない純粋関数。
// 同じ (moods, usage非依存, mode, seed, page) からは必ず同じ結果になる（rng は seed 由来のみ）。

import {
  ROLES, oklchToHex, hexToOklch, hexToOklab, deltaE, ensureContrast, contrastRatio, hueDiff, AA_NORMAL,
} from './color-utils.js';
import { createRng, mixSeed } from './rng.js';
import { mergeProfile, fitScore } from './semantic-model.js';

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
  const L = rng.range(profile.bgL[0], profile.bgL[1]);
  return oklchToHex(L, rng.range(0.004, 0.018), h);
}

/** その明度・色相で sRGB に入る最大彩度。色相ごとの「出せる鮮やかさ」の上限。
 * oklchToHex が色域外の彩度を上限まで下げるので、十分大きい彩度を渡して戻り値を測る。 */
export function maxChroma(L, h) {
  return hexToOklch(oklchToHex(L, 0.4, h)).C;
}

// 黄〜黄緑（OKLCH の色相 80〜125°）は、淡い地で読める濃さまで下げるとオリーブに濁る。
// この色相はメインにせず、淡い面（サブ）で使い、メインは隣の暖色側へずらす。
const isYellowZone = (h) => mod360(h) >= 80 && mod360(h) <= 125;

// 役割ごとの品質の基準（docs/palette-analysis.md §3）。淡い地を前提にする（語彙の背景はすべて明るい）
export const QUALITY = {
  primaryOnBg: 3.2, // メインは見出しの大きさで読める濃さ（大きい文字の AA 3:1 に余裕）
  accentOnBg: 2.2, // 差し色は小さな面でも背景から見分けられる
  minPrimarySecondaryDE: 12, // メインとサブははっきり別の色
  minSecondaryBgDL: 0.06, // サブの面が背景に溶けない
  maxVivid: 2, // 高彩度（C>0.16）は2色まで
};

/**
 * 配色の品質上の問題を返す（空配列なら合格）。印象の良し悪しではなく、
 * 読みやすさと役割の区別がつくかだけを見る。純粋関数。
 */
export function qualityIssues(c) {
  const o = Object.fromEntries(ROLES.map((r) => [r, hexToOklch(c[r])]));
  const out = [];
  if (contrastRatio(c.primary, c.background) < QUALITY.primaryOnBg) out.push('primary-weak');
  if (contrastRatio(c.accent, c.background) < QUALITY.accentOnBg) out.push('accent-weak');
  if (deltaE(c.primary, c.secondary) < QUALITY.minPrimarySecondaryDE) out.push('secondary-near-primary');
  if (Math.abs(o.secondary.L - o.background.L) < QUALITY.minSecondaryBgDL) out.push('secondary-near-bg');
  if (['primary', 'secondary', 'accent'].filter((r) => o[r].C > 0.16).length > QUALITY.maxVivid) out.push('too-vivid');
  const muddy = ['primary', 'secondary', 'accent'].filter((r) => o[r].C > 0.03 && o[r].C < 0.075 && o[r].L > 0.42 && o[r].L < 0.72);
  if (muddy.length >= 2) out.push('muddy');
  return out;
}

/**
 * 1セルから1案を作る。fixed={role: hex} の役割は値をそのまま使う（ロック用）。
 * 手順: 背景（淡い地）→ メイン（色相・彩度は印象から、明度は背景との差を確保）→
 * サブ（淡い面か、メインより暗い締め色）→ 差し色（調和の関係は差し色にだけ効かせ、一番鮮やかに）→ 文字。
 * 印象適合度は「読みやすさの補正をする前の主役色」で評価する（補正は可読性のためで、印象の向きは変えない）。
 * 失敗（その温度で使える色相が無い等）は null。
 */
export function generatePalette(cell, profile, rng, { mode = 'rgb', fixed = {} } = {}) {
  const scale = mode === 'print' ? PRINT_CHROMA_SCALE : 1;
  const pC = [profile.pC[0] * scale, profile.pC[1] * scale];
  const fx = fixed.primary ? hexToOklch(fixed.primary) : null;

  let h0;
  if (fx && fx.C > 0.02) h0 = fx.h;
  else h0 = sampleHue(profile, cell.temp === 'neutral' ? 'neutral' : cell.temp, rng);
  if (h0 == null) return null;

  const [cLo, cHi] = satRange(pC, cell.sat);
  const Lp = fx ? fx.L : rng.range(profile.pL[0], profile.pL[1]);
  const Cp = fx ? fx.C : rng.range(cLo, cHi);

  const background = bgColor(profile, h0, rng, fixed.background);
  const bg = hexToOklch(background);
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

  if (cell.harm === 'neutralAccent') {
    // 無彩色寄りの基調に、印象色を差し色として載せる
    const nL = rng.range(0.28, 0.45);
    primary = fixed.primary ?? oklchToHex(nL, rng.range(0.008, 0.03), h0);
    secondary = oklchToHex(clamp(bg.L - rng.range(0.12, 0.2), 0.62, 0.86), rng.range(0.006, 0.025), h0);
    const aL = clamp(Lp, 0.5, 0.78);
    accent = oklchToHex(aL, capC(aL, Math.max(Cp, cLo, 0.1), h0), h0);
    featured = { L: Lp, C: Math.max(Cp, cLo), h: h0 };
  } else {
    featured = { L: Lp, C: Cp, h: h0 };
    const yellow = !fx && isYellowZone(h0);
    // 黄系: メインは暖色側の隣（橙〜赤み）へずらし、黄は淡い面（サブ）に回す
    const hP = yellow ? h0 - rng.range(35, 55) : h0;
    primary = fixed.primary ?? oklchToHex(Lp, capC(Lp, Cp, hP), hP);
    // サブ: 淡い面（帯・囲み）か、メインより暗い締め色。メインの「少し明るい版」は作らない
    if (yellow) {
      const sL = clamp(bg.L - rng.range(0.06, 0.12), 0.82, 0.92);
      secondary = oklchToHex(sL, capC(sL, Math.max(Cp, 0.08), h0), h0);
    } else if (rng.range(0, 1) < 0.7) {
      const sL = clamp(bg.L - rng.range(0.09, 0.17), 0.74, 0.9);
      secondary = oklchToHex(sL, capC(sL, Math.max(0.03, Cp * rng.range(0.35, 0.6)), hS), hS);
    } else {
      const pLnow = hexToOklch(primary).L;
      const sL = clamp(Math.min(pLnow, 0.55) - rng.range(0.12, 0.18), 0.3, 0.45);
      secondary = oklchToHex(sL, capC(sL, Math.max(0.05, Cp * rng.range(0.6, 0.9)), hS), hS);
    }
    // 差し色: 3色の中で一番鮮やかに（色域の上限まで）。黄系は濃くすると濁るので橙側へ
    if (isYellowZone(hA)) hA = mod360(hA) - rng.range(25, 40);
    const aL = rng.range(0.6, 0.78);
    const want = Math.max(Cp * 1.15, cell.sat === 'muted' ? 0.09 : 0.13) * scale;
    accent = oklchToHex(aL, capC(aL, want, hA), hA);
  }
  if (fixed.secondary) secondary = fixed.secondary;

  // メインと差し色を、背景から読み分けられる濃さにする（明度だけを動かす。ロックは触らない）
  if (!fixed.primary) primary = ensureContrast(primary, background, QUALITY.primaryOnBg + 0.1);
  accent = fixed.accent ?? ensureContrast(accent, background, QUALITY.accentOnBg + 0.1);

  let text = fixed.text;
  if (!text) text = ensureContrast(oklchToHex(bg.L > 0.5 ? 0.25 : 0.95, 0.02, h0), background, AA_NORMAL);

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

/** 重み付きの並べ替え（重みが小さいほど後ろに来やすい。Efraimidis–Spirakis の鍵 u^(1/w)） */
function weightedOrder(cells, rng) {
  return cells
    .map((c) => ({ c, k: rng.next() ** (1 / (HARMONY_WEIGHT[c.harm] ?? 1)) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.c);
}

/** 彩度→調和の順に交互に並べ、連続する枠が似た系統にならないようにする */
function interleave(cells, rng) {
  const bySat = Object.fromEntries(SATS.map((s) => [s, weightedOrder(cells.filter((c) => c.sat === s), rng)]));
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
export function generateWide({ index, moods, mode = 'rgb', seed, page = 0, count = 24, exclude = [] }) {
  const profile = mergeProfile(index, moods);
  const rng = createRng(mixSeed(seed, page, 7919));
  const cells = allCells();
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
  const queues = Object.fromEntries(eligibleTemps.map((t) => [t, interleave(cells.filter((c) => c.temp === t), rng)]));

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
  const harmMax = Object.fromEntries(Object.entries(HARMONY_MAX_SHARE).map(([h, r]) => [h, Math.round(count * r)]));
  let capOn = true;
  const capped = (harm) => capOn && harm in harmMax && chosen.filter((c) => c.cell.harm === harm).length >= harmMax[harm];
  const tryPlace = (t) => {
    for (let attempt = 0; attempt < queues[t].length; attempt++) {
      const cell = queues[t][cursor[t]++ % queues[t].length];
      if (capped(cell.harm)) continue;
      const pool = [];
      for (let k = 0; k < 12; k++) {
        const p = generatePalette(cell, profile, rng, { mode });
        if (p && p.fit >= FIT_MIN && !qualityIssues(p.colors).length) pool.push(p);
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
export function generateDeep({ index, moods, mode = 'rgb', seed, base, count = 12, page = 0, exclude = [] }) {
  const rng = createRng(mixSeed(seed, page, 104729));
  const profile = mergeProfile(index, moods);
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
    col.text = ensureContrast(base.colors.text, col.background, AA_NORMAL);
    const d = paletteDistance(col, base.colors);
    if (d < minD || d > maxD || qualityIssues(col).length) continue;
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
export function reproposeUnlocked({ index, moods, mode = 'rgb', seed, current, locks = [] }) {
  const profile = mergeProfile(index, moods);
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
    if (!fixed.text) p.colors.text = ensureContrast(p.colors.text, p.colors.background, AA_NORMAL);
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
