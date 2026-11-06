// 確認してほしい組（review-1）を作る: Claude が微妙と見たデータベースの配色13件＋良いと見た配色の抜き取り12件
import { readFileSync, writeFileSync } from 'node:fs';
const set = JSON.parse(readFileSync('docs/eval/sets/unseen-p1.json', 'utf8'));
const REASON = {
  1: '淡く、やさしい寄り。明るい（原色・ビタミンカラー）としては弱い',
  2: 'メインがからし色寄りで、明るさが出ない',
  6: '黄色い地が重い（明るいでも微妙だった配色）',
  22: '黄色い地が重い（明るいでも微妙だった配色）',
  69: '茶色が中心で、親しみやすいより落ち着いた寄り（ミルクティーが微妙だった型）',
  70: '茶色が中心で、親しみやすいより落ち着いた寄り',
  85: '灰みの緑（やさしいで微妙だった型）',
  88: 'くすんだ橙（明るいで微妙だった配色）',
  89: '灰みのベージュ（やさしいで微妙だった型）',
  94: '茶色・くすみ（親しみやすいで微妙だった配色）',
  100: '鶯色の差し色が濁って見える',
  101: 'くすんだサーモン（やさしいで微妙だった配色）',
  364: 'サブがくすんだピンクで、蛍光らしさが落ちる',
};
const doubt = Object.keys(REASON).map(Number);
const judgedMeh = new Set(JSON.parse(readFileSync('docs/eval/claude/unseen-p1-claude.json', 'utf8')).meh);
// 良いと見たデータベースの配色から、語が重ならないように12件を抜き取る（決まった順）
const goods = set.items.map((it, i) => ({ it, n: i + 1 })).filter(({ it, n }) => it.seedId && !judgedMeh.has(n));
let s = 11; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
const shuffled = goods.map((g) => [rnd(), g]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const picked = []; const used = new Set();
for (const g of shuffled) { if (picked.length >= 12) break; if (used.has(g.it.word)) continue; used.add(g.it.word); picked.push(g); }
const items = [
  ...doubt.map((n) => ({ ...set.items[n - 1], key: `review#${n}`, judge: { verdict: 'maybe-meh', notes: [REASON[n]] } })),
  ...picked.map(({ it, n }) => ({ ...it, key: `review#${n}`, judge: { verdict: 'good', notes: ['抜き取り確認（Claude の見逃しを測るため）'] } })),
];
writeFileSync('docs/eval/sets/review-1.json', JSON.stringify({
  schema: 'color-palette-eval-set/1', name: 'review-1', title: '確認のお願い（Claude の事前判定つき）',
  note: '1ページ目の未評価367案を Claude が先に見ました。データベースの配色242案のうち、Claude が「微妙の可能性」と見た13案と、「良さそう」と見た案からの抜き取り12案です。自動生成の125案は Claude がほぼすべて微妙と見たので、ここには出さず、データベースを足して置き換えます。',
  items,
}, null, 1) + '\n');
console.log('items', items.length, picked.map(({ it }) => it.word).join(' '));
