// 色覚の多様性のシミュレーション（目安）。DOM に触れない純粋関数。
// 行列は Machado, Oliveira & Fernandes (2009) "A Physiologically-based Model for Simulation of
// Color Vision Deficiency"（IEEE TVCG 15(6)）の severity 1.0。著者公開ページの表の値を線形 sRGB に適用する。
// https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
// 見え方には個人差があり、ここでの判定は見分けやすさを保証しない。

import { hexToLinearRgb, linearRgbToHex, deltaE } from './color-utils.js';

export const VISION_TYPES = {
  protan: {
    label: 'P型（1型）',
    m: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  },
  deutan: {
    label: 'D型（2型）',
    m: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  },
  tritan: {
    label: 'T型（3型）',
    m: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
  },
};

/** type の見え方に近づけた HEX。type が未知（'normal' など）なら元の HEX を返す。 */
export function simulateHex(hex, type) {
  const t = VISION_TYPES[type];
  if (!t) return hex;
  const l = hexToLinearRgb(hex);
  return linearRgbToHex(t.m.map((r) => r[0] * l[0] + r[1] * l[1] + r[2] * l[2]));
}

export function simulateColors(colors, type) {
  return Object.fromEntries(Object.entries(colors).map(([r, h]) => [r, simulateHex(h, type)]));
}

// 区別がつかないと困る組み合わせ（文字と背景はコントラスト比で別に見る）
export const VISION_PAIRS = [['primary', 'accent'], ['primary', 'secondary'], ['secondary', 'accent'], ['accent', 'background']];
export const VISION_DISTINCT = 12; // 一般的な色覚で「はっきり別の色」とみなす ΔE_OK
export const VISION_CONFUSED = 8; // シミュレーション後にこれ未満なら「見分けにくい可能性」

/**
 * 一般的な色覚ではっきり違うのに、シミュレーションでは近づく組み合わせを返す。
 * もともと近い組み合わせ（同系色の配色）は意図した近さなので数えない。
 * @returns {Array<{type, pairs: Array<[string, string]>}>} 問題のある型だけ
 */
export function visionIssues(colors) {
  const out = [];
  for (const type of Object.keys(VISION_TYPES)) {
    const sim = simulateColors(colors, type);
    const pairs = VISION_PAIRS.filter(([a, b]) => deltaE(colors[a], colors[b]) >= VISION_DISTINCT && deltaE(sim[a], sim[b]) < VISION_CONFUSED);
    if (pairs.length) out.push({ type, pairs });
  }
  return out;
}
