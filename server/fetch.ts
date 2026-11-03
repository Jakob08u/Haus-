import { extractProduct, type ProductData } from './extract';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface FetchResult {
  ok: boolean;
  source: 'fetch' | 'browser' | 'none';
  status?: number;
  blocked?: boolean;
  message?: string;
  data?: ProductData;
}

function checkUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Nur http/https-Links');
  const h = u.hostname;
  if (h === 'localhost' || /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\.|^\[?::1\]?$/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h))
    throw new Error('Lokale Adressen werden nicht abgerufen');
  return u;
}

async function plainFetch(url: string): Promise<{ status: number; html: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'de-DE,de;q=0.9,en;q=0.6',
        'cache-control': 'no-cache',
      },
    });
    const html = await r.text();
    return { status: r.status, html };
  } finally {
    clearTimeout(t);
  }
}

let browserPromise: Promise<any> | null = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const pw = await import('playwright').catch(() => null);
      if (!pw) throw new Error('Playwright ist nicht installiert (optional: npm i playwright && npx playwright install chromium)');
      return pw.chromium.launch({ headless: true });
    })();
    browserPromise.catch(() => (browserPromise = null));
  }
  return browserPromise;
}

async function browserFetch(url: string): Promise<{ status: number; html: string }> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: UA, locale: 'de-DE', viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    // Produktdetails/Maße-Akkordeons öffnen, falls vorhanden
    for (const label of ['Maße', 'Abmessungen', 'Produktdetails', 'Produktinformationen']) {
      const el = page.getByText(label, { exact: false }).first();
      if (await el.isVisible().catch(() => false)) await el.click({ timeout: 1500 }).catch(() => {});
    }
    await page.waitForTimeout(800);
    const html = await page.content();
    return { status: resp?.status() ?? 0, html };
  } finally {
    await ctx.close();
  }
}

const isUseful = (d: ProductData) => !!d.name && (d.dims.width != null || d.dims.height != null || d.price != null || d.images.length > 0);
const looksBlocked = (status: number, html: string) =>
  status === 403 || status === 429 || status === 503 || /captcha|access denied|zugriff verweigert|are you a robot|cf-chl|px-captcha|incapsula/i.test(html.slice(0, 20000));

export async function fetchProduct(raw: string, opts: { forceBrowser?: boolean } = {}): Promise<FetchResult> {
  const url = checkUrl(raw).toString();
  let status = 0;
  let blocked = false;
  if (!opts.forceBrowser) {
    try {
      const r = await plainFetch(url);
      status = r.status;
      blocked = looksBlocked(r.status, r.html);
      if (!blocked && r.status < 400) {
        const data = extractProduct(r.html, url);
        if (isUseful(data) && (data.dims.width != null || data.dims.height != null)) return { ok: true, source: 'fetch', status, data };
        // brauchbar, aber ohne Maße → Browser versuchen (JS-lastige Shops)
        try {
          const b = await browserFetch(url);
          const bd = extractProduct(b.html, url);
          if (isUseful(bd)) return { ok: true, source: 'browser', status: b.status, data: mergeData(data, bd) };
        } catch {
          /* kein Browser verfügbar */
        }
        if (isUseful(data)) return { ok: true, source: 'fetch', status, data };
      }
    } catch (e) {
      if (opts.forceBrowser === undefined) {
        /* weiter mit Browser */
      }
    }
  }
  try {
    const b = await browserFetch(url);
    const bd = extractProduct(b.html, url);
    if (!looksBlocked(b.status, b.html) && isUseful(bd)) return { ok: true, source: 'browser', status: b.status, data: bd };
    return { ok: false, source: 'browser', status: b.status, blocked: true, message: 'Shop blockiert automatische Abrufe. Seite im Browser speichern (Strg+S) und HTML hier hochladen.', data: bd };
  } catch (e) {
    return {
      ok: false,
      source: 'none',
      status,
      blocked,
      message: blocked
        ? `Shop blockiert den Abruf (HTTP ${status}). Seite im Browser speichern (Strg+S → „Webseite, nur HTML“) und hier hochladen.`
        : `Abruf fehlgeschlagen: ${(e as Error).message}`,
    };
  }
}

function mergeData(a: ProductData, b: ProductData): ProductData {
  return {
    ...a,
    ...Object.fromEntries(Object.entries(b).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))),
    dims: { ...a.dims, ...b.dims },
    dimCandidates: [...a.dimCandidates, ...b.dimCandidates],
    images: [...new Set([...a.images, ...b.images])],
    sources: [...new Set([...a.sources, ...b.sources, 'Browser'])],
  } as ProductData;
}

export async function proxyFetch(raw: string): Promise<{ status: number; contentType: string; body: Buffer }> {
  const url = checkUrl(raw).toString();
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'image/*,model/gltf-binary,*/*;q=0.5', referer: new URL(url).origin + '/' } });
  const ct = r.headers.get('content-type') ?? 'application/octet-stream';
  if (!/^image\/|^model\/|octet-stream|application\/json/.test(ct)) return { status: 415, contentType: 'text/plain', body: Buffer.from('Nur Bilder/3D-Modelle') };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 40_000_000) return { status: 413, contentType: 'text/plain', body: Buffer.from('Datei zu groß') };
  return { status: r.status, contentType: ct, body: buf };
}
