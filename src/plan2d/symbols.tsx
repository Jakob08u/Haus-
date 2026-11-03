import type { ElecKind, Furniture } from '../model/types';

/** Möbel-Grundrisssymbol in lokalen Koordinaten (Mitte 0,0; Front bei +y) */
export function FurnitureGlyph({ f, stroke }: { f: Furniture; stroke: string }) {
  const w = f.width, d = f.depth;
  const x0 = -w / 2, y0 = -d / 2;
  const sw = { stroke, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const, fill: 'none' };
  switch (f.category) {
    case 'bett': {
      const pw = Math.min(w / 2 - 60, 700);
      const pillows = w > 1200 ? 2 : 1;
      return (
        <g>
          {Array.from({ length: pillows }, (_, i) => {
            const cx = pillows === 1 ? 0 : (i === 0 ? -1 : 1) * (w / 4);
            return <rect key={i} x={cx - Math.min(pw, w - 120) / 2} y={y0 + 60} width={Math.min(pw, w - 120)} height={Math.min(380, d * 0.2)} rx={60} {...sw} />;
          })}
          <line x1={x0} y1={y0 + d * 0.3} x2={x0 + w} y2={y0 + d * 0.3} {...sw} />
          <path d={`M ${x0} ${y0 + d * 0.3} L ${x0 + w * 0.6} ${y0 + d * 0.3} L ${x0 + w} ${y0 + d * 0.45}`} {...sw} />
        </g>
      );
    }
    case 'sofa':
    case 'sessel': {
      const back = Math.min(220, d * 0.28), arm = Math.min(200, w * 0.15);
      return (
        <g>
          <rect x={x0} y={y0} width={w} height={back} {...sw} />
          <rect x={x0} y={y0} width={arm} height={d} {...sw} />
          <rect x={x0 + w - arm} y={y0} width={arm} height={d} {...sw} />
        </g>
      );
    }
    case 'schrank':
    case 'kommode': {
      const n = f.doors ?? 1;
      return (
        <g>
          <line x1={x0} y1={y0} x2={x0 + w} y2={y0 + d} {...sw} />
          {Array.from({ length: n - 1 }, (_, i) => (
            <line key={i} x1={x0 + (w * (i + 1)) / n} y1={y0 + d - 60} x2={x0 + (w * (i + 1)) / n} y2={y0 + d} {...sw} />
          ))}
          <line x1={x0} y1={y0 + d - 30} x2={x0 + w} y2={y0 + d - 30} {...sw} />
        </g>
      );
    }
    case 'regal': {
      const n = Math.max(1, Math.round(w / 400));
      return (
        <g>
          {Array.from({ length: n - 1 }, (_, i) => (
            <line key={i} x1={x0 + (w * (i + 1)) / n} y1={y0} x2={x0 + (w * (i + 1)) / n} y2={y0 + d} {...sw} />
          ))}
        </g>
      );
    }
    case 'stuhl':
      return <rect x={x0} y={y0} width={w} height={Math.min(80, d * 0.2)} {...sw} />;
    case 'schreibtisch':
    case 'tisch':
      return <rect x={x0 + 40} y={y0 + 40} width={Math.max(0, w - 80)} height={Math.max(0, d - 80)} strokeDasharray="4 3" {...sw} />;
    case 'wc':
      return (
        <g>
          <rect x={x0 + w * 0.05} y={y0} width={w * 0.9} height={d * 0.32} rx={30} {...sw} />
          <ellipse cx={0} cy={y0 + d * 0.62} rx={w * 0.42} ry={d * 0.36} {...sw} />
        </g>
      );
    case 'waschbecken':
      return <ellipse cx={0} cy={y0 + d * 0.55} rx={w * 0.38} ry={d * 0.32} {...sw} />;
    case 'dusche':
      return (
        <g>
          <line x1={x0} y1={y0} x2={x0 + w} y2={y0 + d} {...sw} />
          <line x1={x0 + w} y1={y0} x2={x0} y2={y0 + d} {...sw} />
          <circle cx={0} cy={0} r={40} {...sw} />
        </g>
      );
    case 'wanne':
      return <rect x={x0 + 70} y={y0 + 70} width={w - 140} height={d - 140} rx={Math.min(w, d) * 0.3} {...sw} />;
    case 'waschmaschine':
      return <circle cx={0} cy={0} r={Math.min(w, d) * 0.33} {...sw} />;
    case 'lampe':
      return (
        <g>
          <circle cx={0} cy={0} r={Math.min(w, d) * 0.45} {...sw} />
          <line x1={-w * 0.3} y1={-d * 0.3} x2={w * 0.3} y2={d * 0.3} {...sw} />
          <line x1={w * 0.3} y1={-d * 0.3} x2={-w * 0.3} y2={d * 0.3} {...sw} />
        </g>
      );
    case 'pflanze':
      return <circle cx={0} cy={0} r={Math.min(w, d) * 0.4} {...sw} />;
    case 'heizkoerper':
      return <line x1={x0} y1={0} x2={x0 + w} y2={0} {...sw} />;
    default:
      return null;
  }
}

