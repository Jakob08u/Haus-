import { useStore } from '../../store/store';
import { refFromString } from '../../checks/checks';
import { uid } from '../../geometry/vec';

export function AssumptionsPanel() {
  const project = useStore((s) => s.project);
  const st = useStore.getState;
  const open = project.assumptions.filter((a) => a.status === 'offen');
  const done = project.assumptions.filter((a) => a.status !== 'offen');
  const levelName = (id?: string) => project.levels.find((l) => l.id === id)?.name ?? 'Projekt';
  const jump = (ref?: string, levelId?: string) => {
    const refs = refFromString(ref);
    if (levelId && levelId !== st().levelId) st().setLevel(levelId);
    if (refs[0]) {
      st().select(refs[0]);
      st().setPanel('eigenschaften');
    } else if (ref?.startsWith('level:')) {
      st().select(null);
      st().setPanel('eigenschaften');
    }
  };
  return (
    <div>
      <h3>Annahmen ({open.length} offen)</h3>
      <p className="hint">
        Alles, was nicht eindeutig aus der Skizze hervorging, ist hier gelistet und im Editor mit <span className="tag assume">Annahme</span> markiert. Wert im Editor korrigieren und hier „bestätigt“ setzen.
      </p>
      {open.map((a) => (
        <div key={a.id} className="warnitem assume" onClick={() => jump(a.ref, a.levelId)}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              {a.text}
              <div className="hint" style={{ margin: 0 }}>{levelName(a.levelId)}{a.ref ? ` · ${a.ref}` : ''}</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                st().update((d) => void (d.assumptions.find((x) => x.id === a.id)!.status = 'bestaetigt'));
              }}
            >
              ✓ bestätigt
            </button>
          </div>
        </div>
      ))}
      <button
        style={{ marginTop: 8 }}
        onClick={() => {
          const t = prompt('Neue Annahme / offene Frage:');
          if (t) st().update((d) => void d.assumptions.push({ id: uid('a'), text: t, status: 'offen', levelId: st().levelId }));
        }}
      >
        + Annahme hinzufügen
      </button>
      {done.length > 0 && (
        <>
          <h4>Bestätigt</h4>
          {done.map((a) => (
            <div key={a.id} className="warnitem info">
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, textDecoration: 'line-through', color: 'var(--muted)' }}>{a.text}</div>
                <button onClick={() => st().update((d) => void (d.assumptions.find((x) => x.id === a.id)!.status = 'offen'))}>wieder öffnen</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
