import { useStore, useLevel } from '../../store/store';
import { derive } from '../../store/derived';
import { NumInput, Field, TextInput, Select, Check, AssumeTag } from '../inputs';
import { CATEGORY_INFO, ELEC_INFO, LINE_INFO, WALL_TYPE_INFO } from '../../model/defaults';
import type { ElecKind, FurnitureCategory, LineKind, LineSurface, WallType, Level, Wall, Opening, RoofWindow, Stair, RoomMeta, ElecSymbol, ServiceLine } from '../../model/types';
import { dist, fmtCm, fmtM2, add, mul, norm, sub } from '../../geometry/vec';
import { slopePitch } from '../../geometry/ceiling';
import { snapToNearestWall } from '../../plan2d/geom2d';
import { roomStats } from '../../calc/roomStats';
import { deleteSelection, rotateSelection } from '../actions';
import { FurnitureEditor } from './FurnitureEditor';
import { splitWall, splitWallAtJunctions, transformLevel } from '../../model/ops';
import { useState } from 'react';

function useAssumed(ref: string) {
  const a = useStore((s) => s.project.assumptions);
  return a.some((x) => x.status === 'offen' && x.ref === ref);
}

export function PropertiesPanel() {
  const sel = useStore((s) => s.selection);
  const level = useLevel();
  if (!sel) return <LevelProps level={level} />;
  switch (sel.kind) {
    case 'wall':
      return <WallProps id={sel.id} />;
    case 'opening':
      return <OpeningProps id={sel.id} />;
    case 'roofWindow':
      return <RoofWindowProps id={sel.id} />;
    case 'stair':
      return <StairProps id={sel.id} />;
    case 'room':
      return <RoomProps id={sel.id} />;
    case 'furniture':
      return <FurnitureEditor id={sel.id} />;
    case 'elec':
      return <ElecProps id={sel.id} />;
    case 'line':
      return <LineProps id={sel.id} />;
    case 'dimension':
      return <DimProps id={sel.id} />;
    default:
      return <LevelProps level={level} />;
  }
}

const upd = (fn: (l: Level) => void) => useStore.getState().updateLevel(fn);

function Footer() {
  return (
    <div className="row" style={{ marginTop: 14 }}>
      <button className="danger" onClick={deleteSelection}>Löschen</button>
      <button onClick={() => useStore.getState().select(null)}>Auswahl aufheben</button>
    </div>
  );
}

