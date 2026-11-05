import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHex, hexToOklch, oklchToHex, contrastRatio, deltaE, ensureContrast, hexToRgb,
} from '../src/color-utils.js';

test('normalizeHex: 3桁展開・大文字化・不正値は null', () => {
  assert.equal(normalizeHex('#abc'), '#AABBCC');
  assert.equal(normalizeHex('2e6598'), '#2E6598');
  for (const bad of ['', '#12', '#GGGGGG', '#12345', '#1234567', null, undefined, 12]) assert.equal(normalizeHex(bad), null);
});

test('OKLCH: 白・黒・赤の既知値（Ottosson の参照値）', () => {
  const w = hexToOklch('#FFFFFF');
  assert.ok(Math.abs(w.L - 1) < 1e-3 && w.C < 1e-3);
  const k = hexToOklch('#000000');
  assert.ok(k.L < 1e-6 && k.C < 1e-6);
  const r = hexToOklch('#FF0000');
  assert.ok(Math.abs(r.L - 0.628) < 2e-3, `L=${r.L}`);
  assert.ok(Math.abs(r.C - 0.2577) < 2e-3, `C=${r.C}`);
  assert.ok(Math.abs(r.h - 29.23) < 0.3, `h=${r.h}`);
});

test('OKLCH ⇔ HEX の往復で ±1 以内に戻る', () => {
  for (const hex of ['#2E6598', '#77AE9E', '#F2B84B', '#F7F6F0', '#243442', '#CC75E5']) {
    const { L, C, h } = hexToOklch(hex);
    const back = hexToRgb(oklchToHex(L, C, h));
    const orig = hexToRgb(hex);
    back.forEach((v, i) => assert.ok(Math.abs(v - orig[i]) <= 1, `${hex} ch${i}`));
  }
});

test('色域外の指定は sRGB に収まった有効なHEXになり、明度は保たれる', () => {
  const hex = oklchToHex(0.7, 0.4, 150);
  assert.match(hex, /^#[0-9A-F]{6}$/);
  assert.ok(Math.abs(hexToOklch(hex).L - 0.7) < 0.02);
});

test('WCAG コントラスト比: 白黒 21:1、同色 1:1', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 1e-9);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
});

test('ensureContrast: 4.5:1 未満なら4.5以上へ、満たしていれば変更しない', () => {
  const fixed = ensureContrast('#9AA5B1', '#F7F6F0', 4.5);
  assert.ok(contrastRatio(fixed, '#F7F6F0') >= 4.5);
  assert.equal(ensureContrast('#243442', '#F7F6F0', 4.5), '#243442');
});

test('deltaE: 同色 0、白黒は大きい', () => {
  assert.equal(deltaE('#336699', '#336699'), 0);
  assert.ok(deltaE('#000000', '#FFFFFF') > 90);
});
