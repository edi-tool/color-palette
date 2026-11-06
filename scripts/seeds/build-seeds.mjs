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

// 評価の結果をデータベースに戻す（ファイル名の順に読む。古い順）
// - データベースの配色そのもの（ラベルが「…「名前」」で終わる）に★ → その語のお墨付き（endorsed、先に出す）
// - データベースの配色そのものに微妙・悪い → その語から外す（ほかの語には残す）
// - ★の付いた案のうち、データベースに無いもの（変化形・自動生成・ラベルの無い古い書き出し）→ 新しい配色として取り込む
const byName = new Map(entries.map((e) => [e.name, e]));
if (byName.size !== entries.length) throw new Error('下書きの名前が重複しています');
const report = [];
const feedback = [];
let starTotal = 0;
const starCount = {};
const resDir = new URL('docs/eval/results/', ROOT);
for (const f of readdirSync(resDir).filter((x) => /^eval-.*\.json$/.test(x)).sort()) {
  const j = JSON.parse(readFileSync(new URL(f, resDir), 'utf8'));
  for (const it0 of j.items) {
    // 評価が無くても理由（濁る等）が付いていれば微妙として扱う。評価が付いていれば評価を優先する
    const it = !it0.rating && it0.tags?.length ? { ...it0, rating: 'meh' } : it0;
    const m = /× 「(.+?)」(.*)$/.exec(it.label ?? '');
    const seed = m && it.seedId && m[2] === '' ? byName.get(m[1]) : null;
    if (seed && (it.rating || it.star)) {
      if (it.rating && it.rating !== 'good' && seed.words.includes(it.word)) {
        seed.words = seed.words.filter((w) => w !== it.word);
        feedback.push(`− 外した: ${seed.name} から「${it.word}」（${f} で${it.rating === 'bad' ? '悪い' : '微妙'}）`);
      } else if (it.star && (!it.rating || it.rating === 'good')) {
        (seed.endorsed ??= []).includes(it.word) || seed.endorsed.push(it.word);
      }
    }
    if (it.star && !seed) {
      starTotal++;
      starCount[it.word] = (starCount[it.word] ?? 0) + 1;
      const e = { name: `${it.word}のお手本${starCount[it.word]}`, words: [it.word], endorsed: [it.word], colors: it.colors, src: `評価（${f}）でユーザーが★を付けた生成案（${it.key}${it.label ? `、${it.label}` : ''}）`, author: '配色提案さんの生成案からユーザーが選定' };
      entries.push(e);
      byName.set(e.name, e);
    }
  }
}

const out = [];
const ids = new Set();
for (const e of entries) {
  if (!e.words.length) { report.push(`× 載せない: ${e.name}（合う語がなくなった）`); continue; }
  for (const w of e.words) if (!vocab.words[w]) throw new Error(`辞書にない語: ${w}（${e.name}）`);
  const fixed = adaptSeed(e.colors);
  if (!fixed) { report.push(`× 載せない: ${e.name} ${seedIssues(e.colors).join(',')}`); continue; }
  const moved = ROLES.map((r) => [r, deltaE(e.colors[r], fixed[r])]).filter(([, d]) => d >= 3);
  if (moved.length) report.push(`△ 直した: ${e.name} ${moved.map(([r, d]) => `${r} ΔE${d.toFixed(1)}`).join(' ')}`);
  let id = `s-${String(out.length + 1).padStart(3, '0')}`;
  while (ids.has(id)) id += 'x';
  ids.add(id);
  const endorsed = (e.endorsed ?? []).filter((w) => e.words.includes(w));
  out.push({ id, name: e.name, words: e.words, ...(endorsed.length ? { endorsed } : {}), c: ROLES.map((r) => fixed[r]), src: e.src, author: e.author });
}

const perWord = {};
for (const s of out) for (const w of s.words) perWord[w] = (perWord[w] ?? 0) + 1;
console.log([...feedback, ...report].join('\n') || '直しなし');
console.log(`\nシード ${out.length} 件（下書き ${DRAFTS.length}、★から取り込み ${starTotal}、お墨付き ${out.filter((x) => x.endorsed).length}）`);
console.log(Object.keys(vocab.words).map((w) => `${w}:${perWord[w] ?? 0}`).join(' '));

if (!checkOnly) {
  const data = {
    _meta: {
      schemaVersion: 1,
      note: '監修する配色データベース。c は [メイン, サブ, 差し色, 背景, 文字]。words はこの配色が合う印象語（先頭が主）。endorsed は評価でユーザーが★を付けた語（その語で先に出す）。src は参考にした事例・出どころ。scripts/seeds/build-seeds.mjs で生成し、手で直さない（下書きは scripts/seeds/drafts.mjs）。',
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
