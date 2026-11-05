import { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from './store/store';
import { loadInitialProject, requestPersistentStorage, startAutosave } from './store/persist';
import { STATIC } from './config';
import { Welcome } from './ui/Welcome';
import { isTouchDevice } from './ui/touch';
import { Plan2D } from './plan2d/Plan2D';
import { TopBar } from './ui/TopBar';
import { ToolPalette } from './ui/ToolPalette';
import { SidePanel } from './ui/SidePanel';
import { deleteSelection, rotateSelection, nudgeSelection, duplicateSelection } from './ui/actions';

const View3D = lazy(() => import('./view3d/View3D'));

export function App() {
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const status = useStore((s) => s.status);
  const [err, setErr] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  const touch = isTouchDevice();

  useEffect(() => {
    loadInitialProject()
      .then(({ project: p, fresh }) => {
        useStore.getState().setProject(p);
        startAutosave();
        if (fresh && STATIC) setWelcome(true);
        void requestPersistentStorage();
      })
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        st.undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        st.redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelection();
      } else if (e.key === 'r' || e.key === 'R') {
        rotateSelection(e.shiftKey ? -90 : 90);
      } else if (e.key === 'q') {
        rotateSelection(-15);
      } else if (e.key === 'e' && st.view !== '3d') {
        rotateSelection(15);
      } else if (e.key.startsWith('Arrow') && st.selection && st.view !== '3d') {
        const step = e.shiftKey ? 100 : 10;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] as [number, number];
        if (d) {
          e.preventDefault();
          nudgeSelection(d[0], d[1]);
        }
      } else if (e.key === 'Escape') {
        if (st.tool !== 'select' && st.tool !== 'wall' && st.tool !== 'line' && st.tool !== 'measure') st.setTool('select');
        else if (st.tool === 'select') st.select(null);
      } else if (!mod) {
        const map: Record<string, Parameters<typeof st.setTool>[0]> = { v: 'select', w: 'wall', t: 'door', f: 'window', m: 'measure', l: 'line' };
        if (map[e.key] && st.view !== '3d') st.setTool(map[e.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (err) return <div style={{ padding: 20, color: 'crimson' }}>Fehler beim Laden: {err}</div>;
  if (!project) return <div style={{ padding: 20 }}>Lade Projekt …</div>;

  return (
    <div className="app">
      <TopBar />
      <div className={`main${sideOpen ? '' : ' side-closed'}`}>
        <ToolPalette />
        <div className="viewport">
          {(view === '2d' || view === 'split') && (
            <div className="pane">
              <Plan2D />
            </div>
          )}
          {(view === '3d' || view === 'split') && (
            <div className="pane">
              <Suspense fallback={<div style={{ padding: 20 }}>3D wird geladen …</div>}>
                <View3D />
              </Suspense>
            </div>
          )}
        </div>
        {sideOpen && <SidePanel />}
        <button className="side-toggle" onClick={() => setSideOpen(!sideOpen)} title={sideOpen ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden'}>
          {sideOpen ? '⟩' : '⟨'}
        </button>
      </div>
      <div className="statusbar">
        <span className="grow">{status}</span>
        {touch ? (
          <span>Zwei Finger: zoomen und verschieben · Objekt antippen zum Bearbeiten</span>
        ) : (
          <span>Strg+Z/Y Rückgängig · Entf Löschen · R drehen 90° · Q/E ±15° · Pfeile verschieben · Leertaste+Ziehen schwenken</span>
        )}
      </div>
      {welcome && <Welcome onClose={() => setWelcome(false)} />}
    </div>
  );
}
