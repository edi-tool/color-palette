// E2E 用の最小の静的サーバー（依存なし）。python http.server は並列アクセスで不安定だったため置き換え。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT || 8199);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen({ port: PORT, host: '127.0.0.1', backlog: 1024 }, () => console.log(`listening ${PORT}`));
