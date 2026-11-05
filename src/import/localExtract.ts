/** Produktdaten im Browser auslesen (ohne Server): gespeicherte HTML-Seite oder eingefügter Text */
export async function extractInBrowser(html: string, url: string) {
  const { extractProduct } = await import('../../server/extract');
  return extractProduct(html, url || 'https://unbekannt.invalid/');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Eingefügten Text der Produktseite als einfaches HTML: erste Zeile = Name */
export function textAsHtml(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const title = lines[0] ?? 'Möbel';
  return `<html><head><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1><pre>${esc(lines.slice(1).join('\n'))}</pre></body></html>`;
}