function LevelProps({ level }: { level: Level }) {
  const D = derive(level);
  const assumedH = useAssumed(`level:${level.id}.ceilingHeight`);
  const assumedE = useAssumed(`level:${level.id}.elevation`);
  const bg = level.background;
  return (
    <div>
      <h3>Ebene „{level.name}“</h3>
      <Field label="Name"><TextInput value={level.name} onChange={(v) => upd((l) => void (l.name = v))} /></Field>
      <Field label="Höhe über ±0" tag={<AssumeTag show={assumedE} />}><NumInput value={level.elevation} onChange={(v) => upd((l) => void (l.elevation = v))} /></Field>
      <Field label="Deckenhöhe (flach)" tag={<AssumeTag show={assumedH} />}><NumInput value={level.ceilingHeight} min={1000} onChange={(v) => upd((l) => void (l.ceilingHeight = v))} /></Field>
      <Field label="Deckenstärke"><NumInput value={level.slabThickness} onChange={(v) => upd((l) => void (l.slabThickness = v))} /></Field>
      <p className="hint">Falls einzelne Wände eine Dachschräge haben: Wand anklicken → „Dachschräge“. Die flache Decke begrenzt Schrägen nach oben.</p>
      <LevelMove level={level} />
      <h4>Hintergrund (Grundriss-Bild/PDF)</h4>
      <div className="row">
        <label className="btnlike">
          <input
            type="file"
            accept="image/*,application/pdf"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const { loadBackgroundFile } = await import('../background');
              const res = await loadBackgroundFile(f);
              upd((l) => {
                l.background = { src: res.src, naturalWidth: res.w, naturalHeight: res.h, x: 0, y: 0, scale: 10, rotation: 0, opacity: 0.5, visible: true };
              });
              useStore.getState().setStatus('Hintergrund geladen – jetzt mit „Kalibr.“ zwei Punkte einer bekannten Strecke anklicken.');
              e.target.value = '';
            }}
          />
          <span style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}>Bild/PDF laden …</span>
        </label>
        {bg && <button onClick={() => useStore.getState().setTool('calibrate')}>Maßstab kalibrieren</button>}
        {bg && <button className="danger" onClick={() => upd((l) => void delete l.background)}>Entfernen</button>}
      </div>
      {bg && (
        <>
          <Field label="Sichtbar"><Check checked={bg.visible} onChange={(v) => upd((l) => void (l.background!.visible = v))} label="" /></Field>
          <Field label="Deckkraft"><input type="range" min={0.05} max={1} step={0.05} value={bg.opacity} onChange={(e) => upd((l) => void (l.background!.opacity = Number(e.target.value)))} /></Field>
          <Field label="Drehung"><NumInput value={bg.rotation} factor={1} unit="°" digits={1} onChange={(v) => upd((l) => void (l.background!.rotation = v))} />
            <button onClick={() => upd((l) => void (l.background!.rotation = (l.background!.rotation + 90) % 360))}>+90°</button></Field>
          <Field label="Position x / y"><NumInput value={bg.x} onChange={(v) => upd((l) => void (l.background!.x = v))} /><NumInput value={bg.y} onChange={(v) => upd((l) => void (l.background!.y = v))} /></Field>
          <Field label="Maßstab"><NumInput value={bg.scale} factor={1} digits={3} unit="mm/px" onChange={(v) => upd((l) => void (l.background!.scale = v))} /></Field>
          <Field label="Verzerrung H/B"><NumInput value={bg.aspect ?? 1} factor={1} digits={3} unit="" onChange={(v) => upd((l) => void (l.background!.aspect = v > 0 ? v : 1))} /><span className="hint">nur für nicht maßstäbliche Skizzen</span></Field>
        </>
      )}
      <h4>Übersicht</h4>
      <div className="hint">
        {level.walls.length} Wände · {level.openings.length} Öffnungen · {level.roofWindows.length} Dachfenster · {D.rooms.length} Räume · {level.furniture.length} Möbel · {level.electrical.length} Elektro · {level.lines.length} Leitungen
      </div>
      <p className="hint">Tipp: Objekt im Grundriss oder in 3D anklicken, um es zu bearbeiten. Alle Maße in cm, Komma oder Punkt erlaubt.</p>
    </div>
  );
}

/** Ganze Ebene verschieben/drehen – z. B. um Geschosse übereinander auszurichten */
function LevelMove({ level }: { level: Level }) {
  const [d, setD] = useState({ x: 0, y: 0 });
  const center = () => {
    const pts = level.walls.flatMap((w) => [w.a, w.b]);
    if (!pts.length) return { x: 0, y: 0 };
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  };
  return (
    <>
      <h4>Ebene verschieben / drehen</h4>
      <div className="hint">Zum Ausrichten der Geschosse übereinander. Tipp: in 3D „Alle Ebenen“ einschalten und im 2D-Plan die andere Ebene als Hintergrund vergleichen.</div>
      <Field label="Versatz x / y">
        <NumInput value={d.x} onChange={(v) => setD({ ...d, x: v })} />
        <NumInput value={d.y} onChange={(v) => setD({ ...d, y: v })} />
        <button onClick={() => {
          upd((l) => transformLevel(l, { dx: d.x, dy: d.y }));
          setD({ x: 0, y: 0 });
        }}>Verschieben</button>
      </Field>
      <div className="row">
        <button onClick={() => { const c = center(); upd((l) => transformLevel(l, { rotate: -90, cx: c.x, cy: c.y })); }}>⟲ 90° drehen</button>
        <button onClick={() => { const c = center(); upd((l) => transformLevel(l, { rotate: 90, cx: c.x, cy: c.y })); }}>⟳ 90° drehen</button>
        <button onClick={() => { const c = center(); upd((l) => transformLevel(l, { rotate: 180, cx: c.x, cy: c.y })); }}>180°</button>
      </div>
    </>
  );
}

