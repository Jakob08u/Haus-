import { jsPDF } from 'jspdf';
import type { Project } from '../model/types';
import { derive } from '../store/derived';
import { roomStats } from '../calc/roomStats';
import { materialList, materialSummary } from '../calc/materials';
import { checkLevel } from '../checks/checks';
import { chooseScale, drawPlan, planBounds } from './drawPlan';
import { ELEC_INFO, LINE_INFO, CATEGORY_INFO } from '../model/defaults';
import { lineLength } from '../ui/panels/ElectricPanel';
import { slopePitch } from '../geometry/ceiling';

export interface PdfOptions {
  levelIds: string[];
  grundriss: boolean;
  elektro: boolean;
  material: boolean;
  moebel: boolean;
  pruefung: boolean;
  images: { name: string; dataUrl: string; w?: number; h?: number }[];
}

const PW = 297, PH = 210, M = 12;
/** Zeichen, die die PDF-Standardschrift (WinAnsi) nicht kennt, ersetzen */
const pdfSafe = (t: string) => t.replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[✖✕]/g, 'X').replace(/✓/g, 'OK').replace(/↗/g, '').replace(/[^\u0000-\u00ff€–—‘’“”„•…‰›‹]/g, '');
const eur = (n?: number) => (n == null ? '' : `${n.toFixed(2).replace('.', ',')} EUR`);
const num = (mm2: number) => (mm2 / 1e6).toFixed(2).replace('.', ',');

class Doc {
  doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
  y = M;
  page = 1;
  constructor(public project: Project) {
    this.doc.setFont('helvetica', 'normal');
  }
  header(title: string, sub = '') {
    const d = this.doc;
    d.setFontSize(9);
    d.setTextColor(100);
    d.text(`${this.project.name} · ${new Date().toLocaleDateString('de-DE')}`, M, 8);
    d.text(`Seite ${this.page}`, PW - M, 8, { align: 'right' });
    d.setTextColor(20);
    d.setFontSize(15);
    d.text(title, M, 16);
    if (sub) {
      d.setFontSize(9);
      d.setTextColor(90);
      d.text(sub, M, 21);
      d.setTextColor(20);
    }
    this.y = sub ? 27 : 23;
  }
  newPage(title: string, sub = '') {
    this.doc.addPage('a4', 'landscape');
    this.page++;
    this.header(title, sub);
  }
  ensure(h: number, title: string) {
    if (this.y + h > PH - M) this.newPage(title + ' (Forts.)');
  }
  h2(t: string) {
    this.ensure(12, t);
    this.doc.setFontSize(11);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text(t, M, this.y + 4);
    this.doc.setFont('helvetica', 'normal');
    this.y += 8;
  }
  para(t: string, size = 9, title = 'Fortsetzung') {
    const d = this.doc;
    d.setFontSize(size);
    const lines = d.splitTextToSize(pdfSafe(t), PW - 2 * M) as string[];
    for (const l of lines) {
      this.ensure(5, title);
      d.setFontSize(size);
      d.text(l, M, this.y + 3.5);
      this.y += size * 0.45;
    }
    this.y += 1;
  }
  table(cols: { title: string; w: number; align?: 'left' | 'right' }[], rows: (string | { text: string; link?: string; bold?: boolean })[][], title: string) {
    const d = this.doc;
    const lh = 4;
    const head = () => {
      d.setFontSize(8.5);
      d.setFont('helvetica', 'bold');
      d.setFillColor(238, 241, 245);
      d.rect(M, this.y, PW - 2 * M, 6, 'F');
      let x = M + 1.5;
      for (const c of cols) {
        d.text(c.title, c.align === 'right' ? x + c.w - 3 : x, this.y + 4.2, { align: c.align === 'right' ? 'right' : 'left' });
        x += c.w;
      }
      d.setFont('helvetica', 'normal');
      this.y += 7;
    };
    head();
    for (const r of rows) {
      d.setFontSize(8.5);
      const cells = r.map((c, i) => d.splitTextToSize(pdfSafe(typeof c === 'string' ? c : c.text), cols[i].w - 3) as string[]);
      const h = Math.max(...cells.map((c) => c.length)) * lh + 1.5;
      if (this.y + h > PH - M) {
        this.newPage(title + ' (Forts.)');
        head();
      }
      let x = M + 1.5;
      r.forEach((c, i) => {
        const col = cols[i];
        const isObj = typeof c !== 'string';
        if (isObj && c.bold) d.setFont('helvetica', 'bold');
        if (isObj && c.link) {
          d.setTextColor(37, 99, 235);
          d.textWithLink(cells[i][0] ?? '', x, this.y + 3.2, { url: c.link });
          d.setTextColor(20);
        } else
          cells[i].forEach((ln, k) => d.text(ln, col.align === 'right' ? x + col.w - 3 : x, this.y + 3.2 + k * lh, { align: col.align === 'right' ? 'right' : 'left' }));
        if (isObj && c.bold) d.setFont('helvetica', 'normal');
        x += col.w;
      });
      this.y += h;
      d.setDrawColor(225);
      d.line(M, this.y - 0.5, PW - M, this.y - 0.5);
    }
    this.y += 3;
  }
}

