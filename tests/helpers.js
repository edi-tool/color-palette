// index.html を変更せずにテストするための補助関数（依存ゼロ）。
// 原本: edi-tool/.github/templates/tests/helpers.js
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const ROOT = join(__dirname, '..');

function read(file) {
  return readFileSync(join(ROOT, file), 'utf8');
}

// `function name(...) { ... }` の本体を波かっこの対応で切り出す（文字列・正規表現中の括弧は想定しない単純版）
function extractFunction(source, name) {
  const start = source.search(new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) throw new Error(`関数 ${name} が見つかりません`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`関数 ${name} の終わりが見つかりません`);
}

// データファイルと関数を 1 つの vm コンテキストに読み込む。
// const 宣言はコンテキストのグローバルに出ないため、exports に列挙した名前を最後に取り出す。
function load({ files = [], functions = [], from = 'index.html', globals = {}, exports = [] }) {
  const html = functions.length ? read(from) : '';
  const code = [
    ...files.map(read),
    ...functions.map((f) => extractFunction(html, f)),
    `globalThis.__exports = { ${[...exports, ...functions].join(', ')} };`,
  ].join('\n;\n');
  const context = vm.createContext(globals); // 呼び出し側から状態を読めるよう、同じオブジェクトを使う
  vm.runInContext(code, context);
  return context.__exports;
}

module.exports = { ROOT, read, extractFunction, load };
