import { lazy, Suspense, useMemo } from 'react';
import { useStore, useLevel, type PanelKey } from '../store/store';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { RoomsPanel } from './panels/RoomsPanel';
import { AssumptionsPanel } from './panels/AssumptionsPanel';
import { checkLevelCached } from '../checks/checks';

const FurniturePanel = lazy(() => import('./panels/FurniturePanel'));
const ElectricPanel = lazy(() => import('./panels/ElectricPanel'));
const MaterialsPanel = lazy(() => import('./panels/MaterialsPanel'));
const CheckPanel = lazy(() => import('./panels/CheckPanel'));
const ExportPanel = lazy(() => import('./panels/ExportPanel'));

const TABS: [PanelKey, string][] = [
  ['eigenschaften', 'Eigenschaften'],
  ['raeume', 'Räume'],
  ['moebel', 'Möbel'],
  ['elektro', 'Elektro & Leitungen'],
  ['material', 'Oberflächen'],
  ['pruefen', 'Passt alles?'],
  ['annahmen', 'Annahmen'],
  ['export', 'Export'],
];

export function SidePanel() {
  const panel = useStore((s) => s.panel);
  const project = useStore((s) => s.project);
  const level = useLevel();
  const warnings = useMemo(() => checkLevelCached(level, project), [level, project]);
  const errCount = warnings.filter((w) => w.severity === 'error' || w.severity === 'warn').length;
  const openAssumptions = project.assumptions.filter((a) => a.status === 'offen').length;
  return (
    <div className="side">
      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={panel === k ? 'active' : ''} onClick={() => useStore.getState().setPanel(k)}>
            {label}
            {k === 'pruefen' && errCount > 0 && <span className="badge">{errCount}</span>}
            {k === 'annahmen' && openAssumptions > 0 && <span className="badge assume">{openAssumptions}</span>}
          </button>
        ))}
      </div>
      <div className="panel">
        <Suspense fallback={<div>Lade …</div>}>
          {panel === 'eigenschaften' && <PropertiesPanel />}
          {panel === 'raeume' && <RoomsPanel />}
          {panel === 'moebel' && <FurniturePanel />}
          {panel === 'elektro' && <ElectricPanel />}
          {panel === 'material' && <MaterialsPanel />}
          {panel === 'pruefen' && <CheckPanel />}
          {panel === 'annahmen' && <AssumptionsPanel />}
          {panel === 'export' && <ExportPanel />}
        </Suspense>
      </div>
    </div>
  );
}
