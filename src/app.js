// 画面の配線。状態の更新は state.js の reduce、文面は export.js、生成は palette-engine.js に任せ、
// ここでは DOM の描画とイベントだけを扱う。

import { buildIndex, resolveTerm, MAX_MOODS, HUE_FAMILIES } from './semantic-model.js';
import { initialState, reduce, exportView, PAGE_SIZE, DEEP_SIZE } from './state.js';
import { FORMATS, USAGES, ROLE_LABEL, formatFor } from './export.js';
import { ROLES, normalizeHex } from './color-utils.js';
import { contrastInfo, suggestTextFix } from './palette-engine.js';
import { VISION_TYPES, simulateColors } from './vision.js';
import { visionNote } from './export.js';
import { encodeState, decodeState } from './url-state.js';
import { PRINT_NOTICE } from './print-profile.js';

const $ = (id) => document.getElementById(id);
const wideQuery = window.matchMedia('(min-width: 960px)');

let ctx;
let state = initialState();
let format = 'simple';
let vision = 'normal'; // 補助欄の色帯の見え方（表示だけ。色の正本も見本も変えない）
let sheetOpen = false;
let rendered = []; // 描画済みの候補（state.candidates の要素）
let renderToken = 0;
let lastFocusId = null;

/* ---------- 起動 ---------- */
async function init() {
  buildStatic();
  try {
    const res = await fetch('src/vocab.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ctx = { index: buildIndex(await res.json()) };
  } catch (e) {
    // 取得失敗を「候補なし」と見せない
    $('empty').textContent = `語彙辞書を読み込めませんでした（${e.message}）。ページを再読み込みしてください。`;
    $('empty').classList.add('msg', 'error');
    return;
  }
  buildMoodChips();
  buildHueChips();
  const d = decodeState(location.hash, { validMoods: ctx.index.names });
  if (d) state = reduce(initialState(), { type: 'restore', ...d }, ctx);
  render();
}

// 印象語を押すたびに新しい seed にする（同じ語でも毎回違う候補）。seed は URL に残るので、共有・再読み込みでは再現できる
const newSeed = () => Math.floor(Math.random() * 2 ** 32);

function dispatch(action) {
  state = reduce(state, action, ctx);
  render();
  syncUrl();
}

function syncUrl() {
  const frag = state.moods.length ? '#' + encodeState(state) : '';
  history.replaceState(null, '', location.pathname + location.search + frag);
}

/* ---------- 静的部品 ---------- */
function buildStatic() {
  $('usage').innerHTML = Object.entries(USAGES).map(([k, u]) => `<option value="${k}">${u.label}</option>`).join('');
  $('vision-tabs').innerHTML = [['normal', '一般的な色覚'], ...Object.entries(VISION_TYPES).map(([k, v]) => [k, v.label])]
    .map(([k, label]) => `<button type="button" class="fmt" data-vision="${k}" aria-pressed="${k === vision}">${label}</button>`).join('');
  $('format-tabs').innerHTML = Object.entries(FORMATS)
    .map(([k, label]) => `<button type="button" class="fmt" data-format="${k}" aria-pressed="${k === format}">${label}</button>`).join('');
  $('roles').innerHTML = ROLES.map((r) => `
    <li class="role" data-role="${r}">
      <span class="role-sw" aria-hidden="true"></span>
      <span class="role-name">${ROLE_LABEL[r]}</span>
      <span class="role-ctl">
        <input type="text" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="characters" aria-label="${ROLE_LABEL[r]}のHEX" data-hex>
        <input type="color" aria-label="${ROLE_LABEL[r]}をカラーピッカーで選ぶ" data-picker>
        <button type="button" class="lock" aria-pressed="false" data-lock aria-label="${ROLE_LABEL[r]}をロック">ロック</button>
      </span>
    </li>`).join('');
}

// 用途ごとに生成で何が変わるかの説明（palette-engine の USAGE_TUNING と対応）
const USAGE_NOTE = {
  general: '標準の設定で候補を作ります。',
  'book-cover': '色のついた地（背景）を使い、タイトル用のメインを濃くします。',
  flyer: '彩度を上げ、遠目でも目立つメイン・差し色にします。',
  'teaching-material': '淡い紙面にし、本文のコントラスト 7:1 以上、P型・D型で見分けにくい案を除きます（目安）。',
  web: '差し色をボタン等に使えるよう、背景とのコントラスト 3:1 以上にします。',
};

function buildHueChips() {
  $('hue-chips').innerHTML = [['', '指定なし', null], ...Object.entries(HUE_FAMILIES).map(([k, f]) => [k, f.label, f.swatch])]
    .map(([k, label, sw]) => `<button type="button" class="chip hue-chip" data-hue="${k}" aria-pressed="false">${sw ? `<span class="hue-dot" style="background:${sw}" aria-hidden="true"></span>` : ''}${label}</button>`).join('');
}

function buildMoodChips() {
  $('mood-chips').innerHTML = ctx.index.names
    .map((n) => `<button type="button" class="chip" data-mood="${n}" aria-pressed="false">${n}</button>`).join('');
}

/* ---------- 描画 ---------- */
function render() {
  renderControls();
  renderGrid();
  renderDetail();
}

function renderControls() {
  const full = state.moods.length >= MAX_MOODS;
  for (const b of $('mood-chips').children) {
    const on = state.moods.includes(b.dataset.mood);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = full && !on;
  }
  $('mood-summary').textContent = state.moods.length
    ? `選択中: ${state.moods.join('、')}（タップで変更）`
    : '印象語を選ぶ（最大3つ）';
  $('usage').value = state.usage;
  $('usage-note').textContent = USAGE_NOTE[state.usage] ?? '';
  for (const b of $('hue-chips').children) b.setAttribute('aria-pressed', String((b.dataset.hue || null) === state.hue));
  document.querySelectorAll('input[name="mode"]').forEach((r) => { r.checked = r.value === state.mode; });
  $('print-notice').hidden = state.mode !== 'print';
  $('print-notice').textContent = PRINT_NOTICE;
  $('btn-regenerate').disabled = !state.moods.length;
  const n = state.candidates.length;
  $('count').textContent = n ? `${n}案` : '';
  $('empty').hidden = n > 0;
  if (!n && ctx) $('empty').textContent = state.moods.length ? '条件に合う候補が作れませんでした。別の印象語を試してください。' : '印象語を選ぶと、ここに24案が並びます。暖色・寒色・無彩色など、方向性の違う案を意図的に混ぜています。';
  $('btn-more').hidden = !n;
  $('btn-more').textContent = state.searchMode === 'deep' ? '近い案をもっと見る' : 'さらに24案（別の方向ももっと見る）';
  $('deep-banner').hidden = state.searchMode !== 'deep';
}

const colorsFor = (cand) => (state.selected?.id === cand.id ? state.selected.colors : cand.colors);

function paintCard(btn, cand) {
  const c = colorsFor(cand);
  const on = state.selected?.id === cand.id;
  btn.style.cssText = `--bg:${c.background};--p:${c.primary};--s:${c.secondary};--a:${c.accent};--t:${c.text}`;
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', `${cand.label}。メイン${c.primary}、サブ${c.secondary}、差し色${c.accent}、背景${c.background}、文字${c.text}。${on ? '選択中' : '選ぶ'}`);
  const st = btn.querySelector('.card-state');
  st.textContent = on ? '選択中' : '';
  st.dataset.icon = on ? 'check' : '';
  const sw = btn.querySelectorAll('.card-sw span');
  [c.background, c.primary, c.secondary, c.accent, c.text].forEach((hex, i) => { sw[i].style.background = hex; });
}

function makeCard(cand) {
  const li = document.createElement('li');
  li.innerHTML = `<button type="button" class="card" data-id="${cand.id}">
      <span class="card-prev" style="background:var(--bg)"><span class="cp-band"></span><span class="cp-title">Aa 見出し</span><span class="cp-sub">本文サンプル</span><span class="cp-dot"></span></span>
      <span class="card-sw" aria-hidden="true"><span style="flex:4"></span><span style="flex:3"></span><span style="flex:2"></span><span style="flex:1"></span><span style="flex:1"></span></span>
      <span class="card-label">${cand.label}</span>
      <span class="card-state"></span>
    </button>`;
  paintCard(li.firstElementChild, cand);
  return li;
}

function renderGrid() {
  const list = state.candidates;
  const grid = $('grid');
  // 先頭から一致していなければ作り直し。追加分だけなら既存カードをそのまま残す。
  // id は (seed, page, 順番) なので、印象語や出力想定を変えても同じ id になる。id ではなく候補そのもので比べる。
  const mismatch = rendered.length > list.length || rendered.some((cand, i) => cand !== list[i]);
  if (mismatch) {
    renderToken++;
    grid.innerHTML = '';
    rendered = [];
  }
  // 既存カードの選択状態・色を更新
  for (const btn of grid.querySelectorAll('.card')) {
    const cand = list.find((c) => c.id === btn.dataset.id);
    if (cand) paintCard(btn, cand);
  }
  const token = ++renderToken;
  const pending = list.slice(rendered.length);
  // 段階描画: 1フレーム12枚ずつ。低性能端末でも操作が止まらないようにする
  const step = () => {
    if (token !== renderToken) return;
    const frag = document.createDocumentFragment();
    for (const cand of pending.splice(0, 12)) {
      frag.appendChild(makeCard(cand));
      rendered.push(cand);
    }
    grid.appendChild(frag);
    if (pending.length) requestAnimationFrame(step);
  };
  if (pending.length) step();
}

function renderDetail() {
  const sel = state.selected;
  const detail = $('detail');
  const open = !!sel && sheetOpen && !wideQuery.matches;
  detail.classList.toggle('is-open', open);
  $('backdrop').hidden = !open;
  document.body.classList.toggle('sheet-open', open);
  detail.setAttribute('role', open ? 'dialog' : 'complementary');
  detail.setAttribute('aria-modal', String(open));
  // シートを開いている間は背後を操作・読み上げの対象から外す（Tab がシートの外へ出ないように）
  for (const el of document.querySelectorAll('.site-header, .controls, .results, .site-footer')) el.inert = open;
  $('detail-placeholder').hidden = !!sel;
  $('detail-body').hidden = !sel;
  if (!sel) return;

  const edited = ROLES.some((r) => sel.colors[r] !== sel.base.colors[r]);
  $('detail-label').textContent = `${sel.base.label}${edited ? '・編集済み' : ''}`;
  for (const li of $('roles').children) {
    const r = li.dataset.role;
    const hex = sel.colors[r];
    li.querySelector('.role-sw').style.background = hex;
    const hexInput = li.querySelector('[data-hex]');
    if (document.activeElement !== hexInput) hexInput.value = hex;
    li.querySelector('[data-picker]').value = hex.toLowerCase();
    const locked = sel.locks.includes(r);
    const lock = li.querySelector('[data-lock]');
    lock.setAttribute('aria-pressed', String(locked));
    lock.textContent = locked ? 'ロック中' : 'ロック';
    lock.dataset.icon = locked ? 'lock' : '';
  }
  const mock = $('mock');
  const c = sel.colors;
  mock.style.cssText = `--bg:${c.background};--p:${c.primary};--s:${c.secondary};--a:${c.accent};--t:${c.text}`;

  // 補助: 色覚の見え方（たたんだ欄の中の色帯だけをシミュレーション表示する）
  const vn = visionNote(c);
  $('vision-summary').textContent = vn ? '色覚の見え方（補助）: 見分けにくい組み合わせあり' : '色覚の見え方を確かめる（補助）';
  $('vision-summary').dataset.icon = vn ? 'warn' : '';
  $('vision-summary').classList.toggle('warn', !!vn);
  for (const b of $('vision-tabs').children) b.setAttribute('aria-pressed', String(b.dataset.vision === vision));
  const mc = simulateColors(c, vision);
  $('vision-strip').innerHTML = ROLES.map((r) => `<span style="background:${mc[r]}"><b>${ROLE_LABEL[r]}</b></span>`).join('');
  const ve = $('vision');
  ve.className = 'vision-note' + (vn ? ' warn' : '');
  ve.dataset.icon = vn ? 'warn' : '';
  ve.textContent = (vn ? `${vn.text}。色だけで区別させない工夫を。` : 'シミュレーションでは、主な色の組み合わせは見分けられます（目安）。')
    + (vision === 'normal' ? '' : ` 上の帯は${VISION_TYPES[vision].label}のシミュレーションです（HEXは変わりません）。`);
  mock.dataset.usage = state.usage;

  const ci = contrastInfo(c);
  const el = $('contrast');
  el.className = 'contrast' + (ci.passAA ? '' : ' warn');
  el.dataset.icon = ci.passAA ? 'ok' : 'warn';
  el.textContent = ci.passAA
    ? `文字と背景のコントラスト比 ${ci.ratio.toFixed(1)}:1（目安の 4.5:1 以上）`
    : `文字と背景のコントラスト比 ${ci.ratio.toFixed(1)}:1（目安 4.5:1 に届きません）`;
  if (!ci.passAA) {
    const fix = document.createElement('button');
    fix.type = 'button';
    fix.className = 'btn btn-small fix';
    fix.textContent = `文字色を ${suggestTextFix(c)} にする（提案）`;
    fix.addEventListener('click', () => dispatch({ type: 'editColor', role: 'text', hex: suggestTextFix(state.selected.colors) }));
    el.appendChild(fix);
  }

  const msg = $('msg');
  msg.textContent = state.message?.text ?? '';
  msg.className = 'msg' + (state.message?.kind === 'error' ? ' error' : '');

  $('btn-undo').disabled = !sel.undo.length;
  $('btn-reset').disabled = !edited;
  $('btn-repropose').disabled = sel.locks.length >= ROLES.length;
  $('btn-deep').hidden = state.searchMode === 'deep';

  for (const b of $('format-tabs').children) b.setAttribute('aria-pressed', String(b.dataset.format === format));
  $('export-preview').textContent = formatFor(format, exportView(state));
  if (!$('btn-copy').dataset.flash) $('btn-copy').textContent = format === 'simple' ? 'AIに渡す配色指示をコピー' : `「${FORMATS[format]}」をコピー`;
}

/* ---------- コピー ---------- */
let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/** 読み上げだけの通知（押したボタンの中で結果を見せるときに使う） */
function announce(text) {
  let live = document.getElementById('et-live');
  if (!live) { live = document.createElement('p'); live.id = 'et-live'; live.className = 'et-live'; live.setAttribute('role', 'status'); document.body.append(live); }
  live.textContent = text;
}

async function copyNow() {
  const view = exportView(state);
  if (!view) return;
  // コピー直前の最新の状態から毎回つくる
  const text = formatFor(format, view);
  let ok = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API なし');
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = false;
  }
  const btn = $('btn-copy');
  if (ok) {
    $('copy-fallback').hidden = true;
    announce(`コピーしました（${FORMATS[format]}）`);
    btn.dataset.flash = '1';
    btn.innerHTML = '<span class="et-i et-i-check" aria-hidden="true"></span>コピーしました';
    setTimeout(() => { delete btn.dataset.flash; renderDetail(); }, 1600);
  } else {
    const ta = $('copy-text');
    $('copy-fallback').hidden = false;
    ta.value = text;
    ta.focus();
    ta.select();
    toast('自動コピーできませんでした。表示した文を選んでコピーしてください');
  }
}

