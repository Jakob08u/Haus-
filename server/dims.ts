/**
 * Maß-Parser für Produkttexte (deutsch/englisch). Liefert Millimeter.
 * Erkennt u. a.:
 *  - „B 80 x T 40 x H 200 cm“, „B80/T40/H200cm“
 *  - „80 x 40 x 200 cm (B x T x H)“, „Maße (B/H/T): 80/200/40 cm“
 *  - „Breite: 80 cm“, „Gesamthöhe 2 m“, „Tiefe 400 mm“
 *  - „ca. 80 × 40 × 200 cm“ (ohne Bezeichner → Annahme B × T × H)
 */
export interface Dims {
  width?: number;
  depth?: number;
  height?: number;
  /** woher die Maße stammen */
  source?: string;
  /** unsicher (z. B. Reihenfolge angenommen) */
  lowConfidence?: boolean;
}

const NUM = String.raw`(\d{1,5}(?:[.,]\d{1,3})?)`;
const UNIT = String.raw`(mm|cm|m)(?![a-zäöü])`;

export function toMM(value: string, unit: string | undefined): number {
  const v = Number(value.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  const u = (unit ?? 'cm').toLowerCase();
  if (u === 'mm') return Math.round(v);
  if (u === 'm') return Math.round(v * 1000);
  return Math.round(v * 10);
}

const LETTER_TO_DIM: Record<string, keyof Dims> = {
  b: 'width', w: 'width', t: 'depth', d: 'depth', l: 'depth', h: 'height',
};

const WORD_TO_DIM: [RegExp, keyof Dims | 'length'][] = [
  [/^(gesamt)?breite$|^width$|^b$/i, 'width'],
  [/^(gesamt)?tiefe$|^depth$|^t$/i, 'depth'],
  [/^(gesamt)?h(ö|oe)he$|^height$|^h$/i, 'height'],
  [/^(gesamt)?l(ä|ae)nge$|^length$|^l$/i, 'length'],
];

export function wordToDim(word: string): keyof Dims | 'length' | null {
  const w = word.trim().replace(/[:.]$/, '');
  for (const [re, d] of WORD_TO_DIM) if (re.test(w)) return d;
  return null;
}

function plausible(d: Dims) {
  const vals = [d.width, d.depth, d.height].filter((x): x is number => x != null);
  return vals.length > 0 && vals.every((v) => v >= 5 && v <= 12000);
}

/** Texte vereinheitlichen */
export function normalizeText(t: string) {
  return t
    .replace(/ | | /g, ' ')
    .replace(/[×✕✖]/g, 'x')
    .replace(/\s+/g, ' ');
}

export function parseDimensions(textIn: string, category?: string): Dims {
  const text = normalizeText(textIn);

  // 1) Buchstaben-Folge mit Werten: „B 80 x T 40 x H 200 cm“ (beliebige Reihenfolge, Einheit evtl. pro Wert)
  {
    const re = new RegExp(
      String.raw`(?<![a-zäöü])([BTHLWD])\s*[:.]?\s*${NUM}\s*(mm|cm|m)?\s*[x*/,;]?\s*([BTHLWD])\s*[:.]?\s*${NUM}\s*(mm|cm|m)?(?:\s*[x*/,;]?\s*([BTHLWD])\s*[:.]?\s*${NUM})?\s*${UNIT}?`,
      'i',
    );
    const m = text.match(re);
    if (m) {
      const unit = m[9] ?? m[6] ?? m[3] ?? 'cm';
      const pairs: [string, string, string | undefined][] = [
        [m[1], m[2], m[3] ?? unit],
        [m[4], m[5], m[6] ?? unit],
      ];
      if (m[7]) pairs.push([m[7], m[8], unit]);
      const letters = pairs.map((p) => p[0].toLowerCase());
      if (new Set(letters).size === letters.length) {
        const d: Dims = { source: 'Text (B/T/H)' };
        for (const [l, v, u] of pairs) {
          const key = LETTER_TO_DIM[l.toLowerCase()];
          if (key) (d as any)[key] = toMM(v, u);
        }
        if (plausible(d)) return finishLength(d, letters.includes('l') && !letters.includes('t') ? 'L' : null, category);
      }
    }
  }

  // 2) Kopf mit Reihenfolge + Zahlen: „(B x H x T): 80 x 200 x 40 cm“ oder Zahlen zuerst „80 x 200 x 40 cm (B x H x T)“
  {
    const hdr = String.raw`\(?\s*([BTHLWD])\s*[x/]\s*([BTHLWD])\s*(?:[x/]\s*([BTHLWD]))?\s*\)?`;
    const nums = String.raw`(?:ca\.?\s*)?${NUM}\s*(?:cm|mm|m)?\s*[x/]\s*${NUM}\s*(?:cm|mm|m)?\s*(?:[x/]\s*${NUM})?\s*${UNIT}`;
    const a = text.match(new RegExp(hdr + String.raw`\s*(?:in\s*cm)?\s*[:=]?\s*` + nums, 'i'));
    const b = text.match(new RegExp(nums + String.raw`\s*` + hdr, 'i'));
    const pick = (letters: (string | undefined)[], values: (string | undefined)[], unit: string): Dims | null => {
      const L = letters.filter(Boolean).map((x) => x!.toLowerCase());
      const V = values.filter(Boolean) as string[];
      if (L.length !== V.length || new Set(L).size !== L.length) return null;
      const d: Dims = { source: 'Text (Maßangabe mit Reihenfolge)' };
      L.forEach((l, i) => {
        const key = LETTER_TO_DIM[l];
        if (key) (d as any)[key] = toMM(V[i], unit);
      });
      return plausible(d) ? finishLength(d, L.includes('l') && !L.includes('t') ? 'L' : null, category) : null;
    };
    if (a) {
      const r = pick([a[1], a[2], a[3]], [a[4], a[5], a[6]], a[7]);
      if (r) return r;
    }
    if (b) {
      const r = pick([b[5], b[6], b[7]], [b[1], b[2], b[3]], b[4]);
      if (r) return r;
    }
  }

  // 3) Einzelne Bezeichner: „Breite: 80 cm“, „Höhe 200 cm“
  {
    const re = new RegExp(String.raw`(?<![a-zäöüß])(gesamtbreite|gesamttiefe|gesamth(?:ö|oe)he|gesamtl(?:ä|ae)nge|breite|tiefe|h(?:ö|oe)he|l(?:ä|ae)nge|width|depth|height|length)(?![a-zäöüß])\s*(?:\([^)]{0,20}\))?\s*(?:(?:inkl\.?|inklusive|gesamt|mit|ohne|außen|aussen)[^\d:\n]{0,24})?\s*(?:in\s*(?:cm|mm|m)\s*)?[:=]?\s*(?:ca\.?\s*)?(?:max\.?\s*)?${NUM}\s*${UNIT}`, 'gi');
    const d: Dims & { length?: number } = { source: 'Text (Einzelangaben)' };
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = re.exec(text))) {
      const key = wordToDim(m[1]);
      if (!key) continue;
      const isGesamt = /^gesamt/i.test(m[1]);
      if ((d as any)[key] == null || isGesamt) {
        (d as any)[key] = toMM(m[2], m[3]);
        found = true;
      }
    }
    if (found && plausible(d)) return finishLength(d, d.length != null ? 'L' : null, category);
  }

  // 4) Drei Zahlen ohne Bezeichner: Annahme B × T × H
  {
    const re = new RegExp(String.raw`(?:ca\.?\s*)?${NUM}\s*[x]\s*${NUM}\s*[x]\s*${NUM}\s*${UNIT}`, 'i');
    const m = text.match(re);
    if (m) {
      const d: Dims = { width: toMM(m[1], m[4]), depth: toMM(m[2], m[4]), height: toMM(m[3], m[4]), source: 'Text (Reihenfolge B×T×H angenommen)', lowConfidence: true };
      if (plausible(d)) return d;
    }
    const re2 = new RegExp(String.raw`(?:ca\.?\s*)?${NUM}\s*[x]\s*${NUM}\s*${UNIT}`, 'i');
    const m2 = text.match(re2);
    if (m2 && (category === 'bett' || category === 'teppich' || category === 'tisch')) {
      const a = toMM(m2[1], m2[3]), b = toMM(m2[2], m2[3]);
      const d: Dims = { width: Math.min(a, b), depth: Math.max(a, b), source: 'Text (Liegefläche/Größe)', lowConfidence: true };
      if (category !== 'bett') {
        d.width = Math.max(a, b);
        d.depth = Math.min(a, b);
      }
      if (plausible(d)) return d;
    }
  }
  return {};
}

