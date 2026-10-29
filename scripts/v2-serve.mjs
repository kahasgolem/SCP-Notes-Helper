import http from 'node:http';
import { createReadStream, existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(project, 'v2', 'dist');
const port = Number(process.env.PORT || 8852);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || !existsSync(path.join(dist, 'release.json'))) throw Error('v2_preview_not_ready');
const release = JSON.parse(readFileSync(path.join(dist, 'release.json'), 'utf8')).release;
if (!/^[a-f0-9]{16}$/.test(release)) throw Error('invalid_v2_preview_version');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.icc': 'application/vnd.iccprofile', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer((req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/notes') { res.writeHead(308, { Location: '/notes/' + url.search }).end(); return; }
    if (!url.pathname.startsWith('/notes/')) { res.writeHead(404).end(); return; }
    let relative = decodeURIComponent(url.pathname.slice('/notes/'.length)) || 'index.html';
    if (relative.startsWith('releases/')) {
      const match = /^releases\/([a-f0-9]{16})\/(.*)$/.exec(relative);
      if (!match) { res.writeHead(404).end(); return; }
      if (match[1] !== release) { res.writeHead(404).end(); return; }
      relative = match[2] || 'index.html';
    }
    const file = path.resolve(dist, ...relative.split('/'));
    if (!file.startsWith(dist + path.sep) || relative.split('/').some(p => p.startsWith('.')) || !existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) { res.writeHead(404).end(); return; }
    const size = lstatSync(file).size;
    const headers = { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
    let start = 0, end = size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; } start = Math.max(0, size - suffix); }
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start < 0 || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file, { start, end }).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Unable to serve this v2 file.'); }
});
// Resolve only the selected version. Never alias the previous model or audiobook.
server.listen(port, '127.0.0.1', () => console.log(`SCP notes v2 preview: http://127.0.0.1:${port}/notes/`));
