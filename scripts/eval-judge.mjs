// Claude による事前判定: これまでのユーザー評価（docs/eval/results/*.json）を手がかりに、未評価の案を
// 「良さそう」「微妙の可能性（要確認）」「判断材料が少ない（要確認）」に分ける。印象の正解を主張しない。
// 手がかり: ①似た評価済みの案（同じ語は強く、別の語は弱く）②評価から読み取れた傾向（下の RULES）③出どころ（自動生成は控えめ）
// 使い方:
//   node scripts/eval-judge.mjs --calibrate          評価済みの案で「1件ずつ伏せて当てる」試しをし、合う度合いを出す
//   node scripts/eval-judge.mjs <組の名前>            docs/eval/sets/<名前>.json を判定し、docs/eval/sets/<名前>-judged.json に書く

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { paletteDistance } from '../src/palette-engine.js';
import { hexToOklch, contrastRatio } from '../src/color-utils.js';

const ROOT = new URL('../', import.meta.url);
const sig = (c) => [c.primary, c.secondary, c.accent, c.background, c.text].join('');
const o = (h) => hexToOklch(h);

// 評価済みの案（同じ語・同じ5色は後のファイルの評価を採る）
const rated = new Map();
const resDir = new URL('docs/eval/results/', ROOT);
for (const f of readdirSync(resDir).filter((x) => /^eval-.*\.json$/.test(x)).sort()) {
  for (const it0 of JSON.parse(readFileSync(new URL(f, resDir), 'utf8')).items) {
    const rating = it0.rating ?? (it0.tags?.length ? 'meh' : it0.star ? 'good' : null);
    if (!rating) continue;
    rated.set(`${it0.word}|${sig(it0.colors)}`, { word: it0.word, colors: it0.colors, rating, star: !!it0.star, label: it0.label ?? '', seedId: it0.seedId ?? null, file: f, key: it0.key });
  }
}
const ratedList = [...rated.values()];

// 評価から読み取れた傾向（docs/eval/2026-11-06-findings.md）。当てはまると減点し、理由として表示する
const RULES = [
  {
    id: 'yasashii-dusty', text: 'やさしいで、くすんだ・灰みの色（評価では澄んだ淡い色が好まれた）',
    test: (w, c) => w === 'やさしい' && ['primary', 'secondary'].some((r) => { const x = o(c[r]); return x.C < 0.05 && x.L > 0.35 && x.L < 0.85; }),
  },
  {
    id: 'dark-pastel', text: '濃い地に淡いピンク・紫のメイン（「夜会」「ボルドー地にシャンパン」が微妙だった型）',
    test: (w, c) => { const b = o(c.background); const p = o(c.primary); return b.L < 0.3 && p.L > 0.78 && p.C > 0.03 && p.C < 0.12 && (p.h > 280 || p.h < 20); },
  },
  {
    id: 'sub-dark-on-light', text: '淡い地に暗いサブ（1回目の「読みにくい」の型）',
    test: (w, c) => o(c.background).L > 0.5 && o(c.secondary).L < 0.5,
  },
  {
    id: 'muddy', text: '濁りやすい中間の明るさ・低い彩度の色が2色以上',
    test: (w, c) => ['primary', 'secondary', 'accent'].filter((r) => { const x = o(c[r]); return x.C > 0.03 && x.C < 0.075 && x.L > 0.42 && x.L < 0.72; }).length >= 2,
  },
  {
    id: 'weak-contrast', text: 'サブの上の本文が読みにくい（4.5:1 未満）',
    test: (w, c) => contrastRatio(c.text, c.secondary) < 4.5,
  },
];

const NEAR = 14; // これより近い評価済みの案を「似た案」とみなす（パレット間距離）
const VAL = { good: 1, meh: -1.6, bad: -2.2 };

