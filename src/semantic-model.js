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

export function buildIndex(vocab) {
  const words = vocab.words;
  const lookup = new Map();
  for (const [name, def] of Object.entries(words)) {
    lookup.set(toKey(name), name);
    for (const s of def.syn ?? []) if (!lookup.has(toKey(s))) lookup.set(toKey(s), name);
  }
  return { words, lookup, names: Object.keys(words) };
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

/** 複数の語を1つの「許容範囲プロファイル」に合成する（最大3語） */
export function mergeProfile(index, moodNames) {
  const defs = moodNames.slice(0, MAX_MOODS).map((m) => {
    const d = index.words[m];
    if (!d) throw new Error(`辞書にない語: ${m}`);
    return d;
  });
  if (!defs.length) throw new Error('印象語が選ばれていません');
  return {
    moods: moodNames.slice(0, MAX_MOODS),
    pL: mergeRange(defs.map((d) => d.pL)),
    pC: mergeRange(defs.map((d) => d.pC)),
    bgL: mergeRange(defs.map((d) => d.bgL)),
    hue: defs.flatMap((d) => d.hue),
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
  const pb = Math.min(1, outside(bgL, profile.bgL) / 0.05);
  return Math.max(0, 1 - 0.3 * pl - 0.3 * pc - 0.25 * ph - 0.15 * pb);
}