/* ---------- 言葉検索 ---------- */
function renderSearch() {
  const box = $('search-result');
  const q = $('mood-search').value;
  box.textContent = '';
  if (!q.trim()) return;
  const { word, suggestions } = resolveTerm(ctx.index, q);
  const addBtn = (name, prefix) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-small';
    b.dataset.addMood = name;
    b.textContent = `${prefix}${name}`;
    b.disabled = state.moods.includes(name) || state.moods.length >= MAX_MOODS;
    box.appendChild(b);
  };
  if (word) {
    const s = document.createElement('span');
    s.textContent = `「${q}」は `;
    box.appendChild(s);
    addBtn(word, '＋ ');
    if (state.moods.length >= MAX_MOODS) box.append(' （3つまで選べます）');
  } else if (suggestions.length) {
    box.append('辞書にない言葉です。近い印象語: ');
    suggestions.forEach((n) => addBtn(n, '＋ '));
  } else {
    box.textContent = '辞書にない言葉です。上の一覧から近い印象を選んでください。';
  }
}

function addMood(name) {
  if (!name || state.moods.includes(name) || state.moods.length >= MAX_MOODS) return;
  dispatch({ type: 'setMoods', moods: [...state.moods, name], seed: newSeed() });
  $('mood-search').value = '';
  renderSearch();
}

