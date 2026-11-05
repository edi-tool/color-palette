// アプリ状態。reduce は (state, action, ctx) → 新しい state の純粋関数。
// ctx = { index }（語彙インデックス）。乱数は seed 由来のみなので再現できる。

import { ROLES, normalizeHex } from './color-utils.js';
import { MAX_MOODS } from './semantic-model.js';
import { generateWide, generateDeep, reproposeUnlocked } from './palette-engine.js';
import { USAGES } from './export.js';

export const PAGE_SIZE = 24;
export const DEEP_SIZE = 12;
export const MAX_UNDO = 50;

export function initialState(seed = 14273) {
  return {
    moods: [], usage: 'general', mode: 'rgb', seed,
    searchMode: 'wide', pages: 0,
    candidates: [], selected: null, message: null,
  };
}

function wideUpTo(state, ctx, pages) {
  let list = [];
  for (let p = 0; p < pages; p++) {
    list = list.concat(generateWide({ index: ctx.index, moods: state.moods, mode: state.mode, seed: state.seed, page: p, count: PAGE_SIZE, exclude: list }));
  }
  return list;
}

function regenerate(state, ctx) {
  if (!state.moods.length) return { ...state, candidates: [], pages: 0, searchMode: 'wide', selected: null };
  return { ...state, candidates: wideUpTo(state, ctx, 1), pages: 1, searchMode: 'wide', selected: null, message: null };
}

function makeSelected(cand) {
  return { id: cand.id, base: cand, colors: { ...cand.colors }, locks: [], undo: [] };
}

function pushUndo(sel, next) {
  return { ...sel, ...next, undo: [...sel.undo, { colors: sel.colors, locks: sel.locks }].slice(-MAX_UNDO) };
}

export function reduce(state, action, ctx) {
  switch (action.type) {
    case 'setMoods': {
      const moods = [...new Set(action.moods)].slice(0, MAX_MOODS);
      // seed を渡すと候補の組み合わせが変わる（同じ印象語を押し直しても別の24案）。渡さなければ今の seed で再現する
      return regenerate({ ...state, moods, seed: Number.isInteger(action.seed) ? action.seed >>> 0 : state.seed }, ctx);
    }
    case 'setUsage':
      return USAGES[action.usage] ? { ...state, usage: action.usage, message: null } : state;
    case 'setMode': {
      if (action.mode !== 'rgb' && action.mode !== 'print') return state;
      return regenerate({ ...state, mode: action.mode }, ctx);
    }
    case 'regenerate':
      return regenerate({ ...state, seed: action.seed }, ctx);
    case 'loadMore': {
      if (!state.moods.length) return state;
      if (state.searchMode === 'deep' && state.selected) {
        const more = generateDeep({
          index: ctx.index, moods: state.moods, mode: state.mode, seed: state.seed, base: state.selected.base,
          count: DEEP_SIZE, page: state.pages, exclude: state.candidates,
        });
        return { ...state, candidates: [...state.candidates, ...more], pages: state.pages + 1 };
      }
      const more = generateWide({
        index: ctx.index, moods: state.moods, mode: state.mode, seed: state.seed, page: state.pages, count: PAGE_SIZE, exclude: state.candidates,
      });
      return { ...state, candidates: [...state.candidates, ...more], pages: state.pages + 1 };
    }
    case 'deepDive': {
      if (!state.selected) return state;
      const base = { ...state.selected.base, colors: { ...state.selected.colors } };
      const list = generateDeep({ index: ctx.index, moods: state.moods, mode: state.mode, seed: state.seed, base, count: DEEP_SIZE, page: 0, exclude: [] });
      const baseCand = { ...base, id: state.selected.id };
      return { ...state, searchMode: 'deep', pages: 1, candidates: [baseCand, ...list], selected: { ...state.selected, base: baseCand } };
    }
    case 'backToWide':
      return regenerate(state, ctx);
    case 'select': {
      const cand = state.candidates.find((c) => c.id === action.id);
      if (!cand) return state;
      if (state.selected?.id === cand.id) return state;
      return { ...state, selected: makeSelected(cand), message: null };
    }
    case 'deselect':
      return { ...state, selected: null, message: null };
    case 'editColor': {
      const sel = state.selected;
      if (!sel || !ROLES.includes(action.role)) return state;
      const hex = normalizeHex(action.hex);
      if (!hex) return { ...state, message: { kind: 'error', text: `「${action.hex}」はHEXとして読めません。例: #2E6598（直前の色を保持しました）` } };
      if (sel.colors[action.role] === hex) return { ...state, message: null };
      // 手動変更は該当役割だけ。他の役割は再計算しない。
      return { ...state, message: null, selected: pushUndo(sel, { colors: { ...sel.colors, [action.role]: hex } }) };
    }
    case 'toggleLock': {
      const sel = state.selected;
      if (!sel || !ROLES.includes(action.role)) return state;
      const locks = sel.locks.includes(action.role) ? sel.locks.filter((r) => r !== action.role) : [...sel.locks, action.role];
      return { ...state, selected: pushUndo(sel, { locks }) };
    }
    case 'repropose': {
      const sel = state.selected;
      if (!sel) return state;
      if (sel.locks.length >= ROLES.length) return { ...state, message: { kind: 'info', text: 'すべての色がロックされています。' } };
      const next = reproposeUnlocked({
        index: ctx.index, moods: state.moods, mode: state.mode, seed: action.seed ?? state.seed + sel.undo.length + 1,
        current: { cell: sel.base.cell, colors: sel.colors }, locks: sel.locks,
      });
      return { ...state, message: null, selected: pushUndo(sel, { colors: next.colors }) };
    }
    case 'undo': {
      const sel = state.selected;
      if (!sel || !sel.undo.length) return state;
      const prev = sel.undo[sel.undo.length - 1];
      return { ...state, message: null, selected: { ...sel, colors: prev.colors, locks: prev.locks, undo: sel.undo.slice(0, -1) } };
    }
    case 'resetToOriginal': {
      const sel = state.selected;
      if (!sel) return state;
      return { ...state, message: null, selected: pushUndo(sel, { colors: { ...sel.base.colors } }) };
    }
    case 'restore': {
      // URL からの復帰: 候補は seed から再生成し、編集内容を重ねる
      let s = { ...initialState(action.seed ?? state.seed), moods: (action.moods ?? []).slice(0, MAX_MOODS), usage: USAGES[action.usage] ? action.usage : 'general', mode: action.mode === 'print' ? 'print' : 'rgb' };
      if (!s.moods.length) return s;
      const pages = Math.max(1, Math.min(action.pages ?? 1, 10));
      s = { ...s, candidates: wideUpTo(s, ctx, pages), pages };
      const cand = s.candidates.find((c) => c.id === action.sel);
      if (cand) {
        let sel = makeSelected(cand);
        const colors = { ...sel.colors };
        for (const r of ROLES) { const h = normalizeHex(action.colors?.[r]); if (h) colors[r] = h; }
        sel = { ...sel, colors, locks: (action.locks ?? []).filter((r) => ROLES.includes(r)) };
        s = { ...s, selected: sel };
      }
      return s;
    }
    default:
      return state;
  }
}

/** コピー・エクスポート用に、選択中の最新値を1つのオブジェクトにまとめる */
export function exportView(state) {
  if (!state.selected) return null;
  return {
    moods: state.moods, usage: state.usage, mode: state.mode, seed: state.seed,
    colors: state.selected.colors, locks: state.selected.locks,
  };
}