export function buildPdf(project: Project, opts: PdfOptions): jsPDF {
  const D = new Doc(project);
  const d = D.doc;
  const levels = project.levels.filter((l) => opts.levelIds.includes(l.id));

  // ---- Deckblatt / Flächen
  D.header('Planungsunterlagen', 'Raumplaner – Grundriss, Flächen, Elektro/Leitungen, Material und Möbel');
  for (const l of levels) {
    const Dv = derive(l);
    D.h2(`${l.name} – Raumflächen (WoFlV)`);
    let a = 0, w = 0;
    const rows = Dv.rooms.map((r) => {
      const st = roomStats(l, r);
      a += r.netArea;
      w += st.living;
      return [r.name, num(r.netArea) + ' m²', num(st.above2) + ' m²', num(st.between1and2) + ' m²', num(st.below1) + ' m²', { text: num(st.living) + ' m²', bold: true }, `${(st.minHeight / 10).toFixed(0)}–${(st.maxHeight / 10).toFixed(0)} cm`];
    });
    rows.push([{ text: 'Summe', bold: true }, { text: num(a) + ' m²', bold: true }, '', '', '', { text: num(w) + ' m²', bold: true }, '']);
    D.table(
      [
        { title: 'Raum', w: 70 },
        { title: 'Grundfläche', w: 32, align: 'right' },
        { title: '>= 2 m (100 %)', w: 34, align: 'right' },
        { title: '1–2 m (50 %)', w: 32, align: 'right' },
        { title: '< 1 m (0 %)', w: 30, align: 'right' },
        { title: 'Wohnfläche', w: 32, align: 'right' },
        { title: 'Raumhöhe', w: 33, align: 'right' },
      ],
      rows,
      'Raumflächen',
    );
  }
  const openA = project.assumptions.filter((a) => a.status === 'offen');
  if (openA.length) {
    D.h2(`Offene Annahmen (${openA.length})`);
    for (const a of openA) D.para(`• ${a.text}`, 8.5, 'Offene Annahmen');
  }

  // ---- Grundrisse
  for (const l of levels) {
    if (opts.grundriss) planPage(D, l.id, 'grundriss');
    if (opts.elektro && (l.electrical.length || l.lines.length)) planPage(D, l.id, 'elektro');
  }

  // ---- Materialliste
  if (opts.material) {
    D.newPage('Materialliste', `Verschnitt Standard ${project.settings.wastePercent} % · Tapete: Bahnen auf Rollen verteilt (Rapport berücksichtigt)`);
    const sum = materialSummary(project);
    const total = sum.reduce((s, x) => s + (x.price ?? 0), 0);
    D.table(
      [
        { title: 'Material', w: 110 },
        { title: 'Art', w: 30 },
        { title: 'Menge', w: 95 },
        { title: 'Preis', w: 38, align: 'right' },
      ],
      [...sum.map((s) => [s.name, s.kind, s.quantity, eur(s.price)]), ...(total ? [[{ text: 'Summe', bold: true }, '', '', { text: eur(total), bold: true }]] : [])],
      'Materialliste',
    );
    D.h2('Rechenweg je Raum / Fläche');
    const det = materialList(project);
    D.table(
      [
        { title: 'Ort', w: 80 },
        { title: 'Material', w: 60 },
        { title: 'Menge', w: 38 },
        { title: 'Berechnung', w: 95 },
      ],
      det.map((x) => [x.where, x.name, x.quantity, x.detail]),
      'Materialliste',
    );
    // Leitungslängen
    const lens = new Map<string, number>();
    for (const l of levels) for (const ln of l.lines) lens.set(ln.kind, (lens.get(ln.kind) ?? 0) + lineLength(ln.points));
    if (lens.size) {
      D.h2('Leitungslängen (ohne Zuschlag)');
      D.table(
        [
          { title: 'Leitung', w: 100 },
          { title: 'Länge', w: 40, align: 'right' },
        ],
        [...lens.entries()].map(([k, v]) => [LINE_INFO[k as keyof typeof LINE_INFO].label, `${(v / 1000).toFixed(1).replace('.', ',')} m`]),
        'Leitungen',
      );
    }
    // Elektro-Stückliste
    const counts = new Map<string, number>();
    for (const l of levels) for (const e of l.electrical) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    if (counts.size) {
      D.h2('Elektro-Stückliste');
      D.table(
        [
          { title: 'Art', w: 100 },
          { title: 'Anzahl', w: 40, align: 'right' },
        ],
        [...counts.entries()].map(([k, v]) => [ELEC_INFO[k as keyof typeof ELEC_INFO].label, String(v)]),
        'Elektro',
      );
    }
  }

  // ---- Möbelliste
  if (opts.moebel) {
    D.newPage('Möbelliste', 'mit Links, Maßen (B × T × H) und Preisen');
    const all = levels.flatMap((l) => l.furniture.map((f) => ({ f, l })));
    const total = all.reduce((s, x) => s + (x.f.price ?? 0), 0);
    D.table(
      [
        { title: 'Möbel', w: 85 },
        { title: 'Kategorie', w: 28 },
        { title: 'Ebene', w: 30 },
        { title: 'B × T × H (cm)', w: 38 },
        { title: 'Link', w: 60 },
        { title: 'Preis', w: 32, align: 'right' },
      ],
      [
        ...all.map(({ f, l }) => [
          f.name,
          CATEGORY_INFO[f.category].label,
          l.name,
          `${Math.round(f.width / 10)} × ${Math.round(f.depth / 10)} × ${Math.round(f.height / 10)}`,
          f.url ? { text: shortUrl(f.url), link: f.url } : '',
          eur(f.price),
        ]),
        [{ text: 'Gesamt', bold: true }, '', '', '', '', { text: eur(total), bold: true }],
      ],
      'Möbelliste',
    );
  }

  // ---- Ansichten
  if (opts.images.length) {
    let i = 0;
    for (const img of opts.images) {
      if (i % 2 === 0) D.newPage('Ansichten', 'aus gespeicherten Kamerapositionen');
      const w = (PW - 3 * M) / 2;
      const h = Math.min(PH - 45, w * (img.w && img.h ? img.h / img.w : 0.66));
      const x = M + (i % 2) * (w + M);
      d.addImage(img.dataUrl, 'JPEG', x, D.y, w, h);
      d.setFontSize(9);
      d.text(img.name, x, D.y + h + 5);
      i++;
    }
  }

  // ---- Prüfung
  if (opts.pruefung) {
    D.newPage('Prüfbericht „Passt alles?“');
    for (const l of levels) {
      const ws = checkLevel(l, project).filter((w) => w.severity !== 'assume');
      D.h2(`${l.name}: ${ws.length ? `${ws.length} Hinweise` : 'keine Konflikte'}`);
      for (const w of ws) D.para(`${w.severity === 'error' ? 'X' : w.severity === 'warn' ? '!' : 'i'}  ${w.message}`, 8.5, 'Prüfbericht');
    }
  }
  return d;
}

