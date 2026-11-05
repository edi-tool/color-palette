import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateHex, simulateColors, visionIssues, VISION_TYPES } from '../src/vision.js';
import { deltaE, hexToOklch, hueDiff } from '../src/color-utils.js';
import { visionNote, formatDetailed, formatJson } from '../src/export.js';

test('シミュレーション: 無彩色は変わらない（行列の各行の和が1）', () => {
  for (const type of Object.keys(VISION_TYPES)) {
    for (const hex of ['#FFFFFF', '#000000', '#777777']) assert.ok(deltaE(simulateHex(hex, type), hex) < 0.5, `${type} ${hex}`);
  }
});

test('シミュレーション: 未知の型・一般的な色覚では元の HEX をそのまま返す', () => {
  assert.equal(simulateHex('#2E6598', 'normal'), '#2E6598');
  const c = { primary: '#D62828', accent: '#2E9E44' };
  assert.deepEqual(simulateColors(c, 'normal'), c);
});

test('シミュレーション: P型・D型では赤と緑が同じ色相に寄り、青と橙は離れたまま', () => {
  // D型は赤と緑がほぼ同じ色に、P型は赤が暗く見えるため明度差は残るが色相は同じ側に寄る
  assert.ok(deltaE(simulateHex('#D62828', 'deutan'), simulateHex('#2E9E44', 'deutan')) < 8);
  for (const type of ['protan', 'deutan']) {
    const r = hexToOklch(simulateHex('#D62828', type));
    const g = hexToOklch(simulateHex('#2E9E44', type));
    assert.ok(hueDiff(r.h, g.h) < 20, `${type} ${r.h} ${g.h}`);
    assert.ok(deltaE(simulateHex('#1F5FBF', type), simulateHex('#F28C06', type)) > 20, type);
  }
});

const redGreen = { primary: '#C0392B', secondary: '#F2E3C6', accent: '#3E8E41', background: '#FBF8F2', text: '#222222' };
const blueOrange = { primary: '#1F5FBF', secondary: '#D7E3F4', accent: '#F28C06', background: '#FAFAF7', text: '#1A1A1A' };

test('visionIssues: 赤のメイン＋緑の差し色は P型/D型で警告、青＋橙は警告しない', () => {
  const issues = visionIssues(redGreen);
  const types = issues.map((i) => i.type);
  assert.ok(types.includes('protan') || types.includes('deutan'), JSON.stringify(issues));
  assert.ok(issues.some((i) => i.pairs.some(([a, b]) => a === 'primary' && b === 'accent')));
  assert.deepEqual(visionIssues(blueOrange).filter((i) => i.type !== 'tritan'), []);
});

test('コピー文: 問題があるときだけ「くわしく」とJSONに注意を入れ、保証はしない', () => {
  const view = { moods: ['明るい'], usage: 'general', mode: 'rgb', seed: 1, locks: [] };
  const bad = formatDetailed({ ...view, colors: redGreen });
  assert.match(bad, /見分けにくい可能性/);
  assert.match(bad, /色だけで区別させず/);
  assert.doesNotMatch(bad, /保証します|必ず見分け/);
  assert.ok(visionNote(redGreen));
  const j = JSON.parse(formatJson({ ...view, colors: redGreen }));
  assert.ok(j.visionSimulation.length > 0);
  assert.equal(visionNote(blueOrange)?.types.includes('P型') ?? false, false);
});
