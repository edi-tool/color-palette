// URL フラグメントへの状態の保存・復帰。サーバーには送られない（# 以降）。
// 形式を変えるときは v を上げ、旧形式の読み取りを残す（互換性）。

import { ROLES, normalizeHex } from './color-utils.js';

export const URL_VERSION = 1;

export function encodeState(state) {
  const p = new URLSearchParams();
  p.set('v', String(URL_VERSION));
  if (state.moods.length) p.set('m', state.moods.join(','));
  p.set('u', state.usage);
  p.set('mode', state.mode);
  p.set('s', String(state.seed));
  if (state.searchMode === 'wide' && state.pages > 1) p.set('pg', String(state.pages));
  // 深掘りは再現対象外（幅広い一覧と選択のみ保存）
  if (state.selected && state.searchMode === 'wide') {
    p.set('sel', state.selected.id);
    p.set('c', ROLES.map((r) => state.selected.colors[r].slice(1)).join('-'));
    if (state.selected.locks.length) p.set('l', state.selected.locks.join(','));
  }
  return p.toString();
}

/** 失敗しても例外にせず、読めた分だけ返す。語彙に無い印象語は index があれば除外する。 */
export function decodeState(fragment, { validMoods } = {}) {
  const p = new URLSearchParams(String(fragment ?? '').replace(/^#/, ''));
  if (!p.get('v')) return null;
  const out = {};
  const moods = (p.get('m') ?? '').split(',').filter(Boolean);
  out.moods = validMoods ? moods.filter((m) => validMoods.includes(m)) : moods;
  out.usage = p.get('u') ?? 'general';
  out.mode = p.get('mode') === 'print' ? 'print' : 'rgb';
  const seed = Number(p.get('s'));
  if (Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32) out.seed = seed;
  const pg = Number(p.get('pg'));
  out.pages = Number.isInteger(pg) && pg >= 1 ? Math.min(pg, 10) : 1;
  if (p.get('sel')) out.sel = p.get('sel');
  const c = (p.get('c') ?? '').split('-');
  if (c.length === ROLES.length) {
    out.colors = {};
    ROLES.forEach((r, i) => { const h = normalizeHex(c[i]); if (h) out.colors[r] = h; });
  }
  out.locks = (p.get('l') ?? '').split(',').filter((r) => ROLES.includes(r));
  return out;
}
