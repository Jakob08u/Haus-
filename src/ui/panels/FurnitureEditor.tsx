import { useStore, useLevel } from '../../store/store';
import { derive } from '../../store/derived';
import { NumInput, Field, TextInput, Select } from '../inputs';
import { CATEGORY_INFO, defaultConnections } from '../../model/defaults';
import type { Furniture, FurnitureCategory, FurnitureCorner, Level } from '../../model/types';
import { snapToNearestWall } from '../../plan2d/geom2d';
import { deleteSelection, duplicateSelection, rotateSelection } from '../actions';
import { checkLevelCached } from '../../checks/checks';
import { fmtCm } from '../../geometry/vec';
import { furnitureFootprint, hasCorners } from '../../geometry/openings';

const upd = (fn: (l: Level) => void) => useStore.getState().updateLevel(fn);

const CORNERS: [FurnitureCorner, string][] = [
  ['bl', 'hinten links'],
  ['br', 'hinten rechts'],
  ['fl', 'vorne links'],
  ['fr', 'vorne rechts'],
];
function setCorner(f: Furniture, k: FurnitureCorner, axis: 'x' | 'y', v: number) {
  const c = { x: 0, y: 0, ...f.corners?.[k] };
  c[axis] = Math.max(0, v || 0);
  const corners = { ...f.corners };
  if (c.x > 0 || c.y > 0) corners[k] = c;
  else delete corners[k];
  f.corners = Object.keys(corners).length ? corners : undefined;
}