/* ---------- シート ---------- */
function openSheet() {
  sheetOpen = true;
  renderDetail();
  if (!wideQuery.matches) $('detail').focus({ preventScroll: true });
}
function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false;
  renderDetail();
  const btn = lastFocusId && document.querySelector(`.card[data-id="${CSS.escape(lastFocusId)}"]`);
  btn?.focus({ preventScroll: true }); // スクロール位置は動かさず、元のカードへ戻る
}

/* ---------- イベント ---------- */
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element) || !ctx) return;
  const chip = t.closest('[data-mood]');
  if (chip) {
    const n = chip.dataset.mood;
    const moods = state.moods.includes(n) ? state.moods.filter((m) => m !== n) : [...state.moods, n];
    dispatch({ type: 'setMoods', moods, seed: newSeed() });
    renderSearch();
    return;
  }
  const hueChip = t.closest('[data-hue]');
  if (hueChip) return dispatch({ type: 'setHue', hue: hueChip.dataset.hue || null, seed: newSeed() });
  const add = t.closest('[data-add-mood]');
  if (add) return addMood(add.dataset.addMood);
  const card = t.closest('.card');
  if (card) {
    lastFocusId = card.dataset.id;
    dispatch({ type: 'select', id: card.dataset.id });
    openSheet();
    return;
  }
  const vis = t.closest('[data-vision]');
  if (vis) { vision = vis.dataset.vision; renderDetail(); return; }
  const fmt = t.closest('[data-format]');
  if (fmt) { format = fmt.dataset.format; $('copy-fallback').hidden = true; renderDetail(); return; }
  const lock = t.closest('[data-lock]');
  if (lock) return dispatch({ type: 'toggleLock', role: lock.closest('.role').dataset.role });
});

