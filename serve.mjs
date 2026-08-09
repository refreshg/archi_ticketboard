/** Tiny static file server for local development. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 4173);
const ROOT = process.cwd();
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    // Contain the path inside ROOT.
    const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
