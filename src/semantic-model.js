// 語彙（印象語）モデル。語→色の1対1対応はせず、色の「範囲」と重みで表現する。
// 辞書データ（vocab.json）は呼び出し側が読み込んで渡す（ブラウザは fetch、テストは fs）。

import { hueDiff } from './color-utils.js';

export const MAX_MOODS = 3;

/** 全角・半角、カタカナ・ひらがな、大小文字の違いを吸収する検索用キー */
export function toKey(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 語彙辞書（と任意でシード配色 src/seeds.json）から検索用のインデックスを作る */
export function buildIndex(vocab, seedData = null) {
  const words = vocab.words;
  const lookup = new Map();
  for (const [name, def] of Object.entries(words)) {
    lookup.set(toKey(name), name);
    for (const s of def.syn ?? []) if (!lookup.has(toKey(s))) lookup.set(toKey(s), name);
  }
  const ROLE_ORDER = ['primary', 'secondary', 'accent', 'background', 'text'];
  const seeds = (seedData?.seeds ?? [])
    .filter((x) => x.words.some((w) => w in words))
    .map((x) => ({ ...x, colors: Object.fromEntries(ROLE_ORDER.map((r, i) => [r, x.c[i]])) }));
  return { words, lookup, names: Object.keys(words), seeds };
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/**
 * 入力語を辞書の語に解決する。
 * 一致すれば {word}。一致しなければ word=null で近い候補（最大3）を返し、勝手に採用しない。
 */
export function resolveTerm(index, input) {
  const key = toKey(input);
  if (!key) return { word: null, suggestions: [] };
  const hit = index.lookup.get(key);
  if (hit) return { word: hit, suggestions: [] };
  const scored = new Map();
  for (const [k, name] of index.lookup) {
    let score = null;
    if (k.includes(key) || key.includes(k)) score = 0.5 + Math.abs(k.length - key.length) * 0.1;
    else {
      const d = editDistance(key, k);
      if (d <= 2 && d < Math.max(key.length, k.length)) score = d;
    }
    if (score != null && (!scored.has(name) || scored.get(name) > score)) scored.set(name, score);
  }
  const suggestions = [...scored].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([n]) => n);
  return { word: null, suggestions };
}

function mergeRange(ranges) {
  const lo = Math.max(...ranges.map((r) => r[0]));
  const hi = Math.min(...ranges.map((r) => r[1]));
  if (lo <= hi) return [lo, hi];
  // 積集合が空なら、各範囲の中心の平均を中心に、平均幅で取り直す
  const center = ranges.reduce((s, r) => s + (r[0] + r[1]) / 2, 0) / ranges.length;
  const half = ranges.reduce((s, r) => s + (r[1] - r[0]) / 2, 0) / ranges.length;
  return [Math.max(0, center - half), center + half];
}

// 濃い地（背景の明度の上限が 0.5 未満。例: ネオン）を指定した語があるときは、淡い地の語と平均せずに
// 濃い地を採る。平均すると明度 0.5 前後の灰色の地になり、どちらの印象にもならないため。
function mergeBg(ranges) {
  const dark = ranges.filter((r) => r[1] < 0.5);
  return mergeRange(dark.length && dark.length < ranges.length ? dark : ranges);
}

/** 複数の語を1つの「許容範囲プロファイル」に合成する（最大3語） */
export function mergeProfile(index, moodNames) {
  const defs = moodNames.slice(0, MAX_MOODS).map((m) => {
    const d = index.words[m];
    if (!d) throw new Error(`辞書にない語: ${m}`);
    return d;
  });
  if (!defs.length) throw new Error('印象語が選ばれていません');
  // 調和の出やすさの上書き（語が指定したものだけ。複数語が同じ調和を指定したら平均）
  const harm = {};
  for (const d of defs) for (const [h, w] of Object.entries(d.harm ?? {})) (harm[h] ??= []).push(w);
  return {
    moods: moodNames.slice(0, MAX_MOODS),
    pL: mergeRange(defs.map((d) => d.pL)),
    pC: mergeRange(defs.map((d) => d.pC)),
    bgL: mergeBg(defs.map((d) => d.bgL)),
    hue: defs.flatMap((d) => d.hue),
    glow: defs.some((d) => d.glow),
    // もう一つの地（例: ネオンの白い地）。最初にそれを持つ語の値を使う
    bgAlt: defs.find((d) => d.bgAlt)?.bgAlt ?? null,
    bgAltShare: defs.find((d) => d.bgAlt)?.bgAltShare ?? 0,
    harm: Object.fromEntries(Object.entries(harm).map(([h, ws]) => [h, ws.reduce((a, b) => a + b, 0) / ws.length])),
  };
}

/**
 * 色の系統（任意）。メインの色相を、印象語の色相窓の代わりにこの範囲へ絞る（ユーザーの明示指定を優先）。
 * 色相は OKLCH。茶系は色相だけでは決まらないので、明度・彩度の範囲も持つ。独自に決めた目安値。
 */
export const HUE_FAMILIES = {
  red: { label: '赤系', hue: [[27, 14]], swatch: '#D93A3A' },
  orange: { label: '橙系', hue: [[58, 14]], swatch: '#EE8A1E' },
  yellow: { label: '黄系', hue: [[95, 14]], swatch: '#E8C21C' },
  green: { label: '緑系', hue: [[148, 32]], swatch: '#2E9E50' },
  blue: { label: '青系', hue: [[245, 32]], swatch: '#2F6FD0' },
  purple: { label: '紫系', hue: [[302, 20]], swatch: '#8A4FC8' },
  pink: { label: 'ピンク系', hue: [[355, 14]], swatch: '#E5609E' },
  brown: { label: '茶系', hue: [[55, 22]], pL: [0.32, 0.52], pC: [0.05, 0.12], swatch: '#8A5A3A' },
};

/** プロファイルに色の系統を重ねる。key が無い・未知なら元のまま。 */
export function applyHueFamily(profile, key) {
  const f = HUE_FAMILIES[key];
  if (!f) return profile;
  return {
    ...profile,
    family: key,
    hue: f.hue,
    // 茶系は明度・彩度で決まるので、印象語の範囲より系統の範囲を優先する
    pL: f.pL ?? profile.pL,
    pC: f.pC ?? profile.pC,
  };
}

const outside = (x, [lo, hi]) => (x < lo ? lo - x : x > hi ? x - hi : 0);

/**
 * 印象適合度（0〜1）。主役色の明度・彩度・色相と背景の明度が、プロファイルの範囲から
 * どれだけ外れたかの減点式。主観的な近似であり、印象の正しさを保証しない。
 */
export function fitScore(profile, featured, bgL) {
  const pl = Math.min(1, outside(featured.L, profile.pL) / 0.15);
  const pc = Math.min(1, outside(featured.C, profile.pC) / 0.08);
  let ph = 0;
  if (profile.hue.length && featured.C > 0.02) {
    ph = Math.min(1, Math.min(...profile.hue.map(([c, w]) => Math.max(0, hueDiff(featured.h, c) - w))) / 40);
  }
  const bgOut = Math.min(outside(bgL, profile.bgL), profile.bgAlt ? outside(bgL, profile.bgAlt) : Infinity);
  const pb = Math.min(1, bgOut / 0.05);
  return Math.max(0, 1 - 0.3 * pl - 0.3 * pc - 0.25 * ph - 0.15 * pb);
}
