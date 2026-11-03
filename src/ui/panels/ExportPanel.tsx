import { useState } from 'react';
import { useStore } from '../../store/store';
import { downloadBlob, exportProjectJson } from '../../store/persist';
import { buildPdf } from '../../export/pdf';
import { drawPlan, planBounds } from '../../export/drawPlan';
import { Check } from '../inputs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bilder aus gespeicherten Kamerapositionen (3D-Ansicht muss sichtbar sein) */
async function captureViews(ids: string[]): Promise<{ name: string; dataUrl: string; w: number; h: number }[]> {
  const st = useStore.getState();
  const prevView = st.view;
  const prevLevel = st.levelId;
  if (st.view === '2d') {
    st.setView('3d');
    await sleep(2500);
  }
  const out: { name: string; dataUrl: string; w: number; h: number }[] = [];
  for (const id of ids) {
    const cam = useStore.getState().project.cameras.find((c) => c.id === id);
    if (!cam) continue;
    if (useStore.getState().levelId !== cam.levelId) {
      useStore.getState().setLevel(cam.levelId);
      await sleep(1500);
    }
    useStore.getState().requestCamera({ position: cam.position, target: cam.target, mode: 'orbit' });
    await sleep(1600);
    const gl = (window as any).__raumplanerGL as { domElement: HTMLCanvasElement } | undefined;
    if (gl) out.push({ name: cam.name, dataUrl: gl.domElement.toDataURL('image/jpeg', 0.9), w: gl.domElement.width, h: gl.domElement.height });
  }
  if (useStore.getState().levelId !== prevLevel) useStore.getState().setLevel(prevLevel);
  if (prevView !== useStore.getState().view) useStore.getState().setView(prevView);
  return out;
}

