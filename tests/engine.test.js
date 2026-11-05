import { test } from 'node:test';
import assert from 'node:assert/strict';
import { index } from './helpers-engine.js';
import {
  generateWide, generateDeep, reproposeUnlocked, paletteDistance, qualityIssues, FIT_MIN, MIN_DIST_FLOOR,
} from '../src/palette-engine.js';
import { ROLES, contrastRatio, hexToOklch, normalizeHex } from '../src/color-utils.js';

const cache = new Map();
const gen = (moods, extra = {}) => {
  const key = JSON.stringify([moods, extra]);
  if (!cache.has(key)) cache.set(key, generateWide({ index, moods, seed: 14273, count: 24, ...extra }));
  return cache.get(key);
};
const REP = [['明るい'], ['シック'], ['和風'], ['ポップ'], ['信頼感'], ['明るい', '知的']];

test('初期24案: 代表語彙で24案を返し、全案が5役割の有効HEXを持つ', () => {
  for (const moods of REP) {
    const list = gen(moods);
    assert.equal(list.length, 24, moods.join('+'));
    for (const p of list) for (const r of ROLES) assert.equal(normalizeHex(p.colors[r]), p.colors[r]);
  }
});

test('同一seed・同一設定で出力が完全に一致する（再現性）。別seedでは変わる', () => {
  assert.deepEqual(gen(['明るい']), gen(['明るい']));
  assert.notDeepEqual(gen(['明るい']).map((p) => p.colors), generateWide({ index, moods: ['明るい'], seed: 999, count: 24 }).map((p) => p.colors));
});

// 色相窓が寒色側だけの語（信頼感など）に暖色案を混ぜると印象適合度の下限を割るため、
// 「その語が許す温度」をすべて含むことを検証する。
const isWarmHue = (h) => h < 115 || h >= 300;
const allowsWarm = (moods) => moods.some((m) => !index.words[m].hue.length || index.words[m].hue.some(([c, w]) => [-w, 0, w].some((d) => isWarmHue(((c + d) % 360 + 360) % 360))));

test('方向性の幅: 語彙が許す温度（暖色系・寒色/緑系）と無彩色＋差し色がすべて含まれる', () => {
  for (const moods of REP) {
    const temps = new Set(gen(moods).map((p) => p.cell.temp));
    assert.ok(temps.has('cool') && temps.has('neutral'), `${moods.join('+')}: ${[...temps]}`);
    if (allowsWarm(moods)) assert.ok(temps.has('warm'), `${moods.join('+')} に warm が無い`);
  }
  assert.ok(allowsWarm(['明るい']) && !allowsWarm(['信頼感']));
});

test('調和タイプ・彩度も偏らない（3種以上の調和、3彩度すべて）', () => {
  const list = gen(['明るい']);
  assert.ok(new Set(list.map((p) => p.cell.harm)).size >= 3);
  assert.equal(new Set(list.map((p) => p.cell.sat)).size, 3);
});

test('印象適合度の下限を全案が満たす', () => {
  for (const moods of REP) for (const p of gen(moods)) assert.ok(p.fit >= FIT_MIN, `${moods}: ${p.fit}`);
});

test('文字と背景は全案で AA（4.5:1）を満たす', () => {
  for (const moods of REP) for (const p of gen(moods)) {
    assert.ok(contrastRatio(p.colors.text, p.colors.background) >= 4.5);
  }
});

test('似た案の大量出現を避ける（全ペアの最小距離が下限以上）', () => {
  for (const moods of REP) {
    const list = gen(moods);
    let min = Infinity;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) min = Math.min(min, paletteDistance(list[i].colors, list[j].colors));
    assert.ok(min >= MIN_DIST_FLOOR - 1e-9, `${moods.join('+')}: 最小距離 ${min.toFixed(1)}`);
  }
});

test('複数語は単語単独と傾向が違う（知的を足すと知的の色相窓へ寄る）', () => {
  const inWindow = (list) => list.filter((p) => {
    const { h, C } = hexToOklch(p.cell.harm === 'neutralAccent' ? p.colors.accent : p.colors.primary);
    return C > 0.02 && index.words['知的'].hue.some(([c, w]) => Math.min(Math.abs(h - c), 360 - Math.abs(h - c)) <= w + 10);
  }).length;
  assert.ok(inWindow(gen(['明るい', '知的'])) > inWindow(gen(['明るい'])));
});

test('追加の24案: 既存案を保持したまま、重複せず、既存と十分離れる', () => {
  const first = gen(['明るい']);
  const more = generateWide({ index, moods: ['明るい'], seed: 14273, page: 1, count: 24, exclude: first });
  assert.ok(more.length >= 12, `追加 ${more.length} 案`);
  const ids = new Set([...first, ...more].map((p) => p.id));
  assert.equal(ids.size, first.length + more.length);
  for (const m of more) for (const f of first) assert.ok(paletteDistance(m.colors, f.colors) >= MIN_DIST_FLOOR - 1e-9);
});

test('深掘り: 基準案と同じセルで、距離が上限内（近い系統）', () => {
  const base = gen(['明るい'])[3];
  const deep = generateDeep({ index, moods: ['明るい'], seed: 14273, base, count: 12 });
  assert.ok(deep.length >= 6);
  const wide = gen(['明るい']);
  const meanD = (list) => list.reduce((s, p) => s + paletteDistance(p.colors, base.colors), 0) / list.length;
  for (const d of deep) {
    assert.equal(d.cell.temp, base.cell.temp);
    assert.ok(paletteDistance(d.colors, base.colors) <= 14);
  }
  assert.ok(meanD(deep) < meanD(wide), '深掘りの方が基準案に近い');
});

test('ロック: ロックした役割のHEXは再提案で1桁も変わらない', () => {
  const base = gen(['明るい'])[0];
  for (const locks of [['primary'], ['primary', 'accent'], ['background', 'text'], ROLES.slice(0, 4)]) {
    for (let seed = 1; seed <= 8; seed++) {
      const next = reproposeUnlocked({ index, moods: ['明るい'], seed, current: base, locks });
      for (const r of locks) assert.equal(next.colors[r], base.colors[r], `${r} seed${seed}`);
    }
  }
});

test('ロック以外は実際に変わる', () => {
  const base = gen(['明るい'])[0];
  const next = reproposeUnlocked({ index, moods: ['明るい'], seed: 5, current: base, locks: ['primary'] });
  assert.ok(ROLES.filter((r) => r !== 'primary').some((r) => next.colors[r] !== base.colors[r]));
});

test('印刷向けモードは高彩度を抑える（主役色・差し色の平均彩度が画面向けより低い）', () => {
  for (const role of ['primary', 'accent']) {
    const mean = (list) => list.reduce((s, p) => s + hexToOklch(p.colors[role]).C, 0) / list.length;
    assert.ok(mean(gen(['ポップ'], { mode: 'print' })) < mean(gen(['ポップ'])), role);
  }
});

test('品質: 全案がメイン3.2:1・差し色2.2:1以上などの基準（qualityIssues）に合格する', () => {
  for (const moods of [...REP, ['かわいい'], ['高級感']]) {
    for (const p of gen(moods)) {
      assert.deepEqual(qualityIssues(p.colors), [], `${moods} ${JSON.stringify(p.colors)}`);
      assert.ok(contrastRatio(p.colors.primary, p.colors.background) >= 3.2, 'primary');
      assert.ok(contrastRatio(p.colors.accent, p.colors.background) >= 2.2, 'accent');
    }
  }
});