const S = 110; // Symbolgröße mm

/** Elektro-Symbol, lokal: Wand bei y=0, Symbol ragt nach +y in den Raum */
export function ElecGlyph({ kind, color }: { kind: ElecKind; color: string }) {
  const sw = { stroke: color, strokeWidth: 1.4, vectorEffect: 'non-scaling-stroke' as const, fill: '#fff' };
  const txt = (t: string, y = S * 0.75) => (
    <text x={0} y={y} fontSize={S * 0.62} textAnchor="middle" dominantBaseline="middle" fill={color} stroke="none" fontWeight={600}>
      {t}
    </text>
  );
  switch (kind) {
    case 'steckdose1':
    case 'steckdose2':
    case 'steckdose3': {
      const n = kind === 'steckdose1' ? 1 : kind === 'steckdose2' ? 2 : 3;
      return (
        <g>
          <path d={`M ${-S} 0 A ${S} ${S} 0 0 0 ${S} 0 Z`} {...sw} />
          {Array.from({ length: n }, (_, i) => {
            const x = (i - (n - 1) / 2) * S * 0.45;
            return <line key={i} x1={x} y1={S} x2={x} y2={S * 1.6} {...sw} />;
          })}
        </g>
      );
    }
    case 'schalter':
    case 'serienschalter':
    case 'wechselschalter':
      return (
        <g>
          <circle cx={0} cy={S * 0.75} r={S * 0.55} {...sw} />
          <line x1={S * 0.3} y1={S * 0.4} x2={S * 1.1} y2={S * 1.4} {...sw} />
          {kind !== 'schalter' && <line x1={-S * 0.3} y1={S * 0.4} x2={-S * 1.1} y2={S * 1.4} {...sw} />}
        </g>
      );
    case 'lampe':
    case 'wandlampe':
      return (
        <g>
          <circle cx={0} cy={kind === 'lampe' ? 0 : S * 0.75} r={S * 0.7} {...sw} />
          <g transform={kind === 'lampe' ? '' : `translate(0 ${S * 0.75})`}>
            <line x1={-S * 0.5} y1={-S * 0.5} x2={S * 0.5} y2={S * 0.5} {...sw} />
            <line x1={S * 0.5} y1={-S * 0.5} x2={-S * 0.5} y2={S * 0.5} {...sw} />
          </g>
        </g>
      );
    case 'lan':
      return (
        <g>
          <rect x={-S} y={0} width={2 * S} height={S * 1.4} {...sw} />
          {txt('LAN', S * 0.7)}
        </g>
      );
    case 'antenne':
      return (
        <g>
          <rect x={-S} y={0} width={2 * S} height={S * 1.4} {...sw} />
          {txt('TV', S * 0.7)}
        </g>
      );
    case 'starkstrom':
      return (
        <g>
          <path d={`M ${-S} 0 A ${S} ${S} 0 0 0 ${S} 0 Z`} {...sw} fill={color} />
          {txt('3~', S * 1.55)}
        </g>
      );
    case 'smarthome':
      return (
        <g>
          <rect x={-S} y={0} width={2 * S} height={S * 1.4} rx={S * 0.4} {...sw} />
          {txt('SH', S * 0.7)}
        </g>
      );
    case 'rauchmelder':
      return (
        <g>
          <circle cx={0} cy={0} r={S * 0.8} {...sw} />
          {txt('RM', 0)}
        </g>
      );
    case 'verteiler':
      return (
        <g>
          <rect x={-S * 1.6} y={0} width={S * 3.2} height={S * 1.2} {...sw} />
          <line x1={-S * 1.6} y1={S * 1.2} x2={S * 1.6} y2={0} {...sw} />
        </g>
      );
  }
}
