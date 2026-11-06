// 生成案の評価ページ（開発用）。今のエンジンが出す案に人が良い／微妙／悪いと理由を付け、JSON で書き出す。
// 案は固定の seed で作るので、同じエンジンなら毎回同じ案になる。エンジンを変えた後の比較にも使う。
// 外部送信なし。評価は localStorage にだけ保存する。

import { buildIndex } from '../../src/semantic-model.js';
import { generateWide, cellLabel } from '../../src/palette-engine.js';

// 評価する語: 明るさ・彩度・温度・地の明暗が散らばるように選んだ8語（既定の組）。
// ?set=rest で残りの語（辞書の語からこの8語を除いたもの）を評価する。&count= で1語あたりの案の数（既定: 8語は24、残りは12）
export const EVAL_WORDS = ['明るい', 'やさしい', '誠実', '落ち着いた', '高級感', 'ナチュラル', '和風', 'ネオン'];
const params = new URLSearchParams(location.search);
const SET = params.get('set') === 'rest' ? 'rest' : 'core';
let words = EVAL_WORDS;
export const EVAL_SEED = 20261106;
const COUNT = Math.min(24, Math.max(1, Number(params.get('count')) || (SET === 'rest' ? 12 : 24)));
// 保存先。?store=名前 で別の保存先を使える（動作確認で本番の評価に触れないため）
const STORE_SUFFIX = params.get('store');
// 組ごとに保存先を分ける（既定の組は以前と同じキー）
const STORE = `color-palette-eval-v1${SET === 'rest' ? '-rest' : ''}${STORE_SUFFIX ? `-${STORE_SUFFIX}` : ''}`;
// 控え: 評価の途中経過を別のキーに残す（誤って消しても戻せるように）。新しい順に最大 MAX_SNAPSHOTS 件
const BACKUP = `${STORE}-backup`;
const MAX_SNAPSHOTS = 30;
const SNAPSHOT_EVERY_MS = 60 * 1000;

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
  snapshot();
  progress();
}

const ratedCount = (d) => Object.entries(d.items ?? {}).filter(([k, it]) => !k.includes('@') && it.rating).length;
function loadSnapshots() {
  try { return JSON.parse(localStorage.getItem(BACKUP)) ?? []; } catch { return []; }
}
/** 控えを取る。前の控えから1分たったか、評価数が5件以上変わったら新しい控えにし、それ以外は最新の控えを上書きする */
function snapshot({ force = false } = {}) {
  const list = loadSnapshots();
  const n = ratedCount(data);
  if (!n && !force) return;
  const now = Date.now();
  const last = list[0];
  const entry = { at: now, count: n, data: structuredClone(data) };
  if (!force && last && now - last.at < SNAPSHOT_EVERY_MS && Math.abs(last.count - n) < 5) list[0] = { ...entry, at: last.at };
  else list.unshift(entry);
  localStorage.setItem(BACKUP, JSON.stringify(list.slice(0, MAX_SNAPSHOTS)));
  renderSnapshots();
}

function renderSnapshots() {
  const sel = $('snapshots');
  const list = loadSnapshots();
  const t = (ms) => new Date(ms).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  sel.innerHTML = `<option value="">控えから戻す…（${list.length}件）</option>`
    + list.map((s, i) => `<option value="${i}">${t(s.at)}　${s.count}件評価済み</option>`).join('');
}