function WallProps({ id }: { id: string }) {
  const level = useLevel();
  const w = level.walls.find((x) => x.id === id);
  const assumed = useAssumed(`wall:${id}`);
  if (!w) return null;
  const L = dist(w.a, w.b);
  const D = derive(level);
  const fp = D.footprintsAll.get(w.id);
  const faceLen = (side: 1 | -1) => (fp ? dist(side === 1 ? fp.plusA : fp.minusA, side === 1 ? fp.plusB : fp.minusB) : L);
  const setLen = (v: number) =>
    upd((l) => {
      const ww = l.walls.find((x) => x.id === id)!;
      const d = norm(sub(ww.b, ww.a));
      const oldB = { ...ww.b };
      ww.b = add(ww.a, mul(d, v));
      for (const o of l.walls) for (const k of ['a', 'b'] as const) if (o.id !== id && dist(o[k], oldB) < 3) o[k] = { ...ww.b };
    });
  const roomSide = (side: 1 | -1) => {
    const d = norm(sub(w.b, w.a));
    const n = { x: -d.y * side, y: d.x * side };
    const p = add(mul(add(w.a, w.b), 0.5), mul(n, w.thickness / 2 + 200));
    return D.rooms.find((r) => r.clear.some((poly) => pointIn(p, poly[0])))?.name ?? 'außen';
  };
  return (
    <div>
      <h3>Wand {w.label ? `„${w.label}“` : ''} <AssumeTag show={assumed} /></h3>
      <Field label="Bezeichnung"><TextInput value={w.label ?? ''} onChange={(v) => upd((l) => void (l.walls.find((x) => x.id === id)!.label = v))} /></Field>
      <Field label="Typ">
        <Select<WallType>
          value={w.type}
          options={(Object.keys(WALL_TYPE_INFO) as WallType[]).map((k) => ({ value: k, label: WALL_TYPE_INFO[k].label }))}
          onChange={(v) => upd((l) => void (l.walls.find((x) => x.id === id)!.type = v))}
        />
      </Field>
      <Field label="Stärke"><NumInput value={w.thickness} min={10} onChange={(v) => upd((l) => void (l.walls.find((x) => x.id === id)!.thickness = v))} /></Field>
      <Field label="Länge (Achse)"><NumInput value={L} min={10} onChange={setLen} /></Field>
      <div className="hint">Seite A ({roomSide(1)}): {fmtCm(faceLen(1))} cm · Seite B ({roomSide(-1)}): {fmtCm(faceLen(-1))} cm</div>
      <Field label="Anfang x / y"><NumInput value={w.a.x} onChange={(v) => upd((l) => moveEnd(l, id, 'a', { x: v, y: w.a.y }))} /><NumInput value={w.a.y} onChange={(v) => upd((l) => moveEnd(l, id, 'a', { x: w.a.x, y: v }))} /></Field>
      <Field label="Ende x / y"><NumInput value={w.b.x} onChange={(v) => upd((l) => moveEnd(l, id, 'b', { x: v, y: w.b.y }))} /><NumInput value={w.b.y} onChange={(v) => upd((l) => moveEnd(l, id, 'b', { x: w.b.x, y: v }))} /></Field>
      <Field label="Feste Höhe"><NumInput value={w.height} onChange={(v) => upd((l) => void (l.walls.find((x) => x.id === id)!.height = v > 0 ? v : undefined))} /><span className="hint">leer/0 = bis Decke</span></Field>
      <div className="row">
        <button title="Wand an allen T-Anschlüssen teilen – z. B. damit jeder Raum eigene Oberflächen bekommt" onClick={() => {
          let n = 0;
          upd((l) => void (n = splitWallAtJunctions(l, id)));
          useStore.getState().setStatus(n ? `Wand in ${n + 1} Teile geteilt` : 'Keine Anschlüsse auf der Wand gefunden');
        }}>An Anschlüssen teilen</button>
        <button onClick={() => {
          const v = prompt('Teilen bei Abstand vom Wandanfang (cm):', String(Math.round(L / 20)));
          const sv = v ? Number(v.replace(',', '.')) * 10 : NaN;
          if (isFinite(sv)) upd((l) => void splitWall(l, id, sv));
        }}>Teilen bei …</button>
      </div>
      <h4>Dachschräge über dieser Wand</h4>
      <Check
        checked={!!w.slope}
        label="Wand ist Kniestock mit Schräge"
        onChange={(v) =>
          upd((l) => {
            const ww = l.walls.find((x) => x.id === id)!;
            if (!v) delete ww.slope;
            else {
              // Seite zum Raum bestimmen
              const s1 = roomSide(1) !== 'außen' ? 1 : -1;
              ww.slope = { side: s1, knee: 1000, mode: 'pitch', pitchDeg: 45 };
            }
          })
        }
      />
      {w.slope && (
        <>
          <Field label="Schräge steigt zu">
            <Select value={String(w.slope.side)} options={[{ value: '1', label: `Seite A (${roomSide(1)})` }, { value: '-1', label: `Seite B (${roomSide(-1)})` }]} onChange={(v) => upd((l) => void (l.walls.find((x) => x.id === id)!.slope!.side = Number(v) as 1 | -1))} />
          </Field>
          <Field label="Kniestockhöhe"><NumInput value={w.slope.knee} onChange={(v) => upd((l) => void (l.walls.find((x) => x.id === id)!.slope!.knee = v))} /></Field>
          <Field label="Angabe über">
            <Select value={w.slope.mode} options={[{ value: 'pitch', label: 'Dachneigung' }, { value: 'ridge', label: 'Firsthöhe + Abstand' }]} onChange={(v) => upd((l) => void (l.walls.find((x) => x.id === id)!.slope!.mode = v as 'pitch' | 'ridge'))} />
          </Field>
          {w.slope.mode === 'pitch' ? (
            <Field label="Neigung"><NumInput value={w.slope.pitchDeg} factor={1} unit="°" min={5} max={85} onChange={(v) => upd((l) => void (l.walls.find((x) => x.id === id)!.slope!.pitchDeg = v))} /></Field>
          ) : (
            <>
              <Field label="Firsthöhe"><NumInput value={w.slope.ridgeHeight} onChange={(v) => upd((l) => void (l.walls.find((x) => x.id === id)!.slope!.ridgeHeight = v))} /></Field>
              <Field label="Abstand Wand→First"><NumInput value={w.slope.ridgeDistance} onChange={(v) => upd((l) => void (l.walls.find((x) => x.id === id)!.slope!.ridgeDistance = v))} /></Field>
              <div className="hint">ergibt {slopePitch(w.slope).toFixed(1).replace('.', ',')}° Neigung</div>
            </>
          )}
        </>
      )}
      <Footer />
    </div>
  );
}

