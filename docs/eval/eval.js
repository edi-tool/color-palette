// 生成案の評価ページ（開発用）。今のエンジンが出す案に人が良い／微妙／悪いと理由を付け、JSON で書き出す。
// 案は固定の seed で作るので、同じエンジンなら毎回同じ案になる。エンジンを変えた後の比較にも使う。
// 外部送信なし。評価は localStorage にだけ保存する。

import { buildIndex } from '../../src/semantic-model.js';
import { generateWide, cellLabel } from '../../src/palette-engine.js';

// 評価する語: 明るさ・彩度・温度・地の明暗が散らばるように選んだ8語
export const EVAL_WORDS = ['明るい', 'やさしい', '誠実', '落ち着いた', '高級感', 'ナチュラル', '和風', 'ネオン'];
export const EVAL_SEED = 20261106;
const COUNT = 24;
const STORE = 'color-palette-eval-v1';

const REASONS = [
  ['muddy', '濁る・くすむ'],
  ['garish', 'ぎらつく・派手すぎ'],
  ['off-mood', '印象とずれる'],
  ['unreadable', '読みにくい'],
  ['clash', '色どうしが合わない'],
  ['dull', '地味・単調'],
  ['role', '役割の割り当てが変'],
  ['duplicate', '他の案と似ている'],
];
const RATINGS = [['good', '良い', '1'], ['meh', '微妙', '2'], ['bad', '悪い', '3']];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let data = load();
let cards = []; // { key, word, index, cell, colors }

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) ?? { items: {}, overall: {} }; } catch { return { items: {}, overall: {} }; }
}
function save() {
  localStorage.setItem(STORE, JSON.stringify(data));
  progress();
}

function progress() {
  const done = cards.filter((c) => data.items[c.key]?.rating).length;
  $('progress').textContent = `${done} / ${cards.length} 件 評価済み`;
}

function preview(c) {
  return `<div class="prev" style="background:${c.background};color:${c.text}">
    <div class="head"><span class="title" style="color:${c.primary}">見出しの例</span><span class="dot" style="background:${c.accent}"></span></div>
    <div class="body">本文の例です。文字の色と背景の組み合わせを見ます。</div>
    <div class="band" style="background:${c.secondary};color:${c.text}">サブの帯・囲み</div>
    <span class="btnS" style="background:${c.accent};color:${c.background}">差し色</span>
  </div>
  <div class="sw" aria-hidden="true">${[[c.background, 4], [c.primary, 3], [c.secondary, 2], [c.accent, 1], [c.text, 1]].map(([h, f]) => `<span style="flex:${f};background:${h}"></span>`).join('')}</div>`;
}

function cardHtml(card) {
  const it = data.items[card.key] ?? {};
  const c = card.colors;
  return `<li class="card" data-key="${card.key}" data-rating="${it.rating ?? ''}">
    ${preview(c)}
    <div class="meta">${card.index + 1}. ${esc(cellLabel(card.cell))}<br>${[c.primary, c.secondary, c.accent, c.background, c.text].join(' ')}</div>
    <div class="rate" role="group" aria-label="評価">${RATINGS.map(([v, l, k]) => `<button type="button" data-v="${v}" aria-pressed="${it.rating === v}" title="キー ${k}">${l}</button>`).join('')}</div>
    <div class="tags" role="group" aria-label="理由">${REASONS.map(([v, l]) => `<button type="button" data-tag="${v}" aria-pressed="${!!it.tags?.includes(v)}">${l}</button>`).join('')}
      <button type="button" class="star" data-star aria-pressed="${!!it.star}">★お手本</button></div>
    <input class="note" type="text" placeholder="ひとこと（任意）" value="${esc(it.note ?? '')}" aria-label="ひとこと">
  </li>`;
}

