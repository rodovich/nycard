// Zero-dependency dev server: serves the app and pushes reload events when files change.
// CSS changes are swapped in place; any other change reloads the page, and the
// app restores the design from browser storage.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 5173;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};
const clients = new Set();

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('retry: 500\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  try {
    const path = decodeURIComponent(pathname);
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root)) throw new Error('Outside root');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));

let timer;
const pending = new Set();
watch(root, { recursive: true }, (_event, filename) => {
  if (!filename || filename.split(sep).some((part) => part.startsWith('.'))) return;
  pending.add(filename.split(sep).join('/'));
  clearTimeout(timer);
  timer = setTimeout(() => {
    const files = [...pending];
    pending.clear();
    const message = files.every((f) => f.endsWith('.css'))
      ? { type: 'css', files: files.map((f) => `/${f}`) }
      : { type: 'reload' };
    for (const client of clients) client.write(`data: ${JSON.stringify(message)}\n\n`);
  }, 50);
});
