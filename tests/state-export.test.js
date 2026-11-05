import { test } from 'node:test';
import assert from 'node:assert/strict';
import { index } from './helpers-engine.js';
import { initialState, reduce, exportView } from '../src/state.js';
import { formatFor, formatSimple, formatDetailed, formatJson, formatCss, USAGES, FORMATS } from '../src/export.js';
import { encodeState, decodeState } from '../src/url-state.js';
import { ROLES } from '../src/color-utils.js';
import { rgbToCmyk } from '../src/print-profile.js';
import { contrastInfo } from '../src/palette-engine.js';

const ctx = { index };
const run = (s, ...actions) => actions.reduce((st, a) => reduce(st, a, ctx), s);
const selected = () => {
  const s = run(initialState(), { type: 'setMoods', moods: ['明るい', '知的'] });
  return run(s, { type: 'select', id: s.candidates[2].id });
};

test('印象語を選ぶと24案が出て、3語を超える分は無視される', () => {
  const s = run(initialState(), { type: 'setMoods', moods: ['明るい', '知的', '和風', 'シック'] });
  assert.equal(s.moods.length, 3);
  assert.equal(s.candidates.length, 24);
});

test('もっと見る: 既存の候補を消さずに追加される', () => {
  const s = run(initialState(), { type: 'setMoods', moods: ['明るい'] });
  const s2 = run(s, { type: 'loadMore' });
  assert.ok(s2.candidates.length > s.candidates.length);
  assert.deepEqual(s2.candidates.slice(0, 24), s.candidates);
});

test('再生成: 別seedで候補が変わり、同じseedなら同じ', () => {
  const s = run(initialState(), { type: 'setMoods', moods: ['明るい'] });
  const a = run(s, { type: 'regenerate', seed: 5 });
  const b = run(s, { type: 'regenerate', seed: 5 });
  assert.deepEqual(a.candidates, b.candidates);
  assert.notDeepEqual(a.candidates.map((c) => c.colors), s.candidates.map((c) => c.colors));
});

test('サブだけ手動変更しても、他の役割は変わらない', () => {
  const s = selected();
  const before = { ...s.selected.colors };
  const s2 = run(s, { type: 'editColor', role: 'secondary', hex: '#123456' });
  assert.equal(s2.selected.colors.secondary, '#123456');
  for (const r of ROLES.filter((r) => r !== 'secondary')) assert.equal(s2.selected.colors[r], before[r]);
});

test('不正なHEXは破棄してエラーを出し、直前の状態を保つ', () => {
  const s = selected();
  for (const bad of ['', 'zzz', '#12345', '#GG0000']) {
    const s2 = run(s, { type: 'editColor', role: 'primary', hex: bad });
    assert.deepEqual(s2.selected.colors, s.selected.colors);
    assert.equal(s2.message.kind, 'error');
    assert.equal(s2.selected.undo.length, s.selected.undo.length);
  }
  assert.equal(run(s, { type: 'editColor', role: 'primary', hex: '#abc' }).selected.colors.primary, '#AABBCC');
});

test('メインをロックして再提案しても、メインのHEXは変わらない', () => {
  let s = selected();
  const primary = s.selected.colors.primary;
  s = run(s, { type: 'toggleLock', role: 'primary' });
  for (let i = 0; i < 10; i++) {
    s = run(s, { type: 'repropose' });
    assert.equal(s.selected.colors.primary, primary);
  }
});

test('手動変更したロック色も、再提案後に保持される', () => {
  let s = selected();
  s = run(s, { type: 'editColor', role: 'accent', hex: '#FF00AA' }, { type: 'toggleLock', role: 'accent' }, { type: 'repropose' });
  assert.equal(s.selected.colors.accent, '#FF00AA');
});

test('Undo と 元の案に戻す', () => {
  const s0 = selected();
  const orig = { ...s0.selected.colors };
  let s = run(s0, { type: 'editColor', role: 'primary', hex: '#111111' }, { type: 'editColor', role: 'accent', hex: '#222222' });
  s = run(s, { type: 'undo' });
  assert.equal(s.selected.colors.accent, orig.accent);
  assert.equal(s.selected.colors.primary, '#111111');
  s = run(s, { type: 'resetToOriginal' });
  assert.deepEqual(s.selected.colors, orig);
});

test('コピー文: 手動変更・ロック後の最新値が反映され、古いHEXが残らない', () => {
  let s = selected();
  const old = s.selected.colors.primary;
  s = run(s, { type: 'editColor', role: 'primary', hex: '#0A0B0C' }, { type: 'toggleLock', role: 'primary' });
  const view = exportView(s);
  for (const f of Object.keys(FORMATS)) {
    const text = formatFor(f, view);
    assert.ok(text.includes('#0A0B0C'), `${f} に最新HEXが無い`);
    if (old !== '#0A0B0C') assert.ok(!text.includes(old), `${f} に古いHEXが残っている`);
    for (const r of ROLES) assert.ok(text.includes(view.colors[r]), `${f}: ${r}`);
  }
});