export function FurnitureEditor({ id }: { id: string }) {
  const level = useLevel();
  const project = useStore((s) => s.project);
  const f = level.furniture.find((x) => x.id === id);
  if (!f) return null;
  const D = derive(level);
  const set = (fn: (o: Furniture) => void) => upd((l) => fn(l.furniture.find((x) => x.id === id)!));
  const warns = checkLevelCached(level, project).filter((w) => w.refs.some((r) => r.id === id));
  const maxH = D.ceiling.minOver(furnitureFootprint(f));
  return (
    <div>
      <h3>{f.name}</h3>
      {f.imageUrl && (
        <img
          src={f.imageUrl.startsWith('data:') ? f.imageUrl : `/api/proxy?url=${encodeURIComponent(f.imageUrl)}`}
          alt=""
          style={{ width: '100%', maxHeight: 160, objectFit: 'contain', background: '#fafafa', borderRadius: 6, border: '1px solid var(--line)' }}
        />
      )}
      <Field label="Name"><TextInput value={f.name} onChange={(v) => set((x) => void (x.name = v))} /></Field>
      <Field label="Kategorie">
        <Select<FurnitureCategory>
          value={f.category}
          options={(Object.keys(CATEGORY_INFO) as FurnitureCategory[]).map((k) => ({ value: k, label: CATEGORY_INFO[k].label }))}
          onChange={(v) =>
            set((x) => {
              x.category = v;
              x.connections = defaultConnections(v, x);
              if (v === 'schrank' && !x.doors) {
                x.doors = Math.max(1, Math.round(x.width / 500));
                x.doorType = 'hinged';
              }
            })
          }
        />
      </Field>
      <Field label="Breite"><NumInput value={f.width} min={10} onChange={(v) => set((x) => void (x.width = v))} /></Field>
      <Field label="Tiefe"><NumInput value={f.depth} min={10} onChange={(v) => set((x) => void (x.depth = v))} /></Field>
      <Field label="Höhe"><NumInput value={f.height} min={1} onChange={(v) => set((x) => void (x.height = v))} /></Field>
      <div className="hint">An dieser Stelle max. Höhe unter Decke/Schräge: {fmtCm(maxH - f.elevation)} cm</div>
      <Field label="Abstand vom Boden"><NumInput value={f.elevation} onChange={(v) => set((x) => void (x.elevation = v))} /></Field>
      <Field label="Drehung">
        <NumInput value={f.rotation} factor={1} unit="°" onChange={(v) => set((x) => void (x.rotation = ((v % 360) + 360) % 360))} />
        <button onClick={() => rotateSelection(-90)}>⟲ 90°</button>
        <button onClick={() => rotateSelection(90)}>⟳ 90°</button>
      </Field>
      <Field label="Position x / y"><NumInput value={f.x} onChange={(v) => set((x) => void (x.x = v))} /><NumInput value={f.y} onChange={(v) => set((x) => void (x.y = v))} /></Field>
      <div className="row">
        <button
          onClick={() => {
            const r = snapToNearestWall(f, level, D.footprints);
            if (r) set((x) => Object.assign(x, r));
          }}
          title="Rückseite an die nächste Wand drehen und anlegen"
        >
          An Wand andocken
        </button>
        <button onClick={duplicateSelection}>Duplizieren</button>
      </div>
      <Field label="Farbe"><input type="color" value={f.color} onChange={(e) => set((x) => void (x.color = e.target.value))} /></Field>
      {(f.category === 'schrank' || f.category === 'kommode') && (
        <>
          <Field label="Türen">
            <Select value={f.doorType ?? 'none'} options={[{ value: 'hinged', label: 'Drehtüren' }, { value: 'sliding', label: 'Schiebetüren' }, { value: 'none', label: 'keine/Schubladen' }]} onChange={(v) => set((x) => void (x.doorType = v as 'hinged'))} />
            {f.doorType === 'hinged' && <NumInput value={f.doors ?? 1} factor={1} unit="Flügel" digits={0} min={1} onChange={(v) => set((x) => void (x.doors = Math.round(v)))} />}
          </Field>
        </>
      )}
      <details open={hasCorners(f)}>
        <summary>Ecken abschrägen</summary>
        <div className="hint">Je Ecke: Schenkel entlang der Breite und der Tiefe (z. B. 22 × 22 cm ≈ 31 cm Schräge). Ecken wie im Grundriss bei Drehung 0°.</div>
        {CORNERS.map(([k, label]) => (
          <Field key={k} label={label}>
            <NumInput value={f.corners?.[k]?.x} min={0} width={60} title="entlang der Breite" onChange={(v) => set((x) => setCorner(x, k, 'x', v))} />
            <NumInput value={f.corners?.[k]?.y} min={0} width={60} title="entlang der Tiefe" onChange={(v) => set((x) => setCorner(x, k, 'y', v))} />
          </Field>
        ))}
        {hasCorners(f) && <div className="hint">Schräge: {CORNERS.filter(([k]) => f.corners?.[k]?.x && f.corners?.[k]?.y).map(([k, label]) => `${label} ${fmtCm(Math.hypot(f.corners![k]!.x, f.corners![k]!.y))} cm`).join(', ')}</div>}
      </details>
      <Field label="Bewegungsfläche vorn"><NumInput value={f.clearanceFront} onChange={(v) => set((x) => void (x.clearanceFront = v > 0 ? v : undefined))} /><span className="hint">leer = Standard</span></Field>
      <h4>Shop</h4>
      <Field label="Preis"><NumInput value={f.price} factor={1} digits={2} unit="€" onChange={(v) => set((x) => void (x.price = v))} /></Field>
      <Field label="Link"><TextInput value={f.url ?? ''} onChange={(v) => set((x) => void (x.url = v || undefined))} /></Field>
      {f.url && <a href={f.url} target="_blank" rel="noreferrer">Produktseite öffnen ↗</a>}
      {f.modelUrl && <div className="hint">3D-Modell vom Hersteller wird verwendet.</div>}
      <Field label="Notiz"><TextInput value={f.note ?? ''} onChange={(v) => set((x) => void (x.note = v))} /></Field>
      {f.connections && f.connections.length > 0 && <div className="hint">Anschlusspunkte: {f.connections.map((c) => c.kind.replace('_', ' ')).join(', ')} (Leitungen rasten dort ein)</div>}
      {warns.length > 0 && (
        <>
          <h4>Hinweise</h4>
          {warns.map((w) => (
            <div key={w.id} className={`warnitem ${w.severity === 'error' ? 'err' : ''}`}>{w.message}</div>
          ))}
        </>
      )}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="danger" onClick={deleteSelection}>Löschen</button>
      </div>
    </div>
  );
}
