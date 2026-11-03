import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDimensions, toMM } from '../server/dims';
import { extractProduct, guessCategory } from '../server/extract';

const fx = (f: string) => readFileSync(resolve(__dirname, 'fixtures', f), 'utf8');

describe('Maß-Parser (Textmuster)', () => {
  const cases: [string, { width?: number; depth?: number; height?: number }, string?][] = [
    ['B 80 x T 40 x H 200 cm', { width: 800, depth: 400, height: 2000 }],
    ['Maße: B80/T40/H200cm', { width: 800, depth: 400, height: 2000 }],
    ['H 200 x B 80 x T 40 cm', { width: 800, depth: 400, height: 2000 }],
    ['80 x 200 x 40 cm (B x H x T)', { width: 800, depth: 400, height: 2000 }],
    ['Maße (B/H/T): 80/200/40 cm', { width: 800, depth: 400, height: 2000 }],
    ['Maße (B x H x T): 254 x 85 x 172 cm', { width: 2540, depth: 1720, height: 850 }],
    ['B/H/T: 192/110/212 cm', { width: 1920, depth: 2120, height: 1100 }],
    ['Breite: 80 cm, Tiefe: 40 cm, Höhe: 200 cm', { width: 800, depth: 400, height: 2000 }],
    ['Breite 80 cm\nHöhe 2 m\nTiefe 400 mm', { width: 800, depth: 400, height: 2000 }],
    ['Breite: 80,5 cm', { width: 805 }],
    ['Gesamthöhe ca. 75 cm, Sitzhöhe 45 cm', { height: 750 }],
    ['Höhe inkl. Rückenpolster 88 cm, Breite 218 cm, Tiefe 88 cm', { width: 2180, depth: 880, height: 880 }],
    ['Width: 31 1/2 " – Width 80 cm Depth 28 cm Height 202 cm', { width: 800, depth: 280, height: 2020 }],
    ['ca. 80 × 40 × 200 cm', { width: 800, depth: 400, height: 2000 }],
    ['Breite 1.800 mm', { width: 1800 }],
  ];
  for (const [text, exp] of cases) {
    it(JSON.stringify(text), () => {
      const d = parseDimensions(text);
      for (const k of ['width', 'depth', 'height'] as const) expect(d[k], k).toBe(exp[k]);
    });
  }

  it('Sitzhöhe/Armlehnenbreite werden nicht als Höhe/Breite gelesen', () => {
    const d = parseDimensions('Armlehnenbreite 24 cm, Sitzhöhe 45 cm');
    expect(d.width).toBeUndefined();
    expect(d.height).toBeUndefined();
  });

  it('Länge wird bei Betten als Tiefe, bei Tischen als Breite gedeutet', () => {
    expect(parseDimensions('Breite: 160 cm, Länge: 200 cm', 'bett')).toMatchObject({ width: 1600, depth: 2000 });
    expect(parseDimensions('Breite: 90 cm, Länge: 180 cm', 'tisch')).toMatchObject({ width: 1800, depth: 900 });
  });

  it('Liegefläche 180x200 bei Betten (unsicher markiert)', () => {
    const d = parseDimensions('Liegefläche 180x200 cm', 'bett');
    expect(d).toMatchObject({ width: 1800, depth: 2000, lowConfidence: true });
  });

  it('Einheiten', () => {
    expect(toMM('80', 'cm')).toBe(800);
    expect(toMM('0,8', 'm')).toBe(800);
    expect(toMM('800', 'mm')).toBe(800);
    expect(toMM('80,5', 'cm')).toBe(805);
  });

  it('kein Treffer ergibt leeres Ergebnis', () => {
    expect(parseDimensions('Lieferung in 3–5 Tagen, 30 Tage Rückgabe')).toEqual({});
  });
});

describe('Kategorie-Erkennung', () => {
  it.each([
    ['BILLY Bücherregal', 'regal'],
    ['Schreibtischstuhl Markus', 'stuhl'],
    ['MICKE Schreibtisch', 'schreibtisch'],
    ['Boxspringbett 180x200', 'bett'],
    ['Waschbeckenunterschrank', 'schrank'],
    ['Ecksofa Bergen', 'sofa'],
    ['Nachttisch Malm', 'kommode'],
    ['Couchtisch rund', 'tisch'],
    ['PAX Kleiderschrank', 'schrank'],
    ['Stehleuchte Hektar', 'lampe'],
  ])('%s → %s', (name, cat) => expect(guessCategory(name)).toBe(cat));
});

