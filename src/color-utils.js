// 色演算（依存なし）。sRGB ⇔ OKLab/OKLCH、色域マッピング、色差、WCAG コントラスト。
// OKLab の行列は Björn Ottosson による公開定義（https://bottosson.github.io/posts/oklab/）。
// DOM に触れない純粋関数のみ。

export const ROLES = ['primary', 'secondary', 'accent', 'background', 'text'];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** '#abc' / 'ABCDEF' / '#AABBCC' を '#AABBCC' に正規化する。不正なら null。 */
export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = [...s].map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return '#' + s.toUpperCase();
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) throw new Error(`不正なHEX: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
};

/** HEX → 線形 sRGB（0〜1） */
export function hexToLinearRgb(hex) {
  return hexToRgb(hex).map(toLinear);
}

/** 線形 sRGB → HEX（範囲外は切り詰める） */
export function linearRgbToHex(lin) {
  return rgbToHex(lin.map((v) => fromLinear(clamp(v, 0, 1))));
}

export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// 同じ HEX を何度も変換する（候補間の距離計算は案数の2乗で増える）ので結果を覚えておく。
// 純粋関数なので出力は変わらない。返す配列は共有されるため凍結する。
const LAB_CACHE = new Map();
const LAB_CACHE_MAX = 20000;

export function hexToOklab(hex) {
  let lab = LAB_CACHE.get(hex);
  if (lab) return lab;
  lab = Object.freeze(linearToOklab(hexToRgb(hex).map(toLinear)));
  if (LAB_CACHE.size >= LAB_CACHE_MAX) LAB_CACHE.clear();
  LAB_CACHE.set(hex, lab);
  return lab;
}

export function hexToOklch(hex) {
  const [L, a, b] = hexToOklab(hex);
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h: C < 1e-4 ? 0 : h };
}

const EPS = 1e-6;
const inGamut = (lin) => lin.every((v) => v >= -EPS && v <= 1 + EPS);

function oklchToLinear(L, C, h) {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear([L, C * Math.cos(rad), C * Math.sin(rad)]);
}

/**
 * OKLCH → sRGB HEX。色域外は明度と色相を保ったまま彩度だけを二分探索で下げる（クロマ低減）。
 * 保存する正本は HEX なので、ここで必ず sRGB に収める。
 */
export function oklchToHex(L, C, h) {
  const l = clamp(L, 0, 1);
  let c = Math.max(0, C);
  let lin = oklchToLinear(l, c, h);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(l, mid, h))) lo = mid;
      else hi = mid;
    }
    c = lo;
    lin = oklchToLinear(l, c, h);
  }
  return rgbToHex(lin.map((v) => fromLinear(clamp(v, 0, 1))));
}

/** OKLab 距離を ×100 した色差（ΔE_OK）。目安: 1 がほぼ識別限界、10 以上ははっきり別の色。 */
export function deltaE(hexA, hexB) {
  const a = hexToOklab(hexA);
  const b = hexToOklab(hexB);
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** WCAG 2.x の相対輝度 */
export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG のコントラスト比（1〜21） */
export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** 通常サイズ文字の AA（4.5:1） */
export const AA_NORMAL = 4.5;

/**
 * 前景色の明度だけを動かして、背景とのコントラスト比を目標以上にする。
 * すでに満たしていれば同じ HEX を返す。色相・彩度は保つ（色域外は自動で低減）。
 */
export function ensureContrast(fgHex, bgHex, target = AA_NORMAL) {
  if (contrastRatio(fgHex, bgHex) >= target) return normalizeHex(fgHex);
  const { L, C, h } = hexToOklch(fgHex);
  const dir = relativeLuminance(bgHex) > 0.3 ? -1 : 1;
  const at = (step) => oklchToHex(L + dir * step * 0.01, C, h);
  // 明度を背景から遠ざけるほどコントラストは上がるので、0.01 刻みで目標を満たす最小の段を二分探索する
  if (contrastRatio(at(100), bgHex) < target) return dir < 0 ? '#000000' : '#FFFFFF';
  let lo = 0;
  let hi = 100;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (contrastRatio(at(mid), bgHex) >= target) hi = mid;
    else lo = mid;
  }
  return at(hi);
}

/** 角度 a, b の差（0〜180） */
export function hueDiff(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}
