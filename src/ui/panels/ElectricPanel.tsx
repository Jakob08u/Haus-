import { useStore, useLevel } from '../../store/store';
import { ELEC_INFO, LINE_INFO } from '../../model/defaults';
import type { ElecKind, LineKind, LineSurface, LayerKey } from '../../model/types';
import { NumInput, Field } from '../inputs';
import { ElecGlyph } from '../../plan2d/symbols';
import { derive } from '../../store/derived';
import { roomAt } from '../../geometry/rooms';
import { ZONES } from '../../checks/zones';

export function lineLength(points: { x: number; y: number; z: number }[]) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
}

const LAYERS: [LayerKey, string][] = [
  ['elektro', 'Elektro-Symbole'],
  ['strom', 'Strom'],
  ['lan', 'LAN'],
  ['wasser', 'Wasser'],
  ['abwasser', 'Abwasser'],
  ['heizung', 'Heizung'],
  ['zonen', 'Installationszonen'],
];

export default function ElectricPanel() {
  const level = useLevel();
  const tool = useStore((s) => s.tool);
  const opts = useStore((s) => s.toolOpts);
  const layers = useStore((s) => s.layers);
  const settings = useStore((s) => s.project.settings);
  const selection = useStore((s) => s.selection);
  const st = useStore.getState;
  const D = derive(level);

  const byRoom = new Map<string, typeof level.electrical>();
  for (const e of level.electrical) {
    const r = roomAt(D.rooms, { x: e.x, y: e.y }) ?? roomAt(D.rooms, { x: e.x + Math.sin(((e.rotation ?? 0) * Math.PI) / 180) * -150, y: e.y + Math.cos(((e.rotation ?? 0) * Math.PI) / 180) * 150 });
    const k = r?.name ?? 'ohne Raum';
    if (!byRoom.has(k)) byRoom.set(k, []);
    byRoom.get(k)!.push(e);
  }
  const lineSums = new Map<LineKind, number>();
  for (const l of level.lines) lineSums.set(l.kind, (lineSums.get(l.kind) ?? 0) + lineLength(l.points));

  return (
    <div>
      <h3>Elektro & Leitungen</h3>
      <h4>Ebenen</h4>
      <div className="row">
        {LAYERS.map(([k, label]) => (
          <label key={k} style={{ marginRight: 6 }}>
            <input type="checkbox" checked={layers[k]} onChange={() => st().toggleLayer(k)} /> {label}
          </label>
        ))}
      </div>

      <h4>Symbol setzen</h4>
      <div className="lib-grid">
        {(Object.keys(ELEC_INFO) as ElecKind[]).map((k) => (
          <button
            key={k}
            className={tool === 'elec' && opts.elecKind === k ? 'active' : ''}
            onClick={() => {
              st().setToolOpts({ elecKind: k });
              st().setTool('elec');
              if (st().view === '3d') st().setView('split');
            }}
          >
            <svg width="30" height="26" viewBox="-200 -120 400 320">
              <ElecGlyph kind={k} color="#b91c1c" />
            </svg>
            <div style={{ fontSize: 10 }}>{ELEC_INFO[k].label}</div>
          </button>
        ))}
      </div>
      <p className="hint">Klick nahe einer Wand: Symbol rastet an der Wandfläche ein. Deckenauslass/Rauchmelder frei im Raum.</p>
      <Field label="Höhe Steckdose"><NumInput value={settings.defaultHeights.steckdose} onChange={(v) => st().update((d) => void (d.settings.defaultHeights.steckdose = v))} /></Field>
      <Field label="Höhe Schalter"><NumInput value={settings.defaultHeights.schalter} onChange={(v) => st().update((d) => void (d.settings.defaultHeights.schalter = v))} /></Field>
      <Field label="über Arbeitsfläche"><NumInput value={settings.defaultHeights.arbeitsflaeche} onChange={(v) => st().update((d) => void (d.settings.defaultHeights.arbeitsflaeche = v))} /></Field>

      <h4>Leitung zeichnen</h4>
      <div className="row">
        {(Object.keys(LINE_INFO) as LineKind[]).map((k) => (
          <button key={k} className={tool === 'line' && opts.lineKind === k ? 'active' : ''} onClick={() => {
            st().setToolOpts({ lineKind: k });
            st().setTool('line');
            if (st().view === '3d') st().setView('split');
          }}>
            <span className="swatch" style={{ background: LINE_INFO[k].color }} /> {LINE_INFO[k].label}
          </button>
        ))}
      </div>
      <Field label="Verlauf">
        {(['wand', 'decke', 'boden'] as LineSurface[]).map((s) => (
          <button key={s} className={opts.lineSurface === s ? 'active' : ''} onClick={() => st().setToolOpts({ lineSurface: s })}>
            {s === 'wand' ? 'Wand' : s === 'decke' ? 'Decke' : 'Boden'}
          </button>
        ))}
      </Field>
      {opts.lineSurface === 'wand' && (
        <Field label="Höhe nächster Punkt">
          <NumInput value={opts.lineHeight} onChange={(v) => st().setToolOpts({ lineHeight: v })} />
          {[300, 1050, 2100].map((h) => (
            <button key={h} onClick={() => st().setToolOpts({ lineHeight: h })}>{h / 10}</button>
          ))}
        </Field>
      )}
      <p className="hint">
        Klick setzt Punkte (an Wandflächen, Möbel-Anschlusspunkten und Symbolen rastend). Senkrechter Abschnitt: Höhe ändern und denselben Punkt erneut anklicken. Enter/Doppelklick beendet. Punkte lassen sich danach im Eigenschaften-Tab exakt in cm bearbeiten.
      </p>

      <h4>Installationszonen DIN 18015-3</h4>
      <div className="hint">
        Waagrecht: {ZONES.horizontal.unten.label}, {ZONES.horizontal.oben.label}, {ZONES.horizontal.mitte.label}. Senkrecht: {ZONES.vertical.label}. Elektrische Leitungen (Strom/LAN) und Dosen außerhalb der Zonen werden im Tab „Passt alles?“ gemeldet; Wasser/Abwasser/Heizung nur bei schrägem Verlauf oder Kreuzung von Öffnungen.
      </div>

      <h4>Symbole ({level.electrical.length})</h4>
      {[...byRoom.entries()].map(([room, items]) => (
        <div key={room}>
          <div className="hint" style={{ margin: '4px 0 2px' }}>{room}</div>
          <div className="list">
            {items.map((e) => (
              <div key={e.id} className={`item ${selection?.kind === 'elec' && selection.id === e.id ? 'sel' : ''}`} onClick={() => st().select({ kind: 'elec', id: e.id })}>
                {ELEC_INFO[e.kind].label}
                {e.label ? ` – ${e.label}` : ''} <span className="sub">· {e.height / 10} cm</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <h4>Leitungen ({level.lines.length})</h4>
      <table className="tbl">
        <tbody>
          {[...lineSums.entries()].map(([k, len]) => (
            <tr key={k}>
              <td><span className="swatch" style={{ background: LINE_INFO[k].color }} /> {LINE_INFO[k].label}</td>
              <td className="num">{(len / 1000).toFixed(1).replace('.', ',')} m</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="list" style={{ marginTop: 6 }}>
        {level.lines.map((l) => (
          <div key={l.id} className={`item ${selection?.kind === 'line' && selection.id === l.id ? 'sel' : ''}`} onClick={() => st().select({ kind: 'line', id: l.id })}>
            <span className="swatch" style={{ background: LINE_INFO[l.kind].color }} /> {l.label ?? LINE_INFO[l.kind].label} <span className="sub">· {l.surface} · {(lineLength(l.points) / 1000).toFixed(2).replace('.', ',')} m</span>
          </div>
        ))}
      </div>
    </div>
  );
}