function shortUrl(u: string) {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, '') + (x.pathname.length > 28 ? x.pathname.slice(0, 26) + '…' : x.pathname);
  } catch {
    return u.slice(0, 40);
  }
}

function planPage(D: Doc, levelId: string, mode: 'grundriss' | 'elektro') {
  const project = D.project;
  const l = project.levels.find((x) => x.id === levelId)!;
  const legendW = 58;
  const areaW = PW - 2 * M - legendW - 4, areaH = PH - 28 - M;
  const scale = chooseScale(l, areaW, areaH);
  D.newPage(mode === 'grundriss' ? `Grundriss ${l.name}` : `Elektro- und Leitungsplan ${l.name}`, `Maßstab 1:${scale} (bei Druck in Originalgröße A4 quer) · Maße in m, Öffnungen Breite/Höhe in cm`);
  const b = planBounds(l);
  const k = 1 / scale; // Modell-mm → Papier-mm
  const ox = M + (areaW - b.w * k) / 2 - b.minX * k;
  const oy = 28 + (areaH - b.h * k) / 2 - b.minY * k;
  const ctx = D.doc.context2d as unknown as CanvasRenderingContext2D;
  ctx.save();
  drawPlan(ctx, l, project, { k, ox, oy, font: 2.4, lw: 0.35 }, mode);
  ctx.restore();
  // Legende
  const d = D.doc;
  const lx = PW - M - legendW;
  let ly = 30;
  d.setFontSize(9);
  d.setFont('helvetica', 'bold');
  d.text('Legende', lx, ly);
  d.setFont('helvetica', 'normal');
  ly += 5;
  d.setFontSize(8);
  const sw = (r: number, g: number, bl: number, label: string, stroke?: [number, number, number]) => {
    d.setFillColor(r, g, bl);
    if (stroke) d.setDrawColor(...stroke);
    d.rect(lx, ly - 3, 6, 4, stroke ? 'FD' : 'F');
    d.text(label, lx + 8, ly);
    ly += 5.5;
  };
  const ln = (hex: string, label: string, dash?: number[]) => {
    const c = hexRgb(hex);
    d.setDrawColor(c[0], c[1], c[2]);
    d.setLineWidth(0.7);
    if (dash) d.setLineDashPattern(dash, 0);
    d.line(lx, ly - 1, lx + 6, ly - 1);
    d.setLineDashPattern([], 0);
    d.text(label, lx + 8, ly);
    ly += 5.5;
  };
  if (mode === 'grundriss') {
    sw(85, 90, 98, 'Wand Bestand');
    sw(244, 215, 122, 'Wand neu (Trockenbau)');
    sw(255, 255, 255, 'Wand Abriss', [214, 40, 40]);
    sw(227, 237, 251, 'Raumhöhe 1–2 m (50 %)');
    sw(201, 218, 245, 'Raumhöhe < 1 m (0 %)');
    sw(255, 246, 216, 'Treppe / Treppenloch', [138, 90, 0]);
    ln('#0369a1', 'Dachfenster (Projektion)', [1.2, 0.8]);
    ly += 3;
    d.setFontSize(7.5);
    const kneeWalls = l.walls.filter((w) => w.slope);
    if (kneeWalls.length) {
      d.text('Dachschrägen:', lx, ly);
      ly += 4;
      for (const w of kneeWalls) {
        const t = d.splitTextToSize(`${w.label ?? 'Wand'}: Kniestock ${(w.slope!.knee / 10).toFixed(0)} cm, ${(derive(l).ceiling.planes.find((p) => p.wallId === w.id)?.pitchDeg ?? slopePitch(w.slope!, l.ceilingHeight)).toFixed(0)}°`, legendW);
        for (const tl of t) {
          d.text(tl, lx, ly);
          ly += 3.5;
        }
      }
      d.text('Flache Deckenhöhe:', lx, ly);
      ly += 3.5;
      for (const r of derive(l).rooms) {
        d.text(`${r.name}: ${((r.meta?.ceilingHeight ?? l.ceilingHeight) / 10).toFixed(0)} cm`, lx + 2, ly);
        ly += 3.5;
      }
    }
  } else {
    for (const k of Object.keys(LINE_INFO) as (keyof typeof LINE_INFO)[]) if (l.lines.some((x) => x.kind === k)) ln(LINE_INFO[k].color, LINE_INFO[k].label);
    ln('#555555', 'in Wand (durchgezogen)');
    ln('#555555', 'Decke (gepunktet)', [0.4, 0.6]);
    ln('#555555', 'Boden (gestrichelt)', [1.6, 0.8]);
    ly += 2;
    d.setFontSize(7.5);
    d.text('Zahl am Symbol = Höhe in cm', lx, ly);
    ly += 5;
    d.setFont('helvetica', 'bold');
    d.text('Symbole', lx, ly);
    d.setFont('helvetica', 'normal');
    ly += 4;
    const counts = new Map<string, number>();
    for (const e of l.electrical) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    for (const [k, v] of counts) {
      d.text(`${v} × ${ELEC_INFO[k as keyof typeof ELEC_INFO].label}`, lx, ly);
      ly += 3.8;
    }
    ly += 2;
    d.text('Installationszonen DIN 18015-3:', lx, ly);
    ly += 3.5;
    for (const t of ['ZW-u 15–45 cm über FFB', 'ZW-o 15–45 cm unter Decke', 'ZW-m 90–130 cm (Arbeitsflächen)', 'ZS 10–30 cm neben Tür/Fenster/Ecke']) {
      d.text(`• ${t}`, lx, ly);
      ly += 3.5;
    }
  }
  // Maßstabsleiste
  const barM = 5000; // 5 m
  const bx = lx, by = PH - M - 6;
  d.setDrawColor(30);
  d.setLineWidth(0.3);
  for (let i = 0; i < 5; i++) {
    d.setFillColor(i % 2 ? 255 : 40, i % 2 ? 255 : 40, i % 2 ? 255 : 40);
    d.rect(bx + (i * barM * k) / 5, by, (barM * k) / 5, 1.6, 'FD');
  }
  d.setFontSize(7);
  d.text('0', bx, by + 5);
  d.text('5 m', bx + barM * k, by + 5, { align: 'right' });
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