describe('Produktseiten (gespeichertes HTML)', () => {
  it('IKEA BILLY (echte Seite): JSON-LD, Preis, Bild, 3D-Modell', () => {
    const d = extractProduct(fx('ikea_billy.html'), 'https://www.ikea.com/de/de/p/billy-buecherregal-weiss-00263850/');
    expect(d.name).toMatch(/BILLY/);
    expect(d.price).toBe(49.99);
    expect(d.currency).toBe('EUR');
    expect(d.dims).toMatchObject({ width: 800, depth: 280, height: 2020 });
    expect(d.category).toBe('regal');
    expect(d.image).toMatch(/^https:\/\/www\.ikea\.com\/.*\.jpg/);
    expect(d.modelUrl).toMatch(/\.glb/);
  });

  it('IKEA EKTORP (echte Seite): fehlende Höhe aus Text, Verpackungsmaße ignoriert', () => {
    const d = extractProduct(fx('ikea_ektorp.html'), 'https://www.ikea.com/de/de/p/ektorp/');
    expect(d.dims).toMatchObject({ width: 2180, depth: 880, height: 880 });
    expect(d.category).toBe('sofa');
    expect(d.price).toBe(499);
  });

  it('IKEA BRIMNES (echte Seite): Bett mit Außenmaßen und Preis aus Text', () => {
    const d = extractProduct(fx('ikea_brimnes.html'), 'https://www.ikea.com/de/de/p/brimnes/');
    expect(d.dims).toMatchObject({ width: 1860, depth: 2060, height: 470 });
    expect(d.category).toBe('bett');
    expect(d.price).toBeGreaterThan(100);
  });

  it('Otto (nachgebildet): Maße aus Datentabelle, Paketmaße ignoriert', () => {
    const d = extractProduct(fx('otto_kommode.html'), 'https://www.otto.de/p/lilja/');
    expect(d.dims).toMatchObject({ width: 800, depth: 420, height: 950 });
    expect(d.price).toBe(299.99);
    expect(d.category).toBe('kommode');
  });

  it('Home24 (nachgebildet): OpenGraph-Preis, „Maße (B x H x T)“', () => {
    const d = extractProduct(fx('home24_sofa.html'), 'https://www.home24.de/p/bergen');
    expect(d.dims).toMatchObject({ width: 2540, depth: 1720, height: 850 });
    expect(d.price).toBe(899.99);
    expect(d.image).toContain('home24');
  });

  it('XXXLutz (nachgebildet): JSON-LD additionalProperty, AggregateOffer', () => {
    const d = extractProduct(fx('xxxlutz_bett.html'), 'https://www.xxxlutz.de/p/polsterbett');
    expect(d.dims).toMatchObject({ width: 1920, depth: 2120, height: 1100 });
    expect(d.price).toBe(499);
    expect(d.category).toBe('bett');
  });

  it('Seite ohne Maße liefert Teilwerte (Name/Preis) für das Formular', () => {
    const d = extractProduct('<html><head><meta property="og:title" content="Sessel Oslo"><meta property="product:price:amount" content="249"></head><body><h1>Sessel Oslo</h1><p>Breite: 78 cm</p></body></html>', 'https://shop.example/p/1');
    expect(d.name).toBe('Sessel Oslo');
    expect(d.price).toBe(249);
    expect(d.dims.width).toBe(780);
    expect(d.dims.depth).toBeUndefined();
    expect(d.category).toBe('sessel');
  });
});

describe.runIf(process.env.LIVE === '1')('Live-Abruf (nur mit LIVE=1)', () => {
  it('IKEA BILLY live', async () => {
    const { fetchProduct } = await import('../server/fetch');
    const r = await fetchProduct('https://www.ikea.com/de/de/p/billy-buecherregal-weiss-00263850/');
    expect(r.ok).toBe(true);
    expect(r.data?.dims.width).toBe(800);
  }, 60000);
});