function progress() {
  const done = cards.filter((c) => itemFor(c).rating).length;
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

// 案の色の署名。エンジンを変えると同じ番号でも別の案になるので、評価は署名が一致するときだけ表示する。
// 署名の無い評価（2026-11-06 のサブ修正より前）は前のエンジンの案に付いたものとして扱う
const sigOf = (c) => [c.primary, c.secondary, c.accent, c.background, c.text].join('');
const isStale = (card) => { const it = data.items[card.key]; return !!it && it.sig !== sigOf(card.colors); };
const itemFor = (card) => (isStale(card) ? {} : data.items[card.key] ?? {});

function cardHtml(card) {
  const it = itemFor(card);
  const c = card.colors;
  return `<li class="card" data-key="${card.key}" data-rating="${it.rating ?? ''}">
    ${preview(c)}
    <div class="meta">${card.index + 1}. ${esc(card.label ?? cellLabel(card.cell))}${card.seedId ? '' : '（自動生成）'}<br>${[c.primary, c.secondary, c.accent, c.background, c.text].join(' ')}</div>
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
  if (SET === 'rest') words = index.names.filter((w) => !EVAL_WORDS.includes(w));
  document.querySelector('h1').textContent = `生成案の評価（${SET === 'rest' ? `残りの${words.length}語` : `${words.length}語`}×${COUNT}案・開発用）`;
  for (const word of words) {
    const ps = generateWide({ index, moods: [word], seed: EVAL_SEED, count: COUNT });
    const list = ps.map((p, i) => ({ key: `${word}#${i}`, word, index: i, cell: p.cell, label: p.label, seedId: p.seedId, colors: p.colors }));
    cards.push(...list);
    const sec = document.createElement('section');
    sec.className = 'word';
    sec.innerHTML = `<h2>${esc(word)}（${list.length}案）</h2>
      <input class="overall" type="text" data-word="${esc(word)}" placeholder="24案全体の感想（任意。例: 幅が狭い、全部くすんで見える）" value="${esc(data.overall[word] ?? '')}" aria-label="${esc(word)}の全体の感想">
      <ul class="grid">${list.map(cardHtml).join('')}</ul>`;
    root.append(sec);
  }
  progress();
  const stale = cards.filter(isStale).length;
  if (stale) $('words').insertAdjacentHTML('beforebegin', `<p class="howto" role="status">エンジンが変わったため、前に付けた評価のうち ${stale} 件は今の案と色が違います。その案は未評価として表示しています（前の評価は消さずに残しています）。</p>`);
}

function itemOf(li) {
  const card = cards.find((c) => c.key === li.dataset.key);
  const sig = sigOf(card.colors);
  // 署名の違う古い評価は、上書きせずに別キーへ退避してから新しく始める
  if (isStale(card)) data.items[`${card.key}@${data.items[card.key].sig ?? 'legacy'}`] = data.items[card.key];
  if (data.items[card.key]?.sig !== sig) data.items[card.key] = { sig };
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
    set: SET,
    count: COUNT,
    words,
    overall: data.overall,
    // 評価の付いた案だけでなく全案を残す（エンジン変更後に同じ案かを照合できるように）
    items: cards.map((c) => { const { sig, ...it } = itemFor(c); return { key: c.key, word: c.word, index: c.index, cell: c.cell, label: c.label, seedId: c.seedId ?? null, colors: c.colors, ...it }; }),
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
  a.download = `eval-${new Date().toISOString().slice(0, 10)}${SET === 'rest' ? '-rest' : ''}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  localStorage.setItem(`${STORE}-exported`, String(ratedCount(data)));
});
$('reset').addEventListener('click', () => {
  if (!confirm('評価をすべて消します（消す直前の状態は控えに残すので、「控えから戻す」で戻せます）。よろしいですか？')) return;
  snapshot({ force: true });
  data = { items: {}, overall: {} };
  localStorage.setItem(STORE, JSON.stringify(data));
  location.reload();
});
$('snapshots').addEventListener('change', (e) => {
  const s = loadSnapshots()[Number(e.target.value)];
  e.target.value = '';
  if (!s) return;
  if (!confirm(`${new Date(s.at).toLocaleString('ja-JP')} の状態（${s.count}件評価済み）に戻します。今の状態は控えに残します。よろしいですか？`)) return;
  snapshot({ force: true });
  data = structuredClone(s.data);
  localStorage.setItem(STORE, JSON.stringify(data));
  reloading = true;
  location.reload();
});
// 書き出してから評価が増えたら、ページを閉じる前に知らせる
let reloading = false;
window.addEventListener('beforeunload', (e) => {
  if (!reloading && ratedCount(data) > (Number(localStorage.getItem(`${STORE}-exported`)) || 0)) e.preventDefault();
});

const [res, seedRes] = await Promise.all([fetch('../../src/vocab.json'), fetch('../../src/seeds.json')]);
render(buildIndex(await res.json(), await seedRes.json()));
renderSnapshots();
if (STORE_SUFFIX) $('progress').insertAdjacentText('afterend', `（保存先: ${STORE_SUFFIX}）`);
