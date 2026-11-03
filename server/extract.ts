import * as cheerio from 'cheerio';
import { parseDimensions, quantToMM, wordToDim, normalizeText, toMM, type Dims } from './dims';

export interface ProductData {
  name?: string;
  brand?: string;
  price?: number;
  currency?: string;
  image?: string;
  images: string[];
  description?: string;
  color?: string;
  dims: Dims;
  /** Teilwerte aus verschiedenen Quellen (zur Anzeige) */
  dimCandidates: { source: string; dims: Dims }[];
  category?: string;
  modelUrl?: string;
  url: string;
  sources: string[];
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/unterschrank|hochschrank|spiegelschrank|badschrank/i, 'schrank'],
  [/schreibtischstuhl|bürostuhl|buerostuhl|drehstuhl|gamingstuhl|\bstuhl|stühle|chair|hocker|barhocker/i, 'stuhl'],
  [/schreibtisch|desk|sekretär/i, 'schreibtisch'],
  [/couchtisch|sofatisch|beistelltisch|wohnzimmertisch/i, 'tisch'],
  [/schlafsofa|bettsofa|sofa|couch|ecksofa|wohnlandschaft/i, 'sofa'],
  [/sessel|armchair/i, 'sessel'],
  [/boxspring|\bbett|bettgestell|futonbett|polsterbett|hochbett|kinderbett|\bbed\b/i, 'bett'],
  [/kleiderschrank|schrank|wardrobe|pax|garderobe/i, 'schrank'],
  [/regal|bücherregal|billy|kallax|shelf|bookcase|standregal/i, 'regal'],
  [/kommode|sideboard|nachttisch|nachtkonsole|anrichte|highboard|dresser/i, 'kommode'],
  [/lowboard|tv-board|tv-möbel|tv board/i, 'tv'],
  [/esstisch|couchtisch|beistelltisch|küchentisch|tisch|table/i, 'tisch'],
  [/teppich|läufer|rug/i, 'teppich'],
  [/spiegel|mirror/i, 'spiegel'],
  [/lampe|leuchte|light|pendel|strahler/i, 'lampe'],
  [/pflanze|plant/i, 'pflanze'],
  [/wand-wc|stand-wc|\bwc\b|toilette/i, 'wc'],
  [/waschbecken|waschtisch|handwaschbecken|sink/i, 'waschbecken'],
  [/duschwanne|dusche|duschkabine|shower/i, 'dusche'],
  [/badewanne|wanne|bathtub/i, 'wanne'],
  [/waschmaschine|trockner/i, 'waschmaschine'],
  [/heizkörper|radiator/i, 'heizkoerper'],
];

export function guessCategory(...texts: (string | undefined)[]): string | undefined {
  for (const t of texts) {
    if (!t) continue;
    for (const [re, c] of CATEGORY_RULES) if (re.test(t)) return c;
  }
  return undefined;
}

function asArray<T>(x: T | T[] | undefined | null): T[] {
  return x == null ? [] : Array.isArray(x) ? x : [x];
}

function absUrl(u: string | undefined, base: string): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u.trim(), base).toString();
  } catch {
    return undefined;
  }
}

function parsePrice(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return undefined;
  // „1.299,00“ → 1299.00 ; „1299.00“ → 1299.00 ; „1,299.00“ → 1299.00
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : undefined;
}

function collectJsonLd($: cheerio.CheerioAPI): any[] {
  const out: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const data = JSON.parse(raw.trim());
      const stack = asArray(data);
      while (stack.length) {
        const o = stack.shift();
        if (!o || typeof o !== 'object') continue;
        out.push(o);
        if (o['@graph']) stack.push(...asArray(o['@graph']));
        if (o.hasVariant) stack.push(...asArray(o.hasVariant));
        if (o.mainEntity) stack.push(...asArray(o.mainEntity));
      }
    } catch {
      /* fehlerhaftes JSON-LD ignorieren */
    }
  });
  return out;
}

const isType = (o: any, t: string) => asArray(o?.['@type']).some((x: any) => String(x).toLowerCase() === t.toLowerCase());

