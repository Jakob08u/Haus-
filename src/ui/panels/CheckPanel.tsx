import { useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { checkLevelCached, type Warning, type WarnCategory } from '../../checks/checks';
import { Field, NumInput } from '../inputs';

const CAT_LABEL: Record<WarnCategory, string> = {
  kollision: 'Kollisionen',
  schraege: 'Möbel unter Schrägen',
  bewegung: 'Bewegungsflächen',
  tuer: 'Tür-/Schranktür-Schwenkbereiche',
  fenster: 'Fenster verstellt',
  elektro: 'Elektro außerhalb Installationszonen',
  leitung: 'Leitungen',
  raum: 'Räume',
  annahme: 'Offene Annahmen',
};
const ORDER: WarnCategory[] = ['kollision', 'schraege', 'tuer', 'fenster', 'bewegung', 'elektro', 'leitung', 'raum', 'annahme'];

export default function CheckPanel() {
  const project = useStore((s) => s.project);
  const levelId = useStore((s) => s.levelId);
  const [allLevels, setAllLevels] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const st = useStore.getState;
  const warnings = useMemo(() => {
    const lv = allLevels ? project.levels : project.levels.filter((l) => l.id === levelId);
    const all: Warning[] = [];
    const seenAssume = new Set<string>();
    for (const l of lv)
      for (const w of checkLevelCached(l, project)) {
        if (w.category === 'annahme') {
          if (seenAssume.has(w.message)) continue;
          seenAssume.add(w.message);
        }
        all.push(w);
      }
    return all;
  }, [project, levelId, allLevels]);
  const groups = ORDER.map((c) => ({ c, items: warnings.filter((w) => w.category === c) })).filter((g) => g.items.length);
  const problems = warnings.filter((w) => w.severity === 'error' || w.severity === 'warn').length;
  const c = project.settings.clearance;
  const setC = (k: keyof typeof c, v: number) => st().update((d) => void (d.settings.clearance[k] = v));

  const jump = (w: Warning) => {
    if (w.levelId !== st().levelId) st().setLevel(w.levelId);
    const ref = w.refs[0];
    if (ref) st().select(ref);
    if (w.category === 'annahme') st().setPanel('annahmen');
  };

  return (
    <div>
      <h3>Passt alles?</h3>
      <div className="row">
        {problems === 0 ? <span className="tag ok">Keine Konflikte</span> : <span className="tag err">{problems} Hinweise/Konflikte</span>}
        <label><input type="checkbox" checked={allLevels} onChange={(e) => setAllLevels(e.target.checked)} /> alle Ebenen</label>
        <button onClick={() => setShowSettings(!showSettings)}>Abstände einstellen</button>
      </div>
      {showSettings && (
        <div className="item" style={{ cursor: 'default' }}>
          <div className="hint">Bewegungsflächen (Mindestabstände)</div>
          <Field label="vor Schrank/Kommode"><NumInput value={c.schrank} onChange={(v) => setC('schrank', v)} /></Field>
          <Field label="neben Bett"><NumInput value={c.bettSeite} onChange={(v) => setC('bettSeite', v)} /></Field>
          <Field label="am Bettende"><NumInput value={c.bettFuss} onChange={(v) => setC('bettFuss', v)} /></Field>
          <Field label="vor Schreibtisch"><NumInput value={c.schreibtisch} onChange={(v) => setC('schreibtisch', v)} /></Field>
          <Field label="vor WC"><NumInput value={c.wc} onChange={(v) => setC('wc', v)} /></Field>
          <Field label="vor Waschbecken"><NumInput value={c.waschbecken} onChange={(v) => setC('waschbecken', v)} /></Field>
          <Field label="vor Dusche/Wanne"><NumInput value={c.dusche} onChange={(v) => setC('dusche', v)} /></Field>
          <Field label="sonstige"><NumInput value={c.allgemein} onChange={(v) => setC('allgemein', v)} /></Field>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.c}>
          <h4>
            {CAT_LABEL[g.c]} ({g.items.length})
          </h4>
          {g.items.map((w) => (
            <div key={w.id} className={`warnitem ${w.severity === 'error' ? 'err' : w.severity === 'assume' ? 'assume' : w.severity === 'info' ? 'info' : ''}`} onClick={() => jump(w)}>
              {w.message}
              {allLevels && project.levels.length > 1 && w.category !== 'annahme' && <span className="tag">{project.levels.find((l) => l.id === w.levelId)?.name}</span>}
            </div>
          ))}
        </div>
      ))}
      <p className="hint">
        Geprüft werden: Möbel gegen Wände, Treppenloch, andere Möbel, Dachschrägen (Höhe an jeder Ecke), Tür- und Schranktür-Schwenkbereiche, Fenster und Dachfenster; Bewegungsflächen; Elektro-Symbole und Leitungen gegen die Installationszonen nach DIN 18015-3; Leitungen über Öffnungen; offene Annahmen.
      </p>
    </div>
  );
}
