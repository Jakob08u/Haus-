import { useMemo, useState } from 'react';
import { useStore, useLevel } from '../../store/store';
import { derive } from '../../store/derived';
import type { FloorPattern, Material, MaterialKind, SurfaceFinish, FinishKind, Level } from '../../model/types';
import { NumInput, Field, TextInput, Select } from '../inputs';
import { fileToDataUrl, dominantColor } from '../background';
import { materialList, materialSummary, patternLabel, wallFaces } from '../../calc/materials';
import { uid, fmtM2 } from '../../geometry/vec';
import { roomStats } from '../../calc/roomStats';

const KIND_LABEL: Record<MaterialKind, string> = { wallpaper: 'Tapete', tile: 'Fliese', floor: 'Bodenbelag (Diele/Planke)', paint: 'Farbe' };
const PATTERNS: FloorPattern[] = ['third', 'half', 'random', 'shipdeck', 'straight', 'herringbone'];
const upd = (fn: (l: Level) => void) => useStore.getState().updateLevel(fn);

function FinishEditor({ value, onChange, allowTile = true, label }: { value?: SurfaceFinish; onChange: (f: SurfaceFinish | undefined) => void; allowTile?: boolean; label: string }) {
  const materials = useStore((s) => s.project.materials);
  const kind: FinishKind = value?.kind ?? 'none';
  const mats = materials.filter((m) => (kind === 'wallpaper' ? m.kind === 'wallpaper' : kind === 'tile' ? m.kind === 'tile' : false));
  return (
    <div className="item" style={{ cursor: 'default' }}>
      <div className="row" style={{ margin: 0 }}>
        <b style={{ flex: 1 }}>{label}</b>
        <Select<FinishKind>
          value={kind}
          options={[
            { value: 'none', label: 'Standard (weiß)' },
            { value: 'paint', label: 'Farbe' },
            { value: 'wallpaper', label: 'Tapete' },
            ...(allowTile ? [{ value: 'tile' as FinishKind, label: 'Fliesen' }] : []),
          ]}
          onChange={(k) => {
            if (k === 'none') onChange(undefined);
            else if (k === 'paint') onChange({ kind: 'paint', color: value?.color ?? '#e9e4da' });
            else {
              const first = materials.find((m) => m.kind === (k === 'wallpaper' ? 'wallpaper' : 'tile'));
              onChange({ kind: k, materialId: first?.id, maxHeight: k === 'tile' ? value?.maxHeight : undefined });
            }
          }}
        />
      </div>
      {kind === 'paint' && (
        <div className="row">
          <input type="color" value={value?.color ?? '#e9e4da'} onChange={(e) => onChange({ ...value!, color: e.target.value })} />
          {['#f7f7f4', '#e9e4da', '#d7e3e8', '#c9d6c3', '#e8d3c3', '#5b6770'].map((c) => (
            <button key={c} style={{ padding: 0, width: 22, height: 22, background: c }} onClick={() => onChange({ ...value!, color: c })} />
          ))}
        </div>
      )}
      {(kind === 'wallpaper' || kind === 'tile') && (
        <div className="row">
          <select value={value?.materialId ?? ''} onChange={(e) => onChange({ ...value!, materialId: e.target.value })}>
            {mats.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {mats.length === 0 && <span className="hint">Erst unten ein Material anlegen.</span>}
          {kind === 'tile' && (
            <>
              <span className="hint">bis Höhe</span>
              <NumInput value={value?.maxHeight} width={50} onChange={(v) => onChange({ ...value!, maxHeight: v > 0 ? v : undefined })} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MaterialEditor({ m, onClose }: { m: Material; onClose: () => void }) {
  const st = useStore.getState;
  const set = (patch: Partial<Material>) => st().update((d) => void Object.assign(d.materials.find((x) => x.id === m.id)!, patch));
  return (
    <div className="item" style={{ cursor: 'default', borderColor: 'var(--accent)' }}>
      <Field label="Name"><TextInput value={m.name} onChange={(v) => set({ name: v })} /></Field>
      <Field label="Bild">
        <label>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const src = await fileToDataUrl(f, 1024);
              const c = await dominantColor(src);
              set({ image: src, ...(c ? { color: c } : {}) });
            }}
          />
          <span style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>{m.image ? 'Bild ersetzen …' : 'Bild hochladen …'}</span>
        </label>
        {m.image && <img className="thumb" src={m.image} alt="" />}
        {m.image && <button onClick={() => set({ image: undefined })}>×</button>}
      </Field>
      <Field label="Grundfarbe"><input type="color" value={m.color} onChange={(e) => set({ color: e.target.value })} /></Field>
      {m.kind === 'wallpaper' && (
        <>
          <Field label="Bahnbreite"><NumInput value={m.rollWidth} onChange={(v) => set({ rollWidth: v })} /></Field>
          <Field label="Rollenlänge"><NumInput value={m.rollLength} factor={1000} digits={2} unit="m" onChange={(v) => set({ rollLength: v })} /></Field>
          <Field label="Rapport"><NumInput value={m.repeat} onChange={(v) => set({ repeat: v })} /><span className="hint">0 = ohne</span></Field>
          <Field label="Ansatz"><Select value={m.repeatOffset ? 'v' : 'g'} options={[{ value: 'g', label: 'gerader Ansatz' }, { value: 'v', label: 'versetzter Ansatz' }]} onChange={(v) => set({ repeatOffset: v === 'v' })} /></Field>
        </>
      )}
      {(m.kind === 'tile' || m.kind === 'floor') && (
        <>
          <Field label={m.kind === 'tile' ? 'Fliese L × B' : 'Diele L × B'}>
            <NumInput value={m.tileLength} width={50} unit="" onChange={(v) => set({ tileLength: v })} />×<NumInput value={m.tileWidth} width={50} onChange={(v) => set({ tileWidth: v })} />
          </Field>
          {m.kind === 'tile' && <Field label="Fuge"><NumInput value={m.joint} factor={1} unit="mm" onChange={(v) => set({ joint: v })} /></Field>}
          <Field label="Paketinhalt"><NumInput value={m.packageArea} factor={1e6} digits={3} unit="m²" onChange={(v) => set({ packageArea: v })} /></Field>
        </>
      )}
      {m.kind === 'paint' && (
        <>
          <Field label="Ergiebigkeit"><NumInput value={m.coverage} factor={1} unit="m²/l" onChange={(v) => set({ coverage: v })} /></Field>
          <Field label="Gebinde"><NumInput value={m.containerLiters} factor={1} unit="l" onChange={(v) => set({ containerLiters: v })} /></Field>
        </>
      )}
      <Field label={m.kind === 'wallpaper' ? 'Preis/Rolle' : m.kind === 'paint' ? 'Preis/Gebinde' : 'Preis/Paket'}><NumInput value={m.price} factor={1} digits={2} unit="€" onChange={(v) => set({ price: v })} /></Field>
      <Field label="Link"><TextInput value={m.url ?? ''} onChange={(v) => set({ url: v || undefined })} /></Field>
      <div className="row">
        <button onClick={onClose}>Fertig</button>
        <button className="danger" onClick={() => {
          if (!confirm(`Material „${m.name}“ löschen?`)) return;
          st().update((d) => void (d.materials = d.materials.filter((x) => x.id !== m.id)));
          onClose();
        }}>Löschen</button>
      </div>
    </div>
  );
}

export default function MaterialsPanel() {
  const level = useLevel();
  const project = useStore((s) => s.project);
  const sel = useStore((s) => s.selection);
  const st = useStore.getState;
  const D = derive(level);
  const [editing, setEditing] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const summary = useMemo(() => materialSummary(project), [project]);
  const details = useMemo(() => (showDetail ? materialList(project) : []), [project, showDetail]);

  const wall = sel?.kind === 'wall' ? level.walls.find((w) => w.id === sel.id) : undefined;
  const roomMeta = sel?.kind === 'room' ? level.rooms.find((r) => r.id === sel.id) : undefined;
  const room = roomMeta ? D.rooms.find((r) => r.meta?.id === roomMeta.id) : undefined;
  const faces = useMemo(() => wallFaces(level), [level]);

  const setWallFinish = (wid: string, side: 'left' | 'right' | 'slope', f?: SurfaceFinish) =>
    upd((l) => {
      const w = l.walls.find((x) => x.id === wid)!;
      w.finishes = { ...(w.finishes ?? {}), [side]: f };
    });

  const total = summary.reduce((s, x) => s + (x.price ?? 0), 0);

  return (
    <div>
      <h3>Oberflächen & Material</h3>
      {!wall && !room && <p className="hint">Wand anklicken → Wandseiten (und Schräge) belegen. Raum anklicken (Beschriftung bzw. Boden in 3D) → Boden und alle Wände des Raums.</p>}

      {wall && (
        <>
          <h4>Wand {wall.label ? `„${wall.label}“` : ''}</h4>
          {([1, -1] as const).map((side) => {
            const f = faces.find((x) => x.wall.id === wall.id && x.side === side);
            if (!f) return <div key={side} className="hint">Seite {side === 1 ? 'A' : 'B'}: Außenseite</div>;
            return (
              <div key={side}>
                <FinishEditor label={`Seite ${side === 1 ? 'A' : 'B'} → ${f.roomName}`} value={side === 1 ? wall.finishes?.left : wall.finishes?.right} onChange={(x) => setWallFinish(wall.id, side === 1 ? 'left' : 'right', x)} />
                <div className="hint" style={{ margin: '2px 0 6px' }}>
                  {fmtM2(f.grossArea)} m² brutto, {fmtM2(f.grossArea - f.openingArea)} m² netto · Breite {(f.width / 1000).toFixed(2).replace('.', ',')} m
                </div>
              </div>
            );
          })}
          {wall.slope && <FinishEditor label="Dachschräge über dieser Wand" allowTile={false} value={wall.finishes?.slope} onChange={(x) => setWallFinish(wall.id, 'slope', x)} />}
        </>
      )}

      {room && roomMeta && (
        <>
          <h4>Boden „{roomMeta.name}“</h4>
          <Field label="Belag">
            <select
              value={roomMeta.floor?.materialId ?? ''}
              onChange={(e) =>
                upd((l) => {
                  const r = l.rooms.find((x) => x.id === roomMeta.id)!;
                  r.floor = { pattern: 'third', rotation: 0, ...(r.floor ?? {}), materialId: e.target.value || undefined };
                })
              }
            >
              <option value="">– keiner –</option>
              {project.materials.filter((m) => m.kind === 'floor' || m.kind === 'tile').map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Verlegemuster">
            <Select<FloorPattern> value={roomMeta.floor?.pattern ?? 'third'} options={PATTERNS.map((p) => ({ value: p, label: patternLabel(p) }))} onChange={(v) => upd((l) => void (l.rooms.find((x) => x.id === roomMeta.id)!.floor = { rotation: 0, ...(l.rooms.find((x) => x.id === roomMeta.id)!.floor ?? {}), pattern: v }))} />
          </Field>
          <Field label="Drehung">
            <NumInput value={roomMeta.floor?.rotation ?? 0} factor={1} unit="°" onChange={(v) => upd((l) => void (l.rooms.find((x) => x.id === roomMeta.id)!.floor = { pattern: 'third', ...(l.rooms.find((x) => x.id === roomMeta.id)!.floor ?? {}), rotation: v }))} />
            {[0, 45, 90].map((a) => (
              <button key={a} onClick={() => upd((l) => void (l.rooms.find((x) => x.id === roomMeta.id)!.floor = { pattern: 'third', ...(l.rooms.find((x) => x.id === roomMeta.id)!.floor ?? {}), rotation: a }))}>{a}°</button>
            ))}
          </Field>
          <Field label="Verschnitt">
            <NumInput value={roomMeta.floor?.waste ?? project.settings.wastePercent} factor={1} unit="%" onChange={(v) => upd((l) => void (l.rooms.find((x) => x.id === roomMeta.id)!.floor = { pattern: 'third', rotation: 0, ...(l.rooms.find((x) => x.id === roomMeta.id)!.floor ?? {}), waste: v }))} />
          </Field>
          <Field label="Türlaibungen">
            <input type="checkbox" checked={!!roomMeta.floor?.includeReveals} onChange={(e) => upd((l) => void (l.rooms.find((x) => x.id === roomMeta.id)!.floor = { pattern: 'third', rotation: 0, ...(l.rooms.find((x) => x.id === roomMeta.id)!.floor ?? {}), includeReveals: e.target.checked }))} /> mitrechnen
          </Field>
          <div className="hint">Grundfläche {fmtM2(room.netArea)} m² · Wohnfläche {fmtM2(roomStats(level, room).living)} m²</div>
          <h4>Alle Wände in „{roomMeta.name}“</h4>
          <FinishEditor
            label={`${faces.filter((f) => f.roomName === room.name).length} Wandflächen`}
            value={faces.find((f) => f.roomName === room.name)?.finish}
            onChange={(x) =>
              upd((l) => {
                for (const f of faces.filter((ff) => ff.roomName === room.name)) {
                  const w = l.walls.find((ww) => ww.id === f.wall.id)!;
                  w.finishes = { ...(w.finishes ?? {}), [f.side === 1 ? 'left' : 'right']: x };
                }
              })
            }
          />
          {level.walls.some((w) => w.slope) && (
            <FinishEditor
              label="Schrägen in diesem Raum"
              allowTile={false}
              value={undefined}
              onChange={(x) =>
                upd((l) => {
                  for (const pl of D.ceiling.planes) {
                    const w = l.walls.find((ww) => ww.id === pl.wallId)!;
                    const faceHere = faces.some((f) => f.wall.id === w.id && f.roomName === room.name);
                    if (faceHere) w.finishes = { ...(w.finishes ?? {}), slope: x };
                  }
                })
              }
            />
          )}
        </>
      )}

      <h4>Materialbibliothek</h4>
      <div className="list">
        {project.materials.map((m) =>
          editing === m.id ? (
            <MaterialEditor key={m.id} m={m} onClose={() => setEditing(null)} />
          ) : (
            <div key={m.id} className="item" onClick={() => setEditing(m.id)}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {m.image ? <img className="thumb" style={{ width: 30, height: 30 }} src={m.image} alt="" /> : <span className="swatch" style={{ background: m.color, width: 30, height: 30 }} />}
                <div>
                  {m.name}
                  <div className="sub">
                    {KIND_LABEL[m.kind]}
                    {m.kind === 'wallpaper' && ` · ${(m.rollWidth ?? 0) / 10} cm × ${((m.rollLength ?? 0) / 1000).toFixed(2).replace('.', ',')} m, Rapport ${(m.repeat ?? 0) / 10} cm`}
                    {(m.kind === 'tile' || m.kind === 'floor') && ` · ${(m.tileLength ?? 0) / 10} × ${(m.tileWidth ?? 0) / 10} cm${m.packageArea ? `, ${(m.packageArea / 1e6).toFixed(2).replace('.', ',')} m²/Paket` : ''}`}
                  </div>
                </div>
              </div>
            </div>
          ),
        )}
      </div>
      <div className="row">
        {(Object.keys(KIND_LABEL) as MaterialKind[]).map((k) => (
          <button
            key={k}
            onClick={() => {
              const m: Material = {
                id: uid('mat'),
                kind: k,
                name: `Neue ${KIND_LABEL[k].split(' ')[0]}`,
                color: '#d9d2c5',
                ...(k === 'wallpaper' ? { rollWidth: 530, rollLength: 10050, repeat: 0 } : {}),
                ...(k === 'tile' ? { tileLength: 600, tileWidth: 300, joint: 3, packageArea: 1440000 } : {}),
                ...(k === 'floor' ? { tileLength: 1220, tileWidth: 180, joint: 0, packageArea: 2196000 } : {}),
                ...(k === 'paint' ? { coverage: 7, containerLiters: 10 } : {}),
              };
              st().update((d) => void d.materials.push(m));
              setEditing(m.id);
            }}
          >
            + {KIND_LABEL[k].split(' ')[0]}
          </button>
        ))}
      </div>

      <h4>Materialbedarf (alle Ebenen)</h4>
      {summary.length === 0 && <p className="hint">Noch keine Oberflächen belegt.</p>}
      <table className="tbl">
        <tbody>
          {summary.map((s, i) => (
            <tr key={i}>
              <td>{s.name}<div className="hint" style={{ margin: 0 }}>{s.kind}</div></td>
              <td className="num">{s.quantity}</td>
              <td className="num">{s.price != null ? `${s.price.toFixed(2).replace('.', ',')} €` : ''}</td>
            </tr>
          ))}
          {total > 0 && (
            <tr>
              <td><b>Summe</b></td>
              <td />
              <td className="num"><b>{total.toFixed(2).replace('.', ',')} €</b></td>
            </tr>
          )}
        </tbody>
      </table>
      <label className="hint" style={{ display: 'block', marginTop: 6 }}>
        <input type="checkbox" checked={showDetail} onChange={(e) => setShowDetail(e.target.checked)} /> Rechenweg je Raum/Wand anzeigen
      </label>
      {showDetail &&
        details.map((d, i) => (
          <div key={i} className="item" style={{ cursor: 'default' }}>
            <b>{d.kind}</b> · {d.where}
            <div className="sub">{d.name}: {d.quantity}</div>
            <div className="sub">{d.detail}</div>
          </div>
        ))}
      <Field label="Standard-Verschnitt"><NumInput value={project.settings.wastePercent} factor={1} unit="%" onChange={(v) => st().update((d) => void (d.settings.wastePercent = v))} /></Field>
    </div>
  );
}