test('用途に応じて文面が変わる（全用途で別の文面）', () => {
  const view = exportView(selected());
  const texts = Object.keys(USAGES).map((u) => formatSimple({ ...view, usage: u }));
  assert.equal(new Set(texts).size, Object.keys(USAGES).length);
  assert.ok(formatSimple({ ...view, usage: 'book-cover' }).includes('書籍のカバー'));
  assert.ok(formatSimple({ ...view, usage: 'flyer' }).includes('チラシ'));
});

test('かんたん/くわしくに「正本」「再解釈しない」「差し色を多用しない」「色再現の注記」が入る', () => {
  const view = exportView(selected());
  for (const f of [formatSimple, formatDetailed]) {
    const t = f(view);
    assert.match(t, /正本/);
    assert.match(t, /再解釈|置き換え/);
    assert.match(t, /差し色[をは]多用しない/);
    assert.match(t, /ならない場合/);
  }
});

test('可読性が4.5:1未満なら警告文が入り、満たすなら入らない', () => {
  const view = exportView(selected());
  const bad = { ...view, colors: { ...view.colors, text: '#CCCCCC', background: '#DDDDDD' } };
  assert.match(formatSimple(bad), /コントラスト比/);
  assert.match(formatDetailed(bad), /届きません/);
  const good = { ...view, colors: { ...view.colors, text: '#000000', background: '#FFFFFF' } };
  assert.doesNotMatch(formatSimple(good), /コントラスト比/);
});

test('JSON/CSS が解析でき、schemaVersion と役割を持つ', () => {
  const view = exportView(selected());
  const j = JSON.parse(formatJson(view));
  assert.equal(j.schemaVersion, 1);
  assert.deepEqual(Object.keys(j.colors), ROLES);
  assert.match(formatCss(view), /--color-primary: #[0-9A-F]{6};/);
});

test('印刷モード: CMYK数値を出さず、未提供と明示する（架空の値を出さない）', () => {
  const view = { ...exportView(selected()), mode: 'print' };
  for (const f of Object.keys(FORMATS)) {
    const t = formatFor(f, view);
    assert.doesNotMatch(t, /cmyk\(|CMYK\s*[:：]?\s*\d|\bC\s*\d+\s*M\s*\d+/i, f);
  }
  assert.match(formatSimple(view), /CMYK数値は未提供/);
  const j = JSON.parse(formatJson(view));
  assert.equal(j.print.cmyk, null);
  assert.equal(j.print.status, 'not-provided');
  assert.equal(rgbToCmyk('#336699').ok, false);
  assert.equal(rgbToCmyk('#336699').cmyk, undefined);
});

test('コントラスト警告: 色から判定できる', () => {
  assert.equal(contrastInfo({ text: '#777777', background: '#888888' }).passAA, false);
  assert.equal(contrastInfo({ text: '#000000', background: '#FFFFFF' }).passAA, true);
});

test('URL: 状態を保存→復帰すると、同じ候補・選択・編集・ロックが戻る', () => {
  let s = run(selected(), { type: 'loadMore' });
  s = run(s, { type: 'select', id: s.candidates[30].id }, { type: 'editColor', role: 'secondary', hex: '#13579B' }, { type: 'toggleLock', role: 'accent' });
  const frag = encodeState(s);
  const back = run(initialState(), { type: 'restore', ...decodeState(frag, { validMoods: index.names }) });
  assert.deepEqual(back.candidates, s.candidates);
  assert.equal(back.selected.id, s.selected.id);
  assert.deepEqual(back.selected.colors, s.selected.colors);
  assert.deepEqual(back.selected.locks, s.selected.locks);
  assert.equal(back.seed, s.seed);
});

test('URL: 壊れた入力でも例外にならず、不正な語・色は無視される', () => {
  assert.equal(decodeState(''), null);
  const d = decodeState('v=1&m=存在しない,明るい&c=zz-1-2-3-4&s=-5&mode=x&u=nope', { validMoods: index.names });
  assert.deepEqual(d.moods, ['明るい']);
  assert.equal(d.seed, undefined);
  assert.equal(d.mode, 'rgb');
  const s = run(initialState(), { type: 'restore', ...d });
  assert.equal(s.usage, 'general');
});

test('深掘り→幅広くに戻る', () => {
  let s = selected();
  s = run(s, { type: 'deepDive' });
  assert.equal(s.searchMode, 'deep');
  assert.ok(s.candidates.length >= 7);
  assert.equal(s.selected.id, s.candidates[0].id);
  s = run(s, { type: 'backToWide' });
  assert.equal(s.searchMode, 'wide');
  assert.equal(s.candidates.length, 24);
});