export default function ExportPanel() {
  const project = useStore((s) => s.project);
  const st = useStore.getState;
  const [levels, setLevels] = useState<string[]>(project.levels.map((l) => l.id));
  const [sec, setSec] = useState({ grundriss: true, elektro: true, material: true, moebel: true, pruefung: true });
  const [camSel, setCamSel] = useState<string[]>(project.cameras.map((c) => c.id));
  const [busy, setBusy] = useState('');

  const makePdf = async () => {
    setBusy('Erzeuge Ansichten …');
    try {
      const images = camSel.length ? await captureViews(camSel) : [];
      setBusy('Erzeuge PDF …');
      await sleep(50);
      const doc = buildPdf(st().project, { levelIds: levels, ...sec, images });
      doc.save(`${project.name.replace(/[^\wäöüÄÖÜß -]+/g, '') || 'Projekt'} – Planung.pdf`);
    } catch (e) {
      alert('PDF-Fehler: ' + (e as Error).message);
      console.error(e);
    } finally {
      setBusy('');
    }
  };

  const exportImages = async () => {
    setBusy('Erzeuge Bilder …');
    try {
      const imgs = await captureViews(camSel);
      for (const im of imgs) {
        const blob = await (await fetch(im.dataUrl)).blob();
        downloadBlob(blob, `${project.name} – ${im.name}.jpg`);
        await sleep(300);
      }
    } finally {
      setBusy('');
    }
  };

  const planPng = (levelId: string, mode: 'grundriss' | 'elektro') => {
    const l = project.levels.find((x) => x.id === levelId)!;
    const b = planBounds(l);
    const pxPerMM = 0.12; // ≈ 1:83 bei 100 dpi
    const c = document.createElement('canvas');
    c.width = Math.round(b.w * pxPerMM);
    c.height = Math.round(b.h * pxPerMM);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    drawPlan(ctx, l, project, { k: pxPerMM, ox: -b.minX * pxPerMM, oy: -b.minY * pxPerMM, font: 13, lw: 1.6 }, mode);
    c.toBlob((blob) => blob && downloadBlob(blob, `${project.name} – ${l.name} – ${mode === 'grundriss' ? 'Grundriss' : 'Elektroplan'}.png`));
  };

  return (
    <div>
      <h3>Vorschau & Export</h3>
      <h4>Gespeicherte Ansichten ({project.cameras.length})</h4>
      {project.cameras.length === 0 && <p className="hint">In der 3D-Ansicht „📷 Ansicht speichern“ klicken, um Kamerapositionen für Bilder und PDF zu sichern.</p>}
      <div className="list">
        {project.cameras.map((c) => (
          <div key={c.id} className="item" style={{ cursor: 'default' }}>
            <div className="row" style={{ margin: 0 }}>
              <input type="checkbox" checked={camSel.includes(c.id)} onChange={(e) => setCamSel(e.target.checked ? [...camSel, c.id] : camSel.filter((x) => x !== c.id))} />
              <span style={{ flex: 1 }}>{c.name} <span className="sub">({project.levels.find((l) => l.id === c.levelId)?.name})</span></span>
              <button onClick={() => {
                if (st().view === '2d') st().setView('split');
                if (st().levelId !== c.levelId) st().setLevel(c.levelId);
                setTimeout(() => st().requestCamera({ position: c.position, target: c.target, mode: c.mode }), 300);
              }}>Zeigen</button>
              <button onClick={() => {
                const n = prompt('Name:', c.name);
                if (n) st().update((d) => void (d.cameras.find((x) => x.id === c.id)!.name = n));
              }}>✎</button>
              <button className="danger" onClick={() => st().update((d) => void (d.cameras = d.cameras.filter((x) => x.id !== c.id)))}>×</button>
            </div>
          </div>
        ))}
      </div>
      {project.cameras.length > 0 && <button disabled={!!busy || !camSel.length} onClick={exportImages} style={{ marginTop: 6 }}>Bilder der gewählten Ansichten herunterladen</button>}

      <h4>PDF</h4>
      <div className="row">
        {project.levels.map((l) => (
          <Check key={l.id} checked={levels.includes(l.id)} onChange={(v) => setLevels(v ? [...levels, l.id] : levels.filter((x) => x !== l.id))} label={l.name} />
        ))}
      </div>
      <div className="list">
        <Check checked={sec.grundriss} onChange={(v) => setSec({ ...sec, grundriss: v })} label="Grundriss mit Maßketten (maßstäblich)" />
        <Check checked={sec.elektro} onChange={(v) => setSec({ ...sec, elektro: v })} label="Elektro- und Leitungsplan" />
        <Check checked={sec.material} onChange={(v) => setSec({ ...sec, material: v })} label="Materialliste (Tapete, Boden, Fliesen, Farbe, Leitungen)" />
        <Check checked={sec.moebel} onChange={(v) => setSec({ ...sec, moebel: v })} label="Möbelliste mit Links und Gesamtpreis" />
        <Check checked={sec.pruefung} onChange={(v) => setSec({ ...sec, pruefung: v })} label="Prüfbericht „Passt alles?“" />
        <span className="hint">+ Bilder der gewählten Ansichten ({camSel.length})</span>
      </div>
      <button className="primary" disabled={!!busy || !levels.length} onClick={makePdf} style={{ marginTop: 8 }}>
        {busy || 'PDF erstellen'}
      </button>

      <h4>Pläne als Bild</h4>
      {project.levels.map((l) => (
        <div className="row" key={l.id}>
          <span style={{ width: 110 }}>{l.name}</span>
          <button onClick={() => planPng(l.id, 'grundriss')}>Grundriss PNG</button>
          <button onClick={() => planPng(l.id, 'elektro')}>Elektroplan PNG</button>
        </div>
      ))}

      <h4>Projektdatei</h4>
      <button onClick={() => exportProjectJson(project)}>Projekt als JSON speichern</button>
      <p className="hint">Alle Daten bleiben lokal: Autosave im Browser (IndexedDB), Export/Import als JSON-Datei. Kein Konto, kein Tracking.</p>
    </div>
  );
}
