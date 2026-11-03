import { useStore } from '../../store/store';
import { derive } from '../../store/derived';
import { roomStats } from '../../calc/roomStats';
import { fmtCm, fmtM2 } from '../../geometry/vec';

export function RoomsPanel() {
  const project = useStore((s) => s.project);
  const levelId = useStore((s) => s.levelId);
  const sel = useStore((s) => s.selection);
  return (
    <div>
      <h3>Räume & Flächen</h3>
      <p className="hint">Räume werden automatisch aus geschlossenen Wandzügen erkannt. Wohnfläche nach WoFlV: Höhe ≥ 2 m zu 100 %, 1–2 m zu 50 %, unter 1 m 0 %. Treppenlöcher sind abgezogen.</p>
      {project.levels.map((level) => {
        const D = derive(level);
        let sumA = 0, sumL = 0;
        return (
          <div key={level.id} style={{ marginBottom: 14 }}>
            <h4>{level.name}</h4>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Raum</th>
                  <th className="num">Grundfl.</th>
                  <th className="num">Wohnfl.</th>
                  <th className="num">Höhe</th>
                </tr>
              </thead>
              <tbody>
                {D.rooms.map((r) => {
                  const st = roomStats(level, r);
                  sumA += r.netArea;
                  sumL += st.living;
                  const isSel = sel?.kind === 'room' && sel.id === r.meta?.id;
                  return (
                    <tr
                      key={r.key}
                      style={{ cursor: r.meta ? 'pointer' : undefined, background: isSel ? 'var(--accent-soft)' : undefined }}
                      onClick={() => {
                        if (!r.meta) return;
                        const s = useStore.getState();
                        if (s.levelId !== level.id) s.setLevel(level.id);
                        s.select({ kind: 'room', id: r.meta.id });
                        s.setPanel('eigenschaften');
                      }}
                    >
                      <td>{r.name}{!r.meta && <span className="tag err">unbenannt</span>}</td>
                      <td className="num">{fmtM2(r.netArea)} m²</td>
                      <td className="num">{fmtM2(st.living)} m²</td>
                      <td className="num">{st.minHeight === st.maxHeight ? fmtCm(st.maxHeight, 0) : `${fmtCm(st.minHeight, 0)}–${fmtCm(st.maxHeight, 0)}`}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td><b>Summe</b></td>
                  <td className="num"><b>{fmtM2(sumA)} m²</b></td>
                  <td className="num"><b>{fmtM2(sumL)} m²</b></td>
                  <td />
                </tr>
              </tbody>
            </table>
            {level.id === levelId && <p className="hint">Raum benennen: Werkzeug „Raum“ (⌂) und in den Raum klicken.</p>}
          </div>
        );
      })}
    </div>
  );
}
