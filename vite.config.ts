import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** alle Dateien aus public/ (relativ) */
function publicFiles(dir = 'public'): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out;
}

/**
 * Service Worker für die statische Version (GitHub Pages): legt alle Dateien beim ersten Öffnen
 * im Browser ab, damit der Planer danach auch ohne Internet startet (iPad: „Zum Home-Bildschirm“).
 */
function serviceWorker(): Plugin {
  return {
    name: 'raumplaner-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = [...new Set(['./', 'index.html', ...Object.keys(bundle), ...publicFiles()])].filter((f) => !f.endsWith('.map') && f !== 'sw.js');
      const version = createHash('sha1').update(files.join('|')).digest('hex').slice(0, 12);
      const source = `// automatisch erzeugt (vite.config.ts)
const CACHE = 'raumplaner-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) => c.add(f).catch(() => {})))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('raumplaner-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Seite: erst Netz (neue Version), sonst gespeicherte
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html', { ignoreSearch: true })),
    );
    return;
  }
  // Dateien mit Hash im Namen: erst Speicher, sonst Netz
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // relative Pfade: läuft lokal und auf GitHub Pages unter /<Repository>/
  base: './',
  plugins: [react(), mode === 'pages' && serviceWorker()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5174' },
  },
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}) as any);
