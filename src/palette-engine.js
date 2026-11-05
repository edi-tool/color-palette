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
  return oklchToHex(L, rng.range(0.004, 0.022), h);
}

/**
 * 1セルから1案を作る。fixed={role: hex} の役割は値をそのまま使う（ロック用）。
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

  const b = rng.pick([-1, 1]);
  let primary, secondary, accent, featured;
  const sec = (hue, dL, kC) => oklchToHex(clamp(Lp + dL, 0.15, 0.95), Cp * kC, hue);

  if (cell.harm === 'neutralAccent') {
    // 無彩色寄りの基調に、印象色を差し色として載せる
    const nL = rng.range(0.28, 0.45);
    primary = oklchToHex(nL, rng.range(0.01, 0.035), h0);
    secondary = oklchToHex(clamp(nL + rng.range(0.2, 0.3), 0.5, 0.8), rng.range(0.008, 0.03), h0);
    const aL = rng.range(profile.pL[0], profile.pL[1]);
    accent = oklchToHex(aL, Math.max(Cp, cLo), h0);
    featured = { L: aL, C: Math.max(Cp, cLo), h: h0 };
    primary = fixed.primary ?? primary;
  } else {
    primary = fixed.primary ?? oklchToHex(Lp, Cp, h0);
    featured = { L: Lp, C: Cp, h: h0 };
    const accC = clamp(Cp * 1.15 + 0.03, 0.08, Math.max(0.13, pC[1] + 0.04)) * scale;
    const accL = clamp(rng.range(0.66, 0.84), 0.5, 0.9);
    if (cell.harm === 'analogous') {
      secondary = sec(h0 + b * rng.range(22, 36), rng.range(0.08, 0.18), 0.75);
      accent = oklchToHex(accL, accC, h0 - b * rng.range(50, 70));
    } else if (cell.harm === 'complementary') {
      secondary = sec(h0 + b * rng.range(15, 30), rng.range(0.08, 0.18), 0.6);
      accent = oklchToHex(accL, accC, h0 + 180 + rng.range(-8, 8));
    } else if (cell.harm === 'split') {
      secondary = sec(h0 - b * rng.range(25, 35), rng.range(0.08, 0.18), 0.7);
      accent = oklchToHex(accL, accC, h0 + 150 * b + rng.range(-6, 6));
    } else if (cell.harm === 'triad') {
      secondary = sec(h0 + 120 * b, rng.range(0.06, 0.16), 0.7);
      accent = oklchToHex(accL, accC, h0 - 120 * b);
    } else {
      // mono: 同系色の明度違い＋同系の差し色
      secondary = sec(h0 + rng.range(-8, 8), rng.range(0.14, 0.24) * (Lp > 0.6 ? -1 : 1), 0.6);
      accent = oklchToHex(accL, accC, h0 + rng.range(-14, 14));
    }
  }
  if (fixed.secondary) secondary = fixed.secondary;
  if (fixed.accent) accent = fixed.accent;

  const background = bgColor(profile, h0, rng, fixed.background);
  const bgL = hexToOklch(background).L;
  let text = fixed.text;
  if (!text) {
    text = ensureContrast(oklchToHex(bgL > 0.5 ? 0.27 : 0.95, 0.02, h0), background, AA_NORMAL);
  }
  // 主役色が背景に埋もれないようにする（ロック時は触らない）
  if (!fixed.primary && Math.abs(hexToOklch(primary).L - bgL) < 0.25) {
    const L2 = bgL > 0.5 ? Math.min(Lp, bgL - 0.28) : Math.max(Lp, bgL + 0.28);
    primary = oklchToHex(L2, cell.harm === 'neutralAccent' ? 0.02 : Cp, h0);
  }

  const fit = fitScore(profile, featured, bgL);
  return { cell, colors: { primary, secondary, accent, background, text }, fit };
}

/** パレット間距離。役割ごとの色差＋主役色相の差＋面積加重の見た目の差。 */
export function paletteDistance(a, b) {
  let d = 0;
  for (const r of ROLES) d += ROLE_WEIGHT[r] * deltaE(a[r], b[r]);
  const ha = hexToOklch(a.primary);
  const hb = hexToOklch(b.primary);
  if (ha.C > 0.03 && hb.C > 0.03 && hueDiff(ha.h, hb.h) > 30) d += 8;
  const mix = (p) => {
    const v = [0, 0, 0];
    for (const r of ROLES) hexToOklab(p[r]).forEach((x, i) => (v[i] += x * AREA[r]));
    return v;
  };
  const ma = mix(a);
  const mb = mix(b);
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

/** 彩度→調和の順に交互に並べ、連続する枠が似た系統にならないようにする */
function interleave(cells, rng) {
  const bySat = Object.fromEntries(SATS.map((s) => [s, rng.shuffle(cells.filter((c) => c.sat === s))]));
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
  const tryPlace = (t) => {
    for (let attempt = 0; attempt < queues[t].length; attempt++) {
      const cell = queues[t][cursor[t]++ % queues[t].length];
      const pool = [];
      for (let k = 0; k < 12; k++) {
        const p = generatePalette(cell, profile, rng, { mode });
        if (p && p.fit >= FIT_MIN) pool.push(p);
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
    if (d < minD || d > maxD) continue;
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
