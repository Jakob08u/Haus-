import { useStore, type Tool } from '../store/store';

const TOOLS: ({ t: Tool; ic: string; label: string; title: string } | 'sep')[] = [
  { t: 'select', ic: '↖', label: 'Auswahl', title: 'Auswählen & verschieben (V)' },
  { t: 'pan', ic: '✋', label: 'Hand', title: 'Ansicht verschieben' },
  'sep',
  { t: 'wall', ic: '▭', label: 'Wand', title: 'Wände zeichnen (W)' },
  { t: 'door', ic: '◜', label: 'Tür', title: 'Tür in Wand setzen (T)' },
  { t: 'window', ic: '▤', label: 'Fenster', title: 'Fenster in Wand setzen (F)' },
  { t: 'passage', ic: '⊓', label: 'Durchg.', title: 'Durchgang (Öffnung ohne Tür)' },
  { t: 'roofWindow', ic: '◇', label: 'Dachf.', title: 'Dachfenster in Schräge setzen' },
  { t: 'stair', ic: '☰', label: 'Treppe', title: 'Treppe/Treppenloch aufziehen' },
  { t: 'room', ic: '⌂', label: 'Raum', title: 'Raum benennen (in Raum klicken)' },
  'sep',
  { t: 'furniture', ic: '🛋', label: 'Möbel', title: 'Möbel platzieren (Kategorie im Panel „Möbel“)' },
  { t: 'elec', ic: '⏚', label: 'Elektro', title: 'Elektro-Symbol setzen' },
  { t: 'line', ic: '〰', label: 'Leitung', title: 'Leitung zeichnen (L)' },
  'sep',
  { t: 'dimension', ic: '↔', label: 'Maß', title: 'Maßlinie setzen' },
  { t: 'measure', ic: '📏', label: 'Messen', title: 'Messen (M)' },
  { t: 'calibrate', ic: '⚖', label: 'Kalibr.', title: 'Hintergrund-Maßstab kalibrieren (2 Punkte + Länge)' },
];

export function ToolPalette() {
  const tool = useStore((s) => s.tool);
  const st = useStore.getState;
  return (
    <div className="palette">
      {TOOLS.map((t, i) =>
        t === 'sep' ? (
          <div key={i} className="grp" />
        ) : (
          <button
            key={t.t}
            title={t.title}
            className={tool === t.t ? 'active' : ''}
            onClick={() => {
              st().setTool(t.t);
              if (t.t === 'furniture') st().setPanel('moebel');
              if (t.t === 'elec' || t.t === 'line') st().setPanel('elektro');
              if (st().view === '3d' && t.t !== 'measure' && t.t !== 'select') st().setView('split');
            }}
          >
            <span className="ic">{t.ic}</span>
            {t.label}
          </button>
        ),
      )}
    </div>
  );
}
