// 評価ページ（docs/eval/）で書き出した JSON を集計し、Markdown で標準出力に出す。
// 使い方: node scripts/eval-summary.mjs docs/eval/results/eval-YYYY-MM-DD.json [...]
// 複数ファイルを渡すと、同じ案（key）の評価は後のファイルで上書きする。

import { readFileSync } from 'node:fs';
import { hexToOklch, contrastRatio, deltaE } from '../src/color-utils.js';

const REASON_LABEL = {
  muddy: '濁る・くすむ', garish: 'ぎらつく・派手すぎ', 'off-mood': '印象とずれる', unreadable: '読みにくい',
  clash: '色どうしが合わない', dull: '地味・単調', role: '役割の割り当てが変', duplicate: '他の案と似ている',
};
const RATING_LABEL = { good: '良い', meh: '微妙', bad: '悪い' };
const AXIS_LABEL = {
  temp: { warm: '暖色系', cool: '寒色・緑系', neutral: '無彩色＋差し色' },
  sat: { vivid: '鮮やか', mid: '中間', muted: 'くすみ・淡め' },
  harm: { analogous: '類似色', complementary: '補色', split: '分裂補色', triad: 'トライアド', mono: '単色階調', neutralAccent: '差し色' },
};

const files = process.argv.slice(2);
if (!files.length) {
  console.error('使い方: node scripts/eval-summary.mjs <評価JSON> [...]');
  process.exit(1);
}

const byKey = new Map();
const overall = {};
let seed;
for (const f of files) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  if (j.schema !== 'color-palette-eval/1') throw new Error(`${f}: 形式が違います（${j.schema}）`);
  if (seed != null && seed !== j.seed) console.error(`注意: seed が違うファイルが混ざっています（${seed} と ${j.seed}）`);
  seed = j.seed;
  for (const it of j.items) byKey.set(it.key, { ...byKey.get(it.key), ...it });
  Object.assign(overall, j.overall);
}
const items = [...byKey.values()];
const rated = items.filter((it) => it.rating);

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const out = [];
const table = (head, rows) => {
  out.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`), '');
};

out.push(`# 生成案の評価の集計`, '', `- 入力: ${files.join(', ')}`, `- seed: ${seed}`, `- 評価済み: ${rated.length} / ${items.length} 案`, '');

// 1. 語ごと
out.push('## 語ごと', '');
const words = [...new Set(items.map((it) => it.word))];
table(['語', '良い', '微妙', '悪い', '良い率', '★', '多い理由'], words.map((w) => {
  const r = rated.filter((it) => it.word === w);
  const n = (v) => r.filter((it) => it.rating === v).length;
  const tags = countTags(r.filter((it) => it.rating !== 'good'));
  return [w, n('good'), n('meh'), n('bad'), pct(n('good'), r.length), items.filter((it) => it.word === w && it.star).length,
    tags.slice(0, 3).map(([t, c]) => `${REASON_LABEL[t] ?? t} ${c}`).join('、') || '—'];
}));

// 2. 理由
out.push('## 微妙・悪いの理由（複数選択）', '');
const bads = rated.filter((it) => it.rating !== 'good');
table(['理由', '件数', '微妙・悪いのうち'], countTags(bads).map(([t, c]) => [REASON_LABEL[t] ?? t, c, pct(c, bads.length)]));

// 2b. 出どころ（配色データベース由来か、自動生成か。seedId の無い古い書き出しは区別しない）
if (items.some((it) => 'seedId' in it)) {
  out.push('## 出どころ別', '');
  const src = (it) => (it.seedId ? (/違い|の差し色/.test(it.label ?? '') ? 'データベースの変化形' : 'データベースの配色') : '自動生成');
  table(['出どころ', '評価数', '良い率', '悪い率'], ['データベースの配色', 'データベースの変化形', '自動生成'].map((k) => {
    const r = rated.filter((it) => src(it) === k);
    return [k, r.length, pct(r.filter((it) => it.rating === 'good').length, r.length), pct(r.filter((it) => it.rating === 'bad').length, r.length)];
  }));
}

// 3. 生成の枠ごと（どの温度・彩度・調和が悪いか）
for (const axis of ['temp', 'sat', 'harm']) {
  out.push(`## 枠ごと: ${{ temp: '温度', sat: '彩度', harm: '調和' }[axis]}`, '');
  const keys = [...new Set(rated.map((it) => it.cell[axis]))];
  table(['枠', '評価数', '良い率', '悪い率'], keys.map((k) => {
    const r = rated.filter((it) => it.cell[axis] === k);
    return [AXIS_LABEL[axis][k] ?? k, r.length, pct(r.filter((it) => it.rating === 'good').length, r.length), pct(r.filter((it) => it.rating === 'bad').length, r.length)];
  }));
}

// 4. 色の特徴（良い案と悪い案で何が違うか）
out.push('## 色の特徴の平均（良い／微妙／悪い）', '', 'L=明度、C=彩度（OKLCH）。比=コントラスト比、ΔE=色差（OKLab×100）。', '');
const feats = {
  '背景 L': (c) => hexToOklch(c.background).L,
  'メイン L': (c) => hexToOklch(c.primary).L,
  'メイン C': (c) => hexToOklch(c.primary).C,
  'サブ L': (c) => hexToOklch(c.secondary).L,
  'サブ C': (c) => hexToOklch(c.secondary).C,
  '差し色 C': (c) => hexToOklch(c.accent).C,
  'メイン/背景 比': (c) => contrastRatio(c.primary, c.background),
  'メイン/サブ ΔE': (c) => deltaE(c.primary, c.secondary),
  'メイン/差し色 ΔE': (c) => deltaE(c.primary, c.accent),
};
table(['特徴', ...Object.values(RATING_LABEL)], Object.entries(feats).map(([name, f]) => [name, ...Object.keys(RATING_LABEL).map((v) => fmt(mean(rated.filter((it) => it.rating === v).map((it) => f(it.colors)))))]));

// 5. お手本（シード配色の候補）
const stars = items.filter((it) => it.star);
out.push(`## ★お手本（${stars.length}案）`, '');
if (stars.length) table(['語', '番号', '案', 'メイン', 'サブ', '差し色', '背景', '文字', 'ひとこと'], stars.map((it) => [it.word, it.index + 1, it.label ?? cellText(it.cell), it.colors.primary, it.colors.secondary, it.colors.accent, it.colors.background, it.colors.text, it.note ?? '']));

// 6. 感想
const notes = items.filter((it) => it.note);
out.push('## 語ごとの全体の感想', '');
for (const w of words) if (overall[w]) out.push(`- **${w}**: ${overall[w]}`);
out.push('', `## 案ごとのひとこと（${notes.length}件）`, '');
for (const it of notes) out.push(`- ${it.word} ${it.index + 1}（${RATING_LABEL[it.rating] ?? '未評価'}）: ${it.note}`);

console.log(out.join('\n'));

function countTags(list) {
  const m = new Map();
  for (const it of list) for (const t of it.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function cellText(c) {
  return `${AXIS_LABEL.temp[c.temp]}×${AXIS_LABEL.sat[c.sat]}×${AXIS_LABEL.harm[c.harm]}`;
}