/** Text einer Seite mit Zeilenumbrüchen an Blockgrenzen */
function pageText($: cheerio.CheerioAPI): string {
  const $c = $.root().clone();
  $c.find('script,style,noscript,svg,template').remove();
  $c.find('br,p,div,li,tr,td,th,dt,dd,h1,h2,h3,h4,h5,h6,section,span').each((_, el) => {
    $(el).append('\n');
  });
  return $c.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

function dimsFromTables($: cheerio.CheerioAPI, category?: string): Dims {
  const d: Dims & { length?: number } = { source: 'Datentabelle' };
  const consider = (label: string, value: string) => {
    const lbl = normalizeText(label).trim().replace(/[:\s]+$/, '');
    // „Breite (cm)“ → Einheit aus Label
    const unitInLabel = lbl.match(/\((mm|cm|m)\)|in (mm|cm|m)\b/i);
    const key = wordToDim(lbl.replace(/\(.*?\)|in (mm|cm|m)\b/gi, '').trim());
    if (!key) return;
    const m = normalizeText(value).match(/(\d{1,5}(?:[.,]\d{1,3})?)\s*(mm|cm|m)?(?![a-z])/i);
    if (!m) return;
    const unit = m[2] ?? unitInLabel?.[1] ?? unitInLabel?.[2] ?? 'cm';
    if ((d as any)[key] == null) (d as any)[key] = toMM(m[1], unit);
  };
  $('tr').each((_, tr) => {
    const cells = $(tr).find('th,td');
    if (cells.length >= 2) consider($(cells[0]).text(), $(cells[1]).text());
  });
  $('dt').each((_, dt) => {
    const dd = $(dt).next('dd');
    if (dd.length) consider($(dt).text(), dd.text());
  });
  // „Label: Wert“ in Listenpunkten
  $('li').each((_, li) => {
    const t = normalizeText($(li).text());
    const m = t.match(/^\s*([A-Za-zÄÖÜäöüß ]{1,25}?)\s*[:]\s*(.{1,40})$/);
    if (m) consider(m[1], m[2]);
  });
  if (d.length != null) {
    if (d.depth == null && d.width != null) {
      if (category === 'bett') d.depth = d.length;
      else if (d.length >= d.width) {
        d.depth = d.width;
        d.width = d.length;
      } else d.depth = d.length;
    } else if (d.width == null) d.width = d.length;
  }
  delete d.length;
  return d;
}

/** Verpackungs-/Paketmaße entfernen, damit sie nicht als Möbelmaße gelesen werden */
function removePackaging($: cheerio.CheerioAPI) {
  // Achtung: „price-package“ (IKEA-Preismodul) nicht entfernen – nur echte Verpackungsangaben
  $('[id*="packaging" i], [class*="packaging" i], [aria-labelledby*="packaging" i], [data-testid*="packaging" i], [class*="tab__package" i], [id*="verpackung" i], [class*="verpackung" i]').remove();
  const isPack = (t: string) => /^(verpackung|paket|paketmaße|versandmaße|karton|packmaße)/i.test(t.trim());
  // Überschriften: Überschrift + folgende Geschwister bis zur nächsten Überschrift entfernen
  $('h2,h3,h4,h5').each((_, el) => {
    if (!isPack($(el).text())) return;
    $(el).nextUntil('h1,h2,h3,h4,h5').remove();
    $(el).remove();
  });
  // Akkordeons/Tabs/Tabellenzeilen
  $('[role="heading"],summary,button').each((_, el) => {
    if (!isPack($(el).text())) return;
    const sec = $(el).closest('details,li,[role="region"]');
    (sec.length ? sec : $(el)).remove();
  });
  $('dt').each((_, el) => {
    if (!isPack($(el).text())) return;
    $(el).next('dd').remove();
    $(el).remove();
  });
  $('th,td').each((_, el) => {
    if (isPack($(el).text())) $(el).closest('tr').remove();
  });
}

export function extractProduct(html: string, url: string): ProductData {
  const $ = cheerio.load(html);
  removePackaging($);
  const res: ProductData = { images: [], dims: {}, dimCandidates: [], url, sources: [] };

  // 1) JSON-LD / schema.org
  const ld = collectJsonLd($);
  const product = ld.find((o) => isType(o, 'Product')) ?? ld.find((o) => isType(o, 'ProductGroup'));
  let breadcrumbs = '';
  const bc = ld.find((o) => isType(o, 'BreadcrumbList'));
  if (bc) breadcrumbs = asArray(bc.itemListElement).map((i: any) => i?.name ?? i?.item?.name ?? '').join(' > ');
  if (product) {
    res.sources.push('JSON-LD');
    res.name = product.name ? String(product.name).trim() : undefined;
    res.brand = typeof product.brand === 'string' ? product.brand : product.brand?.name;
    res.description = product.description ? String(product.description).slice(0, 800) : undefined;
    res.color = typeof product.color === 'string' ? product.color : undefined;
    const imgs = asArray(product.image).map((i: any) => (typeof i === 'string' ? i : i?.url ?? i?.contentUrl)).filter(Boolean);
    res.images.push(...imgs.map((i: string) => absUrl(i, url)!).filter(Boolean));
    const offers = asArray(product.offers).flatMap((o: any) => (isType(o, 'AggregateOffer') ? [o, ...asArray(o.offers)] : [o]));
    for (const o of offers) {
      const p = parsePrice(o?.price ?? o?.lowPrice ?? o?.priceSpecification?.price);
      if (p != null) {
        res.price = p;
        res.currency = o.priceCurrency ?? o?.priceSpecification?.priceCurrency ?? 'EUR';
        break;
      }
    }
    const d: Dims = { source: 'JSON-LD' };
    d.width = quantToMM(product.width);
    d.depth = quantToMM(product.depth);
    d.height = quantToMM(product.height);
    for (const ap of asArray(product.additionalProperty)) {
      const key = wordToDim(String(ap?.name ?? ''));
      if (!key) continue;
      const mm = quantToMM({ value: ap.value, unitCode: ap.unitCode, unitText: ap.unitText });
      if (mm != null) {
        if (key === 'length') {
          if (d.depth == null) d.depth = mm;
        } else if ((d as any)[key] == null) (d as any)[key] = mm;
      }
    }
    if (d.width == null && d.depth == null && d.height == null && product.size) Object.assign(d, parseDimensions(String(product.size)), { source: 'JSON-LD size' });
    clean(d);
    if (Object.keys(d).length > 1) res.dimCandidates.push({ source: 'JSON-LD', dims: d });
    // 3D-Modell als schema.org 3DModel
    for (const sub of asArray(product.subjectOf).concat(asArray(product.associatedMedia))) {
      const enc = asArray((sub as any)?.encoding ?? sub);
      for (const e of enc) {
        const cu = (e as any)?.contentUrl ?? (e as any)?.url;
        if (cu && /\.(glb|gltf)(\?|$)/i.test(cu)) res.modelUrl = absUrl(cu, url);
      }
    }
  }

  // 2) OpenGraph / Meta
  const meta = (sel: string) => $(sel).attr('content')?.trim();
  const ogTitle = meta('meta[property="og:title"]') ?? meta('meta[name="twitter:title"]');
  const ogImage = meta('meta[property="og:image"]') ?? meta('meta[property="og:image:secure_url"]') ?? meta('meta[name="twitter:image"]');
  const ogPrice = meta('meta[property="product:price:amount"]') ?? meta('meta[property="og:price:amount"]') ?? meta('meta[itemprop="price"]') ?? $('[itemprop="price"]').attr('content');
  const ogCur = meta('meta[property="product:price:currency"]') ?? meta('meta[property="og:price:currency"]') ?? meta('meta[itemprop="priceCurrency"]');
  if (ogTitle || ogImage || ogPrice) res.sources.push('OpenGraph');
  res.name = res.name ?? ogTitle ?? $('h1').first().text().trim() ?? $('title').text().trim();
  if (ogImage) {
    const u = absUrl(ogImage, url);
    if (u && !res.images.includes(u)) res.images.push(u);
  }
  if (res.price == null && ogPrice) {
    res.price = parsePrice(ogPrice);
    res.currency = ogCur ?? 'EUR';
  }
  res.description = res.description ?? meta('meta[property="og:description"]') ?? meta('meta[name="description"]');

  const cat = guessCategory(res.name, breadcrumbs, res.description);
  res.category = cat;

  // 3) Datentabellen
  const tbl = dimsFromTables($, cat);
  clean(tbl);
  if (Object.keys(tbl).length > 1) res.dimCandidates.push({ source: 'Datentabelle', dims: tbl });

  // 4) Textmuster
  const text = pageText($);
  const txt = parseDimensions(text, cat);
  if (Object.keys(txt).filter((k) => ['width', 'depth', 'height'].includes(k)).length) res.dimCandidates.push({ source: txt.source ?? 'Text', dims: txt });
  // Name/Beschreibung separat (z. B. „Regal, weiß, 80x28x202 cm“ im Titel)
  const nameDims = parseDimensions(`${res.name ?? ''} ${res.description ?? ''}`, cat);
  if (Object.keys(nameDims).filter((k) => ['width', 'depth', 'height'].includes(k)).length) res.dimCandidates.push({ source: 'Produktname/Beschreibung', dims: nameDims });

  // Zusammenführen nach Priorität: JSON-LD → Tabelle → Text → Name
  const merged: Dims = {};
  const used: string[] = [];
  for (const c of res.dimCandidates) {
    let any = false;
    for (const k of ['width', 'depth', 'height'] as const) {
      if (merged[k] == null && c.dims[k] != null) {
        merged[k] = c.dims[k];
        any = true;
      }
    }
    if (any) used.push(c.source);
    if (c.dims.lowConfidence && any) merged.lowConfidence = true;
  }
  merged.source = used.join(' + ') || undefined;
  res.dims = merged;

  // Preis aus Text (nahe am Produktnamen) bzw. Datenattributen als letzte Option
  if (res.price == null) {
    const t = normalizeText(text);
    const re = /(\d{1,3}(?:[.\s]\d{3})*)\s*[,.]\s*(\d{2}|–|-)\s*€|€\s*(\d{1,3}(?:\.\d{3})*)\s*,\s*(\d{2})/;
    // in den Containern rund um die Überschrift suchen (von innen nach außen)
    let m: RegExpMatchArray | null = null;
    const h1 = $('h1').first();
    if (h1.length) {
      const parents = h1.parents().toArray().slice(0, 6);
      for (const el of parents) {
        const ct = normalizeText($(el).text());
        if (ct.length > 6000) break;
        m = ct.match(re);
        if (m) break;
      }
    }
    m = m ?? t.match(re);
    if (m) {
      const intPart = (m[1] ?? m[3]).replace(/[.\s]/g, '');
      const dec = m[2] ?? m[4];
      res.price = parsePrice(`${intPart}.${dec && /\d{2}/.test(dec) ? dec : '00'}`);
      res.currency = 'EUR';
      res.sources.push('Preis aus Text');
    }
  }
  if (res.price == null) {
    const p = parsePrice($('[data-price]').first().attr('data-price') ?? $('[data-product-price]').first().attr('data-product-price'));
    if (p != null && p > 0) {
      res.price = p;
      res.currency = 'EUR';
      res.sources.push('Preis aus Datenattribut');
    }
  }

  // 5) 3D-Modell: schema.org 3DModel oder GLB/glTF-Links im HTML (unkomprimiert bevorzugt)
  if (!res.modelUrl) {
    const urls: string[] = [];
    for (const o of ld.filter((x) => isType(x, '3DModel')))
      for (const e of asArray(o.encoding)) if ((e as any)?.contentUrl) urls.push(String((e as any).contentUrl));
    for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]+?\.(?:glb|gltf)(?:\?[^"'\s<>]*)?/gi)) urls.push(m[0].replace(/\\\//g, '/'));
    const glbs = urls.filter((u) => /\.(glb|gltf)(\?|$)/i.test(u));
    res.modelUrl = glbs.find((u) => !/draco/i.test(u)) ?? glbs[0];
  }
  res.image = res.images[0];
  if (res.name) res.name = res.name.replace(/\s+/g, ' ').trim().slice(0, 160);
  return res;
}

function clean(d: Dims) {
  for (const k of ['width', 'depth', 'height'] as const) if (d[k] == null || !isFinite(d[k]!) || d[k]! <= 0) delete d[k];
}