$('btn-copy').addEventListener('click', copyNow);
$('btn-close').addEventListener('click', closeSheet);
$('backdrop').addEventListener('click', closeSheet);
$('btn-regenerate').addEventListener('click', () => dispatch({ type: 'regenerate', seed: newSeed() }));
$('btn-more').addEventListener('click', () => {
  const before = state.candidates.length;
  dispatch({ type: 'loadMore' });
  const added = state.candidates.length - before;
  // 似た案しか作れないときは増えない。黙って何も起きないように見せない
  if (!added) toast('これ以上、十分に違う案は作れませんでした。印象語を変えるか「別の案を出す」を試してください');
  else if (added < (state.searchMode === 'deep' ? DEEP_SIZE : PAGE_SIZE)) toast(`${added}案を追加しました（似た案を除いたため少なめです）`);
});
$('btn-to-results').addEventListener('click', () => $('h-results').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('btn-repropose').addEventListener('click', () => dispatch({ type: 'repropose' }));
$('btn-undo').addEventListener('click', () => dispatch({ type: 'undo' }));
$('btn-reset').addEventListener('click', () => dispatch({ type: 'resetToOriginal' }));
$('btn-deep').addEventListener('click', () => { dispatch({ type: 'deepDive' }); toast('選んだ配色に近い系統を表示しました'); });
$('btn-wide').addEventListener('click', () => dispatch({ type: 'backToWide' }));
$('usage').addEventListener('change', (e) => {
  dispatch({ type: 'setUsage', usage: e.target.value });
  if (state.moods.length) toast(state.selected ? '用途に合わせて候補を作り直しました（選択中の配色はそのまま）' : '用途に合わせて候補を作り直しました');
});
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', (e) => { if (e.target.checked) dispatch({ type: 'setMode', mode: e.target.value }); }));

// 日本語 IME の変換中は確定処理を走らせない
const search = $('mood-search');
search.addEventListener('input', (e) => { if (!e.isComposing && ctx) renderSearch(); });
search.addEventListener('compositionend', () => { if (ctx) renderSearch(); });
search.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || !ctx) return;
  const { word } = resolveTerm(ctx.index, search.value);
  if (word) addMood(word);
});

// 色の編集（確定時のみ反映。入力途中の値では状態を変えない）
$('roles').addEventListener('change', (e) => {
  const t = e.target;
  const li = t.closest('.role');
  if (!li || !state.selected) return;
  const role = li.dataset.role;
  if (t.matches('[data-hex]')) {
    dispatch({ type: 'editColor', role, hex: t.value });
    t.value = state.selected.colors[role]; // 不正値は直前の正常値に戻す
  } else if (t.matches('[data-picker]')) {
    dispatch({ type: 'editColor', role, hex: normalizeHex(t.value) });
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen && !wideQuery.matches) closeSheet(); });
wideQuery.addEventListener('change', () => renderDetail());

init();