/** 1案を判定する。skip に評価済みの案のキーを渡すと、その案を手がかりから外す（試し用） */
function judge(word, colors, { label = '', seedId = null } = {}, skip = null) {
  let score = 0;
  const evidence = [];
  for (const r of ratedList) {
    if (skip && `${r.word}|${sig(r.colors)}` === skip) continue;
    const d = paletteDistance(colors, r.colors);
    if (d > NEAR) continue;
    const near = 1 - d / (NEAR + 1);
    const weight = (r.word === word ? 1 : 0.35) * near * (r.star ? 1.3 : 1);
    score += VAL[r.rating] * weight;
    if (weight > 0.25) evidence.push({ word: r.word, rating: r.rating, star: r.star, label: r.label, d: Math.round(d * 10) / 10 });
  }
  const hits = RULES.filter((x) => x.test(word, colors));
  score -= hits.length * 1.2;
  const auto = !seedId;
  if (auto) score -= 0.6;
  const support = evidence.filter((e) => e.word === word).length;
  let verdict;
  if (score <= -0.6 || hits.length) verdict = 'maybe-meh';
  else if (score >= 0.9 && (support || !auto)) verdict = 'good';
  else verdict = 'unsure';
  evidence.sort((a, b) => a.d - b.d);
  return { verdict, score: Math.round(score * 100) / 100, rules: hits.map((h) => h.text), evidence: evidence.slice(0, 4), auto };
}

if (process.argv.includes('--sweep')) {
  // 「良さそう」とする点の下限を動かし、微妙を拾える割合と、確認に回す割合の関係を見る
  const rows = ratedList.map((r) => ({ meh: r.rating !== 'good', j: judge(r.word, r.colors, r, `${r.word}|${sig(r.colors)}`), file: r.file }));
  for (const th of [0.9, 1.5, 2, 3, 4, 5, 6, 8]) {
    const flagged = (x) => x.j.rules.length || x.j.score < th;
    const m = rows.filter((x) => x.meh); const g = rows.filter((x) => !x.meh);
    console.log(`下限 ${th}: 微妙を拾う ${m.filter(flagged).length}/${m.length}  良いを確認に回す ${g.filter(flagged).length}/${g.length}  確認の割合 ${Math.round(rows.filter(flagged).length / rows.length * 100)}%`);
  }
  for (const f of [...new Set(rows.map((x) => x.file))]) {
    const m = rows.filter((x) => x.meh && x.file === f);
    console.log(f, '微妙', m.length, '点の中央値', m.map((x) => x.j.score).sort((a, b) => a - b)[Math.floor(m.length / 2)]);
  }
  process.exit(0);
}

if (process.argv.includes('--calibrate')) {
  // 1件ずつ伏せて当てる。微妙・悪い（以下「微妙」）をどれだけ拾えるかと、良いを誤って確認に回す割合を見る
  const tally = { good: { good: 0, 'maybe-meh': 0, unsure: 0 }, meh: { good: 0, 'maybe-meh': 0, unsure: 0 } };
  for (const r of ratedList) {
    const v = judge(r.word, r.colors, r, `${r.word}|${sig(r.colors)}`).verdict;
    tally[r.rating === 'good' ? 'good' : 'meh'][v]++;
  }
  const sum = (t) => t.good + t['maybe-meh'] + t.unsure;
  const g = tally.good; const m = tally.meh;
  console.log(`評価済み ${ratedList.length} 件（良い ${sum(g)}、微妙・悪い ${sum(m)}）`);
  console.log(`微妙・悪いを「確認が要る」に回せた: ${m['maybe-meh'] + m.unsure}/${sum(m)}（${Math.round(((m['maybe-meh'] + m.unsure) / sum(m)) * 100)}%）。うち「微妙の可能性」と当てた: ${m['maybe-meh']}`);
  console.log(`微妙・悪いを「良さそう」と見逃した: ${m.good}/${sum(m)}`);
  console.log(`良いを「良さそう」と判定: ${g.good}/${sum(g)}（${Math.round((g.good / sum(g)) * 100)}%）。確認に回した良い: ${g['maybe-meh'] + g.unsure}`);
  console.log(`確認に回す割合（全体）: ${Math.round(((g['maybe-meh'] + g.unsure + m['maybe-meh'] + m.unsure) / ratedList.length) * 100)}%`);
  process.exit(0);
}

const name = process.argv[2];
if (!name) { console.error('使い方: node scripts/eval-judge.mjs --calibrate | <組の名前>'); process.exit(1); }
const set = JSON.parse(readFileSync(new URL(`docs/eval/sets/${name}.json`, ROOT), 'utf8'));
const out = set.items.map((it) => ({ ...it, judge: judge(it.word, it.colors, it) }));
const n = (v) => out.filter((x) => x.judge.verdict === v).length;
writeFileSync(new URL(`docs/eval/sets/${name}-judged.json`, ROOT), JSON.stringify({ ...set, judgedAt: new Date().toISOString(), items: out }, null, 1) + '\n');
console.log(`${out.length}案: 良さそう ${n('good')}、微妙の可能性 ${n('maybe-meh')}、判断材料が少ない ${n('unsure')}`);
