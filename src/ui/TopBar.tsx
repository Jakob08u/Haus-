import { useRef, useState } from 'react';
import { useStore } from '../store/store';
import { exportProjectJson, importProjectFile, loadStartProject } from '../store/persist';
import { emptyProject, emptyLevel } from '../model/defaults';
import type { LayerKey } from '../model/types';
import { TextInput } from './inputs';

const LAYER_LABELS: [LayerKey, string][] = [
  ['grundriss', 'Wände/Öffnungen/Treppen'],
  ['hintergrund', 'Hintergrundbild'],
  ['unterlage', 'Geschoss darunter (Unterlage)'],
  ['raster', 'Raster'],
  ['masse', 'Maße'],
  ['raeume', 'Räume'],
  ['schraegen', 'Dachschrägen'],
  ['moebel', 'Möbel'],
  ['bewegung', 'Bewegungsflächen'],
  ['elektro', 'Elektro-Symbole'],
  ['strom', 'Leitungen Strom'],
  ['wasser', 'Leitungen Wasser'],
  ['abwasser', 'Leitungen Abwasser'],
  ['heizung', 'Leitungen Heizung'],
  ['lan', 'Leitungen LAN'],
  ['zonen', 'Installationszonen'],
  ['warnungen', 'Warnungen'],
];

export function TopBar() {
  const project = useStore((s) => s.project);
  const levelId = useStore((s) => s.levelId);
  const view = useStore((s) => s.view);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const layers = useStore((s) => s.layers);
  const st = useStore.getState;
  const fileRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<'file' | 'layers' | null>(null);

  return (
    <div className="topbar" onMouseLeave={() => setOpenMenu(null)}>
      <span className="title">🏠</span>
      <TextInput value={project.name} onChange={(v) => st().update((d) => void (d.name = v))} width={170} />
      <div className="dropdown">
        <button onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}>Datei ▾</button>
        {openMenu === 'file' && (
          <div className="menu" onClick={() => setOpenMenu(null)}>
            <div className="list">
              <button onClick={() => exportProjectJson(st().project)}>Projekt speichern (JSON) …</button>
              <button onClick={() => fileRef.current?.click()}>Projekt öffnen (JSON) …</button>
              <button
                onClick={async () => {
                  if (confirm('Startprojekt aus dem Grundriss neu laden? Aktuelle Änderungen gehen verloren (vorher speichern!).')) st().setProject(await loadStartProject(), true);
                }}
              >
                Startprojekt (Grundriss) laden
              </button>
              <button
                onClick={() => {
                  if (confirm('Leeres Projekt anlegen? Aktuelle Änderungen gehen verloren (vorher speichern!).')) st().setProject(emptyProject(), true);
                }}
              >
                Neues leeres Projekt
              </button>
            </div>
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            st().setProject(await importProjectFile(f), true);
            st().setStatus(`Projekt „${f.name}“ geladen`);
          } catch (err) {
            alert('Fehler beim Öffnen: ' + err);
          }
          e.target.value = '';
        }}
      />
      <span className="sep" />
      <button disabled={!past} onClick={() => st().undo()} title="Rückgängig (Strg+Z)">↶</button>
      <button disabled={!future} onClick={() => st().redo()} title="Wiederholen (Strg+Y)">↷</button>
      <span className="sep" />
      {project.levels.map((l) => (
        <button key={l.id} className={l.id === levelId ? 'active' : ''} onClick={() => st().setLevel(l.id)} onDoubleClick={() => {
          const n = prompt('Ebene umbenennen:', l.name);
          if (n) st().update((d) => void (d.levels.find((x) => x.id === l.id)!.name = n));
        }}>
          {l.name}
        </button>
      ))}
      <button
        title="Ebene hinzufügen"
        onClick={() => {
          const name = prompt('Name der neuen Ebene:', 'Neue Ebene');
          if (!name) return;
          const lvl = emptyLevel(name, 0);
          st().update((d) => void d.levels.push(lvl));
          st().setLevel(lvl.id);
        }}
      >
        +
      </button>
      <span className="sep" />
      <button className={view === '2d' ? 'active' : ''} onClick={() => st().setView('2d')}>2D</button>
      <button className={view === 'split' ? 'active' : ''} onClick={() => st().setView('split')}>2D | 3D</button>
      <button className={view === '3d' ? 'active' : ''} onClick={() => st().setView('3d')}>3D</button>
      <button onClick={() => window.dispatchEvent(new Event('plan-fit'))} title="Grundriss einpassen">⤢</button>
      <div className="dropdown">
        <button onClick={() => setOpenMenu(openMenu === 'layers' ? null : 'layers')}>Ebenen ▾</button>
        {openMenu === 'layers' && (
          <div className="menu">
            {LAYER_LABELS.map(([k, label]) => (
              <label key={k}>
                <input type="checkbox" checked={layers[k]} onChange={() => st().toggleLayer(k)} /> {label}
              </label>
            ))}
          </div>
        )}
      </div>
      <span className="sep" />
      <label title="Rasterweite">
        Raster{' '}
        <select value={project.settings.gridSize} onChange={(e) => st().update((d) => void (d.settings.gridSize = Number(e.target.value)))}>
          {[10, 50, 100, 250, 500].map((g) => (
            <option key={g} value={g}>{g / 10} cm</option>
          ))}
        </select>
      </label>
      <label><input type="checkbox" checked={project.settings.snapGrid} onChange={(e) => st().update((d) => void (d.settings.snapGrid = e.target.checked))} /> Rasterfang</label>
      <label><input type="checkbox" checked={project.settings.snapAngle} onChange={(e) => st().update((d) => void (d.settings.snapAngle = e.target.checked))} /> 45°</label>
      <label><input type="checkbox" checked={project.settings.snapEndpoints} onChange={(e) => st().update((d) => void (d.settings.snapEndpoints = e.target.checked))} /> Punktfang</label>
    </div>
  );
}