/** „Länge“ je nach Kategorie als Tiefe (Bett) oder Breite (Tisch) deuten */
function finishLength(d: Dims & { length?: number }, hasLength: 'L' | null, category?: string): Dims {
  const out: Dims = { width: d.width, depth: d.depth, height: d.height, source: d.source, lowConfidence: d.lowConfidence };
  const len = d.length ?? (hasLength ? d.depth : undefined);
  if (d.length != null) {
    if (out.depth == null && out.width != null) {
      if (category === 'bett' || category === 'teppich') out.depth = d.length;
      else if (d.length >= out.width) {
        out.depth = out.width;
        out.width = d.length;
      } else out.depth = d.length;
    } else if (out.width == null && out.depth != null) out.width = d.length;
    else if (out.width == null && out.depth == null) out.width = d.length;
  }
  void len;
  for (const k of ['width', 'depth', 'height'] as const) if (out[k] == null) delete out[k];
  return out;
}

/** Schema.org QuantitativeValue o. ä. → mm */
export function quantToMM(q: unknown): number | undefined {
  if (q == null) return undefined;
  if (typeof q === 'number') return q > 0 ? Math.round(q * 10) : undefined; // ohne Einheit: cm angenommen
  if (typeof q === 'string') {
    const m = normalizeText(q).match(new RegExp(NUM + String.raw`\s*` + `(mm|cm|m)?`, 'i'));
    return m ? toMM(m[1], m[2] ?? 'cm') : undefined;
  }
  if (typeof q === 'object') {
    const o = q as Record<string, unknown>;
    const v = o.value ?? o.maxValue ?? o.minValue;
    const code = String(o.unitCode ?? o.unitText ?? 'cm').toUpperCase();
    const unit = code === 'MMT' || code === 'MM' ? 'mm' : code === 'MTR' || code === 'M' ? 'm' : 'cm';
    if (v == null) return undefined;
    return toMM(String(v), unit);
  }
  return undefined;
}
