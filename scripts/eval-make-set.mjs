// 評価の組を作る: 今のエンジンが出す案のうち、これまでの評価（docs/eval/results/*.json）で見ていないものを集めて
// docs/eval/sets/<名前>.json に書き出す。評価ページ（docs/eval/?file=<名前>）がこのファイルを読む。
// 同じ語・同じ5色の案は評価済みとみなす（評価・★・理由のどれかが付いたもの）。
// 使い方: node scripts/eval-make-set.mjs <名前> [--pages 1] [--seed 20261106]

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildIndex } from '../src/semantic-model.js';
import { generateWide } from '../src/palette-engine.js';

const ROOT = new URL('../', import.meta.url);
const args = process.argv.slice(2);
const name = args[0];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('使い方: node scripts/eval-make-set.mjs <名前（英小文字・数字・-）> [--pages 1] [--seed 20261106]');
  process.exit(1);
}
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const pages = opt('--pages', 1);
const seed = opt('--seed', 20261106);

const index = buildIndex(
  JSON.parse(readFileSync(new URL('src/vocab.json', ROOT), 'utf8')),
  JSON.parse(readFileSync(new URL('src/seeds.json', ROOT), 'utf8')),
);
const sig = (c) => [c.primary, c.secondary, c.accent, c.background, c.text].join('');
const seen = new Set();
const resDir = new URL('docs/eval/results/', ROOT);
for (const f of readdirSync(resDir).filter((x) => /^eval-.*\.json$/.test(x))) {
  for (const it of JSON.parse(readFileSync(new URL(f, resDir), 'utf8')).items) {
    if (it.rating || it.star || it.tags?.length) seen.add(`${it.word}|${sig(it.colors)}`);
  }
}

const items = [];
const perWord = [];
for (const word of index.names) {
  let list = [];
  for (let page = 0; page < pages; page++) list = list.concat(generateWide({ index, moods: [word], seed, page, count: 24, exclude: list }));
  const unseen = list.map((p, i) => ({ p, i })).filter(({ p }) => !seen.has(`${word}|${sig(p.colors)}`));
  unseen.forEach(({ p, i }) => items.push({ key: `${word}#${i}`, word, index: i, cell: p.cell, label: p.label, seedId: p.seedId ?? null, colors: p.colors }));
  perWord.push(`${word}:${unseen.length}`);
}
mkdirSync(new URL('docs/eval/sets/', ROOT), { recursive: true });
writeFileSync(new URL(`docs/eval/sets/${name}.json`, ROOT), JSON.stringify({ schema: 'color-palette-eval-set/1', name, seed, pages, createdAt: new Date().toISOString(), items }, null, 1) + '\n');
console.log(perWord.join(' '));
console.log(`→ docs/eval/sets/${name}.json（${items.length}案、うち自動生成 ${items.filter((x) => !x.seedId).length}）`);