function render(index) {
  const root = $('words');
  root.innerHTML = '';
  cards = [];
  for (const word of EVAL_WORDS) {
    const ps = generateWide({ index, moods: [word], seed: EVAL_SEED, count: COUNT });
    const list = ps.map((p, i) => ({ key: `${word}#${i}`, word, index: i, cell: p.cell, colors: p.colors }));
    cards.push(...list);
    const sec = document.createElement('section');
    sec.className = 'word';
    sec.innerHTML = `<h2>${esc(word)}（${list.length}案）</h2>
      <input class="overall" type="text" data-word="${esc(word)}" placeholder="24案全体の感想（任意。例: 幅が狭い、全部くすんで見える）" value="${esc(data.overall[word] ?? '')}" aria-label="${esc(word)}の全体の感想">
      <ul class="grid">${list.map(cardHtml).join('')}</ul>`;
    root.append(sec);
  }
  progress();
}

function itemOf(li) {
  const card = cards.find((c) => c.key === li.dataset.key);
  data.items[card.key] ??= {};
  return data.items[card.key];
}

document.addEventListener('click', (e) => {
  const li = e.target.closest('.card');
  if (!li) return;
  const it = itemOf(li);
  const r = e.target.closest('[data-v]');
  const t = e.target.closest('[data-tag]');
  if (r) {
    it.rating = it.rating === r.dataset.v ? undefined : r.dataset.v;
    li.dataset.rating = it.rating ?? '';
    for (const b of li.querySelectorAll('[data-v]')) b.setAttribute('aria-pressed', String(b.dataset.v === it.rating));
  } else if (t) {
    const set = new Set(it.tags ?? []);
    set.has(t.dataset.tag) ? set.delete(t.dataset.tag) : set.add(t.dataset.tag);
    it.tags = [...set];
    t.setAttribute('aria-pressed', String(set.has(t.dataset.tag)));
  } else if (e.target.closest('[data-star]')) {
    it.star = !it.star;
    e.target.closest('[data-star]').setAttribute('aria-pressed', String(it.star));
  } else return;
  save();
});

document.addEventListener('input', (e) => {
  if (e.target.classList.contains('note')) itemOf(e.target.closest('.card')).note = e.target.value;
  else if (e.target.classList.contains('overall')) data.overall[e.target.dataset.word] = e.target.value;
  else return;
  save();
});

// カード内にフォーカスがあるとき、1/2/3 で良い／微妙／悪い（文字入力中は除く）
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const rating = RATINGS.find(([, , k]) => k === e.key)?.[0];
  const li = document.activeElement?.closest?.('.card');
  if (!rating || !li) return;
  li.querySelector(`[data-v="${rating}"]`).click();
  const next = li.nextElementSibling ?? li.closest('.word')?.nextElementSibling?.querySelector('.card');
  next?.querySelector('[data-v]')?.focus();
  e.preventDefault();
});

function exportJson() {
  return JSON.stringify({
    schema: 'color-palette-eval/1',
    exportedAt: new Date().toISOString(),
    seed: EVAL_SEED,
    words: EVAL_WORDS,
    overall: data.overall,
    // 評価の付いた案だけでなく全案を残す（エンジン変更後に同じ案かを照合できるように）
    items: cards.map((c) => ({ key: c.key, word: c.word, index: c.index, cell: c.cell, colors: c.colors, ...(data.items[c.key] ?? {}) })),
  }, null, 2);
}

function toast(text) {
  const m = document.createElement('div');
  m.className = 'msg';
  m.setAttribute('role', 'status');
  m.textContent = text;
  document.body.append(m);
  setTimeout(() => m.remove(), 2000);
}

$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(exportJson()); toast('コピーしました'); } catch (err) { toast(`コピーできませんでした（${err.message}）`); }
});
$('download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' }));
  a.download = `eval-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('reset').addEventListener('click', () => {
  if (!confirm('このブラウザに保存した評価をすべて消します。よろしいですか？')) return;
  data = { items: {}, overall: {} };
  save();
  location.reload();
});

const res = await fetch('../../src/vocab.json');
render(buildIndex(await res.json()));
