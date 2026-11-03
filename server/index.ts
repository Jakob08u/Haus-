/**
 * Lokaler Hilfsserver (nur localhost):
 *  - /api/product?url=…   Produktseite laden und Name/Preis/Bild/Maße auslesen
 *  - /api/parse-html      (POST) gespeichertes HTML auslesen (Fallback, wenn der Shop blockiert)
 *  - /api/proxy?url=…     Bilder/GLB-Modelle durchreichen (CORS)
 * Es werden keine Daten gespeichert oder an Dritte gesendet – außer dem einzelnen Abruf der angegebenen URL.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { fetchProduct, proxyFetch } from './fetch';
import { extractProduct } from './extract';

const PROD = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
const PORT = Number(process.env.PORT ?? (PROD ? 5173 : 5174));
const HOST = process.env.HOST ?? '127.0.0.1';
const DIST = resolve(import.meta.dirname, '..', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
};

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, limit = 15_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new Error('Body zu groß');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true });
    if (url.pathname === '/api/product') {
      const target = url.searchParams.get('url');
      if (!target) return json(res, 400, { error: 'url fehlt' });
      const browser = url.searchParams.get('browser') === '1';
      const result = await fetchProduct(target, { forceBrowser: browser });
      return json(res, 200, result);
    }
    if (url.pathname === '/api/parse-html' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const data = extractProduct(String(body.html ?? ''), String(body.url ?? 'https://example.invalid/'));
      return json(res, 200, { ok: true, source: 'html', data });
    }
    if (url.pathname === '/api/proxy') {
      const target = url.searchParams.get('url');
      if (!target) return json(res, 400, { error: 'url fehlt' });
      const r = await proxyFetch(target);
      res.writeHead(r.status, { 'content-type': r.contentType, 'cache-control': 'max-age=86400' });
      res.end(r.body);
      return;
    }
    // Produktion: gebaute App ausliefern
    if (PROD) {
      let p = join(DIST, decodeURIComponent(url.pathname));
      if (!p.startsWith(DIST)) return json(res, 403, { error: 'verboten' });
      try {
        if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
      } catch {
        p = join(DIST, 'index.html');
      }
      const data = await readFile(p);
      res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(data);
      return;
    }
    json(res, 404, { error: 'nicht gefunden' });
  } catch (e) {
    json(res, 500, { error: String((e as Error)?.message ?? e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Raumplaner-Server läuft auf http://${HOST}:${PORT}${PROD ? '' : ' (API für Vite-Dev)'}`);
});