function pointIn(p: { x: number; y: number }, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function moveEnd(l: Level, id: string, end: 'a' | 'b', p: { x: number; y: number }) {
  const w = l.walls.find((x) => x.id === id)!;
  const old = { ...w[end] };
  w[end] = p;
  for (const o of l.walls) for (const k of ['a', 'b'] as const) if (o.id !== id && dist(o[k], old) < 3) o[k] = { ...p };
}

function OpeningProps({ id }: { id: string }) {
  const level = useLevel();
  const o = level.openings.find((x) => x.id === id);
  if (!o) return null;
  const w = level.walls.find((x) => x.id === o.wallId) as Wall;
  const L = dist(w.a, w.b);
  const set = (fn: (oo: Opening) => void) => upd((l) => fn(l.openings.find((x) => x.id === id)!));
  const name = o.type === 'door' ? 'Tür' : o.type === 'window' ? 'Fenster' : 'Durchgang';
  return (
    <div>
      <h3>{name} <AssumeTag show={useAssumed(`opening:${id}`)} /></h3>
      <Field label="Art"><Select value={o.type} options={[{ value: 'door', label: 'Tür' }, { value: 'window', label: 'Fenster' }, { value: 'passage', label: 'Durchgang' }]} onChange={(v) => set((x) => void (x.type = v))} /></Field>
      <Field label="Breite (Rohbau)"><NumInput value={o.width} min={100} onChange={(v) => set((x) => void (x.width = v))} /></Field>
      <Field label="Höhe"><NumInput value={o.height} min={100} onChange={(v) => set((x) => void (x.height = v))} /></Field>
      {o.type === 'window' && <Field label="Brüstung"><NumInput value={o.sill} onChange={(v) => set((x) => void (x.sill = v))} /></Field>}
      <Field label="Abstand Wandanfang"><NumInput value={o.offset - o.width / 2} onChange={(v) => set((x) => void (x.offset = Math.max(x.width / 2, Math.min(L - x.width / 2, v + x.width / 2))))} /></Field>
      <Field label="Abstand Wandende"><NumInput value={L - o.offset - o.width / 2} onChange={(v) => set((x) => void (x.offset = Math.max(x.width / 2, Math.min(L - x.width / 2, L - v - x.width / 2))))} /></Field>
      {o.type !== 'passage' && (
        <>
          <Field label="Anschlag (Band)"><Select value={o.hinge ?? 'a'} options={[{ value: 'a', label: 'Seite Wandanfang' }, { value: 'b', label: 'Seite Wandende' }]} onChange={(v) => set((x) => void (x.hinge = v as 'a' | 'b'))} /></Field>
          <Field label="Öffnet nach"><Select value={String(o.swing ?? 1)} options={[{ value: '1', label: 'Seite A' }, { value: '-1', label: 'Seite B' }]} onChange={(v) => set((x) => void (x.swing = Number(v) as 1 | -1))} /></Field>
          <button onClick={() => rotateSelection(90)}>Öffnungsrichtung durchschalten (R)</button>
        </>
      )}
      <div className="hint">Mit der Maus entlang der Wand verschieben.</div>
      <Footer />
    </div>
  );
}

function RoofWindowProps({ id }: { id: string }) {
  const level = useLevel();
  const rw = level.roofWindows.find((x) => x.id === id);
  if (!rw) return null;
  const set = (fn: (o: RoofWindow) => void) => upd((l) => fn(l.roofWindows.find((x) => x.id === id)!));
  return (
    <div>
      <h3>Dachfenster</h3>
      <Field label="Breite"><NumInput value={rw.width} onChange={(v) => set((x) => void (x.width = v))} /></Field>
      <Field label="Länge (Schräge)"><NumInput value={rw.length} onChange={(v) => set((x) => void (x.length = v))} /></Field>
      <Field label="Unterkante über FFB"><NumInput value={rw.bottomHeight} onChange={(v) => set((x) => void (x.bottomHeight = v))} /></Field>
      <Field label="Position entlang Wand"><NumInput value={rw.offset} onChange={(v) => set((x) => void (x.offset = v))} /></Field>
      <div className="hint">Typische Größen: 55×78, 66×118, 78×118, 78×140, 114×118 cm.</div>
      <Footer />
    </div>
  );
}

function StairProps({ id }: { id: string }) {
  const level = useLevel();
  const s = level.stairs.find((x) => x.id === id);
  const assumed = useAssumed(`stair:${id}`);
  if (!s) return null;
  const set = (fn: (o: Stair) => void) => upd((l) => fn(l.stairs.find((x) => x.id === id)!));
  const rise = (level.elevation > 0 ? level.elevation : 2750) / s.steps;
  const tread = s.length / Math.max(1, s.steps - 1);
  return (
    <div>
      <h3>Treppe <AssumeTag show={assumed} /></h3>
      <Field label="Länge"><NumInput value={s.length} onChange={(v) => set((x) => void (x.length = v))} /></Field>
      <Field label="Breite"><NumInput value={s.width} onChange={(v) => set((x) => void (x.width = v))} /></Field>
      <Field label="Steigungen"><NumInput value={s.steps} factor={1} unit="" digits={0} min={2} onChange={(v) => set((x) => void (x.steps = Math.round(v)))} /></Field>
      <Field label="Drehung"><NumInput value={s.rotation} factor={1} unit="°" onChange={(v) => set((x) => void (x.rotation = v))} /></Field>
      <Field label="Mitte x / y"><NumInput value={s.x} onChange={(v) => set((x) => void (x.x = v))} /><NumInput value={s.y} onChange={(v) => set((x) => void (x.y = v))} /></Field>
      <Field label="Treppenloch"><Check checked={s.isOpening} onChange={(v) => set((x) => void (x.isOpening = v))} label="Treppe kommt von unten (Loch in dieser Ebene)" /></Field>
      <Field label="Laufrichtung"><Select value={s.direction} options={[{ value: 'up', label: 'aufwärts in Pfeilrichtung' }, { value: 'down', label: 'umgekehrt' }]} onChange={(v) => set((x) => void (x.direction = v as 'up' | 'down'))} /></Field>
      <Field label="Geländer"><Check checked={s.railing.left} onChange={(v) => set((x) => void (x.railing.left = v))} label="links" /><Check checked={s.railing.right} onChange={(v) => set((x) => void (x.railing.right = v))} label="rechts" /><Check checked={s.railing.end} onChange={(v) => set((x) => void (x.railing.end = v))} label="Ende" /></Field>
      <div className="hint">Steigung ≈ {fmtCm(rise)} cm, Auftritt ≈ {fmtCm(tread)} cm, Schrittmaß 2s+a = {fmtCm(2 * rise + tread)} cm (Ziel 59–65 cm).</div>
      <Footer />
    </div>
  );
}

function RoomProps({ id }: { id: string }) {
  const level = useLevel();
  const D = derive(level);
  const meta = level.rooms.find((x) => x.id === id);
  const r = D.rooms.find((x) => x.meta?.id === id);
  const assumed = useAssumed(`room:${id}`);
  if (!meta) return null;
  const set = (fn: (o: RoomMeta) => void) => upd((l) => fn(l.rooms.find((x) => x.id === id)!));
  const stats = r ? roomStats(level, r) : null;
  return (
    <div>
      <h3>Raum „{meta.name}“ <AssumeTag show={assumed} /></h3>
      <Field label="Name"><TextInput value={meta.name} onChange={(v) => set((x) => void (x.name = v))} /></Field>
      <Field label="Nutzung"><TextInput value={meta.usage ?? ''} placeholder="z. B. Bad, Küche" onChange={(v) => set((x) => void (x.usage = v))} /></Field>
      <Field label="Deckenfarbe"><input type="color" value={meta.ceilingColor ?? '#f8f8f6'} onChange={(e) => set((x) => void (x.ceilingColor = e.target.value))} /></Field>
      {stats && r && (
        <table className="tbl" style={{ marginTop: 8 }}>
          <tbody>
            <tr><td>Grundfläche (lichte Maße)</td><td className="num">{fmtM2(r.netArea)} m²</td></tr>
            <tr><td>davon Höhe ≥ 2 m (100 %)</td><td className="num">{fmtM2(stats.above2)} m²</td></tr>
            <tr><td>davon 1–2 m (50 %)</td><td className="num">{fmtM2(stats.between1and2)} m²</td></tr>
            <tr><td>davon &lt; 1 m (0 %)</td><td className="num">{fmtM2(stats.below1)} m²</td></tr>
            <tr><td><b>Wohnfläche (WoFlV)</b></td><td className="num"><b>{fmtM2(stats.living)} m²</b></td></tr>
            <tr><td>Raumhöhe min–max</td><td className="num">{fmtCm(stats.minHeight)}–{fmtCm(stats.maxHeight)} cm</td></tr>
            <tr><td>Umfang (lichte Maße)</td><td className="num">{(stats.perimeter / 1000).toFixed(2).replace('.', ',')} m</td></tr>
          </tbody>
        </table>
      )}
      <div className="hint">Bodenbelag im Tab „Oberflächen“. Die Beschriftung kann mit der Maus verschoben werden.</div>
      <Footer />
    </div>
  );
}

function ElecProps({ id }: { id: string }) {
  const level = useLevel();
  const e = level.electrical.find((x) => x.id === id);
  const settings = useStore((s) => s.project.settings);
  if (!e) return null;
  const set = (fn: (o: ElecSymbol) => void) => upd((l) => fn(l.electrical.find((x) => x.id === id)!));
  return (
    <div>
      <h3>{ELEC_INFO[e.kind].label}</h3>
      <Field label="Art">
        <Select<ElecKind> value={e.kind} options={(Object.keys(ELEC_INFO) as ElecKind[]).map((k) => ({ value: k, label: ELEC_INFO[k].label }))} onChange={(v) => set((x) => void (x.kind = v))} />
      </Field>
      <Field label="Bezeichnung"><TextInput value={e.label ?? ''} onChange={(v) => set((x) => void (x.label = v))} /></Field>
      <Field label="Höhe (Mitte)"><NumInput value={e.height} onChange={(v) => set((x) => void (x.height = v))} /></Field>
      <div className="row">
        <button onClick={() => set((x) => void (x.height = settings.defaultHeights.steckdose))}>Steckdose {fmtCm(settings.defaultHeights.steckdose)}</button>
        <button onClick={() => set((x) => void (x.height = settings.defaultHeights.schalter))}>Schalter {fmtCm(settings.defaultHeights.schalter)}</button>
        <button onClick={() => set((x) => { x.height = settings.defaultHeights.arbeitsflaeche; x.aboveWorktop = true; })}>Arbeitsfläche {fmtCm(settings.defaultHeights.arbeitsflaeche)}</button>
      </div>
      <Field label="Über Arbeitsfläche"><Check checked={!!e.aboveWorktop} onChange={(v) => set((x) => void (x.aboveWorktop = v))} label="ZW-m erlaubt" /></Field>
      <Field label="Position x / y"><NumInput value={e.x} onChange={(v) => set((x) => void (x.x = v))} /><NumInput value={e.y} onChange={(v) => set((x) => void (x.y = v))} /></Field>
      <div className="hint">{e.wallId ? 'An Wand angedockt (beim Ziehen fängt das Symbol die nächste Wandfläche).' : 'Frei platziert (Decke/Raum).'}</div>
      <Footer />
    </div>
  );
}

function LineProps({ id }: { id: string }) {
  const level = useLevel();
  const sel = useStore((s) => s.selection);
  const ln = level.lines.find((x) => x.id === id);
  if (!ln) return null;
  const set = (fn: (o: ServiceLine) => void) => upd((l) => fn(l.lines.find((x) => x.id === id)!));
  let len = 0;
  for (let i = 1; i < ln.points.length; i++) {
    const a = ln.points[i - 1], b = ln.points[i];
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return (
    <div>
      <h3>Leitung: {LINE_INFO[ln.kind].label}</h3>
      <Field label="Art"><Select<LineKind> value={ln.kind} options={(Object.keys(LINE_INFO) as LineKind[]).map((k) => ({ value: k, label: LINE_INFO[k].label }))} onChange={(v) => set((x) => void (x.kind = v))} /></Field>
      <Field label="Verlauf"><Select<LineSurface> value={ln.surface} options={[{ value: 'wand', label: 'Wand' }, { value: 'decke', label: 'Decke' }, { value: 'boden', label: 'Boden/Estrich' }]} onChange={(v) => set((x) => void (x.surface = v))} /></Field>
      <Field label="Bezeichnung"><TextInput value={ln.label ?? ''} onChange={(v) => set((x) => void (x.label = v))} /></Field>
      <div className="hint">Gesamtlänge {(len / 1000).toFixed(2).replace('.', ',')} m</div>
      <table className="tbl">
        <thead><tr><th>#</th><th>x</th><th>y</th><th>Höhe z</th><th /></tr></thead>
        <tbody>
          {ln.points.map((p, i) => (
            <tr key={i} style={{ background: sel?.sub === i ? 'var(--accent-soft)' : undefined }}>
              <td>{i + 1}</td>
              <td><NumInput width={56} unit="" value={p.x} onChange={(v) => set((x) => void (x.points[i].x = v))} /></td>
              <td><NumInput width={56} unit="" value={p.y} onChange={(v) => set((x) => void (x.points[i].y = v))} /></td>
              <td><NumInput width={50} unit="" value={p.z} onChange={(v) => set((x) => void (x.points[i].z = v))} /></td>
              <td>
                <button title="Punkt einfügen" onClick={() => set((x) => void x.points.splice(i + 1, 0, { ...x.points[i], z: x.points[i].z + 300 }))}>+</button>
                {ln.points.length > 2 && <button title="Punkt löschen" onClick={() => set((x) => void x.points.splice(i, 1))}>×</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">Werte in cm. Senkrechte Abschnitte: zwei Punkte mit gleichem x/y und unterschiedlicher Höhe.</div>
      <Footer />
    </div>
  );
}

function DimProps({ id }: { id: string }) {
  const level = useLevel();
  const dm = level.dimensions.find((x) => x.id === id);
  if (!dm) return null;
  return (
    <div>
      <h3>Maßlinie</h3>
      <div className="hint">Länge {fmtCm(dist(dm.a, dm.b))} cm</div>
      <Field label="Abstand"><NumInput value={dm.offset} onChange={(v) => upd((l) => void (l.dimensions.find((x) => x.id === id)!.offset = v))} /></Field>
      <Footer />
    </div>
  );
}

export { CATEGORY_INFO, snapToNearestWall };
export type { FurnitureCategory };
