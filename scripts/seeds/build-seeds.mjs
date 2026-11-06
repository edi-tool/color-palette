// シード配色のデータベース（src/seeds.json）を作る。
// 入力: scripts/seeds/drafts.mjs（下書き）と、評価で★を付けた案（docs/eval/results/*.json）。
// 各シードは読みやすさの基準（adaptSeed）を通し、直した量を表示する。基準を満たせないシードは載せずに表示する。
// 使い方: node scripts/seeds/build-seeds.mjs   （--check で書き出さずに確認だけ）

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { DRAFTS } from './drafts.mjs';
import { adaptSeed, seedIssues } from '../../src/palette-engine.js';
import { deltaE, normalizeHex } from '../../src/color-utils.js';

const ROOT = new URL('../../', import.meta.url);
const ROLES = ['primary', 'secondary', 'accent', 'background', 'text'];
const vocab = JSON.parse(readFileSync(new URL('src/vocab.json', ROOT), 'utf8'));
const checkOnly = process.argv.includes('--check');

const entries = [];
for (const [name, words, ...rest] of DRAFTS) {
  const src = rest.pop();
  entries.push({ name, words, colors: Object.fromEntries(ROLES.map((r, i) => [r, normalizeHex(rest[i])])), src, author: 'Claude（AI）下書き・ユーザー監修前' });
}

// 評価で★を付けた案（同じ語・番号が複数ファイルにあれば後のファイルを採る）
const stars = new Map();
const resDir = new URL('docs/eval/results/', ROOT);
for (const f of readdirSync(resDir).filter((x) => /^eval-.*\.json$/.test(x)).sort()) {
  const j = JSON.parse(readFileSync(new URL(f, resDir), 'utf8'));
  for (const it of j.items) if (it.star) stars.set(it.key, { ...it, file: f });
}
const starCount = {};
for (const it of stars.values()) {
  starCount[it.word] = (starCount[it.word] ?? 0) + 1;
  entries.push({ name: `${it.word}のお手本${starCount[it.word]}`, words: [it.word], colors: it.colors, src: `評価（${it.file}）でユーザーが★を付けた生成案（${it.key}）`, author: '配色提案さんの生成案からユーザーが選定' });
}

const out = [];
const report = [];
const ids = new Set();
for (const e of entries) {
  for (const w of e.words) if (!vocab.words[w]) throw new Error(`辞書にない語: ${w}（${e.name}）`);
  const fixed = adaptSeed(e.colors);
  if (!fixed) { report.push(`× 載せない: ${e.name} ${seedIssues(e.colors).join(',')}`); continue; }
  const moved = ROLES.map((r) => [r, deltaE(e.colors[r], fixed[r])]).filter(([, d]) => d >= 3);
  if (moved.length) report.push(`△ 直した: ${e.name} ${moved.map(([r, d]) => `${r} ΔE${d.toFixed(1)}`).join(' ')}`);
  let id = `s-${String(out.length + 1).padStart(3, '0')}`;
  while (ids.has(id)) id += 'x';
  ids.add(id);
  out.push({ id, name: e.name, words: e.words, c: ROLES.map((r) => fixed[r]), src: e.src, author: e.author });
}

const perWord = {};
for (const s of out) for (const w of s.words) perWord[w] = (perWord[w] ?? 0) + 1;
console.log(report.join('\n') || '直しなし');
console.log(`\nシード ${out.length} 件（下書き ${DRAFTS.length}、★ ${stars.size}）`);
console.log(Object.keys(vocab.words).map((w) => `${w}:${perWord[w] ?? 0}`).join(' '));

if (!checkOnly) {
  const data = {
    _meta: {
      schemaVersion: 1,
      note: '監修する配色データベース。c は [メイン, サブ, 差し色, 背景, 文字]。words はこの配色が合う印象語（先頭が主）。src は参考にした事例・出どころ。scripts/seeds/build-seeds.mjs で生成し、手で直さない（下書きは scripts/seeds/drafts.mjs）。',
      license: 'MIT',
    },
    seeds: out,
  };
  const lines = ['{', `  "_meta": ${JSON.stringify(data._meta)},`, '  "seeds": ['];
  out.forEach((s, i) => lines.push(`    ${JSON.stringify(s)}${i < out.length - 1 ? ',' : ''}`));
  lines.push('  ]', '}', '');
  writeFileSync(new URL('src/seeds.json', ROOT), lines.join('\n'));
  console.log('→ src/seeds.json に書き出しました');
}
