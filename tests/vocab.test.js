import { test } from 'node:test';
import assert from 'node:assert/strict';
import { index } from './helpers-engine.js';
import { resolveTerm, mergeProfile, MAX_MOODS } from '../src/semantic-model.js';

const REQUIRED = ['明るい','元気','楽しい','ポップ','親しみやすい','やさしい','かわいい','ナチュラル','落ち着いた','シック','上品','高級感','まじめ','誠実','信頼感','知的','クール','かっこいい','モダン','力強い','爽やか','清潔','あたたかい','懐かしい','レトロ','華やか','シンプル','ミニマル','和風','未来的'];

test('語彙は要件の30語ちょうど（件数を固定）', () => {
  assert.equal(index.names.length, 30);
  assert.deepEqual([...index.names].sort(), [...REQUIRED].sort());
});

test('各語の範囲が妥当（下限≦上限、色相窓の形式）', () => {
  for (const [name, d] of Object.entries(index.words)) {
    for (const k of ['pL', 'pC', 'bgL']) {
      assert.ok(Array.isArray(d[k]) && d[k][0] <= d[k][1], `${name}.${k}`);
    }
    assert.ok(d.pL[0] >= 0 && d.pL[1] <= 1 && d.bgL[1] <= 1);
    for (const [c, w] of d.hue) assert.ok(c >= 0 && c < 360 && w > 0 && w <= 90, `${name}.hue`);
  }
});

test('同義語・表記ゆれを辞書の語へ束ねる', () => {
  assert.equal(resolveTerm(index, 'さわやか').word, '爽やか');
  assert.equal(resolveTerm(index, 'カワイイ').word, 'かわいい');
  assert.equal(resolveTerm(index, 'ＳＦ').word, '未来的');
});

test('未知語は理解したふりをせず、近い候補を示す', () => {
  const r = resolveTerm(index, 'シックな');
  assert.equal(r.word, null);
  assert.ok(r.suggestions.includes('シック'));
  const none = resolveTerm(index, 'zzzzzz');
  assert.equal(none.word, null);
  assert.deepEqual(none.suggestions, []);
});

test('複数語の合成: 範囲は積集合、空なら中心平均。最大3語', () => {
  const inter = mergeProfile(index, ['明るい', '爽やか']); // pL [.62,.82] ∩ [.70,.88]
  assert.deepEqual(inter.pL.map((x) => Math.round(x * 100) / 100), [0.7, 0.82]);
  const p = mergeProfile(index, ['明るい', '知的']); // pL が重ならない → 中心平均で取り直す
  assert.ok(p.pL[0] <= p.pL[1] && p.pC[0] <= p.pC[1]);
  assert.equal(mergeProfile(index, ['明るい', '知的', '和風', 'シック']).moods.length, MAX_MOODS);
  assert.throws(() => mergeProfile(index, ['存在しない語']));
});
