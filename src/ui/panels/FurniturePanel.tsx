import { useState } from 'react';
import { useStore, useLevel } from '../../store/store';
import { CATEGORY_INFO } from '../../model/defaults';
import type { Furniture, FurnitureCategory } from '../../model/types';
import { NumInput, Field, TextInput, Select } from '../inputs';
import { dominantColor } from '../background';

interface ProductData {
  name?: string;
  brand?: string;
  price?: number;
  currency?: string;
  image?: string;
  images: string[];
  dims: { width?: number; depth?: number; height?: number; source?: string; lowConfidence?: boolean };
  dimCandidates: { source: string; dims: { width?: number; depth?: number; height?: number } }[];
  category?: string;
  modelUrl?: string;
  url: string;
  sources: string[];
}

interface FetchResult {
  ok: boolean;
  source: string;
  status?: number;
  blocked?: boolean;
  message?: string;
  data?: ProductData;
  error?: string;
}

const LIB: { title: string; items: FurnitureCategory[] }[] = [
  { title: 'Wohnen & Schlafen', items: ['bett', 'schrank', 'kommode', 'regal', 'sofa', 'sessel', 'tisch', 'stuhl', 'tv', 'teppich', 'lampe', 'pflanze', 'spiegel'] },
  { title: 'Arbeiten', items: ['schreibtisch', 'stuhl', 'regal'] },
  { title: 'Bad & Technik (mit Anschlusspunkten)', items: ['wc', 'waschbecken', 'dusche', 'wanne', 'waschmaschine', 'heizkoerper'] },
];

export default function FurniturePanel() {
  const level = useLevel();
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const tpl = useStore((s) => s.toolOpts.furnitureTemplate);
  const st = useStore.getState;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<FetchResult | null>(null);
  const [draft, setDraft] = useState<Partial<Furniture> | null>(null);
  const [custom, setCustom] = useState<{ name: string; category: FurnitureCategory; width: number; depth: number; height: number; color: string }>({
    name: 'Eigenes Möbel',
    category: 'sonstiges',
    width: 800,
    depth: 400,
    height: 800,
    color: '#b8a58c',
  });

  const place = (t: Partial<Furniture>) => {
    st().setToolOpts({ furnitureTemplate: t, furnitureCategory: (t.category as FurnitureCategory) ?? 'sonstiges' });
    st().setTool('furniture');
    if (st().view === '3d') st().setView('split');
    st().setStatus('Möbel: Position im Grundriss anklicken.');
  };

  const applyResult = async (r: FetchResult) => {
    setRes(r);
    const d = r.data;
    if (!d) {
      setDraft(null);
      return;
    }
    const cat = (d.category && d.category in CATEGORY_INFO ? d.category : 'sonstiges') as FurnitureCategory;
    const info = CATEGORY_INFO[cat];
    const dr: Partial<Furniture> = {
      name: d.name ?? 'Möbel',
      category: cat,
      width: d.dims.width,
      depth: d.dims.depth,
      height: d.dims.height,
      price: d.price,
      currency: d.currency,
      url: d.url,
      imageUrl: d.image,
      modelUrl: d.modelUrl,
      color: info.color,
    };
    setDraft(dr);
    if (d.image) {
      const c = await dominantColor(`/api/proxy?url=${encodeURIComponent(d.image)}`);
      if (c) setDraft((x) => (x ? { ...x, color: c } : x));
    }
  };

  const fetchUrl = async (browser = false) => {
    if (!url.trim()) return;
    setBusy(true);
    setRes(null);
    setDraft(null);
    try {
      const r = await fetch(`/api/product?url=${encodeURIComponent(url.trim())}${browser ? '&browser=1' : ''}`);
      const j = (await r.json()) as FetchResult;
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await applyResult(j);
    } catch (e) {
      setRes({ ok: false, source: 'none', message: `Abruf fehlgeschlagen: ${(e as Error).message}. Läuft der lokale Server (npm start)?` });
    } finally {
      setBusy(false);
    }
  };

  const uploadHtml = async (file: File) => {
    setBusy(true);
    try {
      const html = await file.text();
      const r = await fetch('/api/parse-html', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html, url: url || 'https://unbekannt.invalid/' }) });
      const j = await r.json();
      await applyResult({ ok: true, source: 'html', data: j.data });
    } catch (e) {
      setRes({ ok: false, source: 'none', message: 'HTML konnte nicht gelesen werden: ' + (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const missing = draft ? (['width', 'depth', 'height'] as const).filter((k) => !draft[k]) : [];
  const allFurniture = project.levels.flatMap((l) => l.furniture.map((f) => ({ f, l })));
  const total = allFurniture.reduce((s, { f }) => s + (f.price ?? 0), 0);

  return (
    <div>
      <h3>Möbel</h3>
      {tool === 'furniture' && (
        <div className="warnitem info">
          Klick in den Grundriss platziert: <b>{tpl?.name ?? CATEGORY_INFO[useStore.getState().toolOpts.furnitureCategory].label}</b>{' '}
          <button onClick={() => st().setTool('select')}>Abbrechen</button>
        </div>
      )}

      <h4>Aus Link importieren</h4>
      <div className="row">
        <input type="url" placeholder="https://www.ikea.com/de/de/p/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchUrl()} style={{ flex: 1, minWidth: 0 }} />
        <button className="primary" disabled={busy} onClick={() => fetchUrl()}>{busy ? '…' : 'Abrufen'}</button>
      </div>
      <p className="hint">Der lokale Server lädt nur diese eine Seite (privater Gebrauch). Reihenfolge: JSON-LD → OpenGraph → Datentabellen → Textmuster.</p>
      {res && !res.ok && (
        <div className="warnitem err">
          {res.message ?? 'Abruf fehlgeschlagen.'}
          <div className="row">
            <button disabled={busy} onClick={() => fetchUrl(true)}>Mit Browser (Playwright) versuchen</button>
            <label>
              <input type="file" accept=".html,.htm,text/html" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && uploadHtml(e.target.files[0])} />
              <span style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 9px', cursor: 'pointer', background: '#fff' }}>HTML-Datei hochladen …</span>
            </label>
          </div>
        </div>
      )}
      {!res && (
        <div className="row">
          <label>
            <input type="file" accept=".html,.htm,text/html" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && uploadHtml(e.target.files[0])} />
            <span className="hint" style={{ cursor: 'pointer', textDecoration: 'underline' }}>oder gespeicherte HTML-Seite hochladen</span>
          </label>
        </div>
      )}
      {draft && (
        <div className="item" style={{ cursor: 'default' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {draft.imageUrl && <img className="thumb" style={{ width: 72, height: 72 }} src={`/api/proxy?url=${encodeURIComponent(draft.imageUrl)}`} alt="" />}
            <div style={{ flex: 1 }}>
              <b>{draft.name}</b>
              <div className="sub">
                {draft.price != null ? `${draft.price.toFixed(2).replace('.', ',')} ${draft.currency === 'EUR' || !draft.currency ? '€' : draft.currency}` : 'Preis nicht gefunden'}
                {res?.data?.sources?.length ? ` · Quelle: ${res.data.sources.join(', ')}` : ''} {res?.source === 'browser' && '· per Browser'}
              </div>
              {draft.modelUrl && <span className="tag ok">3D-Modell gefunden</span>}
            </div>
          </div>
          {missing.length > 0 && <div className="warnitem" style={{ marginTop: 6 }}>Maße unvollständig – bitte ergänzen ({missing.map((m) => ({ width: 'Breite', depth: 'Tiefe', height: 'Höhe' })[m]).join(', ')}).</div>}
          {res?.data?.dims.lowConfidence && <div className="warnitem" style={{ marginTop: 6 }}>Reihenfolge der Maße war nicht eindeutig (B × T × H angenommen) – bitte prüfen.</div>}
          <Field label="Name"><TextInput value={draft.name ?? ''} onChange={(v) => setDraft({ ...draft, name: v })} /></Field>
          <Field label="Kategorie">
            <Select<FurnitureCategory> value={(draft.category as FurnitureCategory) ?? 'sonstiges'} options={(Object.keys(CATEGORY_INFO) as FurnitureCategory[]).map((k) => ({ value: k, label: CATEGORY_INFO[k].label }))} onChange={(v) => setDraft({ ...draft, category: v })} />
          </Field>
          {(['width', 'depth', 'height'] as const).map((k) => (
            <Field key={k} label={{ width: 'Breite', depth: 'Tiefe', height: 'Höhe' }[k]} tag={!draft[k] ? <span className="tag err">fehlt</span> : null}>
              <NumInput value={draft[k]} onChange={(v) => setDraft({ ...draft, [k]: v })} />
            </Field>
          ))}
          {res?.data?.dimCandidates && res.data.dimCandidates.length > 1 && (
            <details>
              <summary className="hint">Gefundene Teilwerte ({res.data.dimCandidates.length})</summary>
              {res.data.dimCandidates.map((c, i) => (
                <div key={i} className="hint" style={{ cursor: 'pointer' }} onClick={() => setDraft({ ...draft, width: c.dims.width ?? draft.width, depth: c.dims.depth ?? draft.depth, height: c.dims.height ?? draft.height })}>
                  {c.source}: {['width', 'depth', 'height'].map((k) => ((c.dims as any)[k] ? `${(c.dims as any)[k] / 10}` : '?')).join(' × ')} cm ↵
                </div>
              ))}
            </details>
          )}
          <Field label="Farbe"><input type="color" value={draft.color ?? '#cccccc'} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /><span className="hint">aus Produktbild</span></Field>
          <Field label="Preis"><NumInput value={draft.price} factor={1} digits={2} unit="€" onChange={(v) => setDraft({ ...draft, price: v })} /></Field>
          <button className="primary" disabled={missing.length > 0} onClick={() => place(draft)}>Im Grundriss platzieren</button>
        </div>
      )}

      <h4>Bibliothek</h4>
      {LIB.map((g) => (
        <div key={g.title} style={{ marginBottom: 8 }}>
          <div className="hint" style={{ margin: '2px 0' }}>{g.title}</div>
          <div className="lib-grid">
            {g.items.map((c, i) => (
              <button key={c + i} onClick={() => place({ category: c, name: CATEGORY_INFO[c].label })}>
                <span className="swatch" style={{ background: CATEGORY_INFO[c].color }} /> {CATEGORY_INFO[c].label}
                <div className="hint" style={{ margin: 0, fontSize: 10 }}>{CATEGORY_INFO[c].w / 10}×{CATEGORY_INFO[c].d / 10}×{CATEGORY_INFO[c].h / 10}</div>
              </button>
            ))}
          </div>
        </div>
      ))}

      <h4>Eigenes Möbel</h4>
      <Field label="Name"><TextInput value={custom.name} onChange={(v) => setCustom({ ...custom, name: v })} /></Field>
      <Field label="Kategorie">
        <Select<FurnitureCategory> value={custom.category} options={(Object.keys(CATEGORY_INFO) as FurnitureCategory[]).map((k) => ({ value: k, label: CATEGORY_INFO[k].label }))} onChange={(v) => setCustom({ ...custom, category: v })} />
      </Field>
      <Field label="B × T × H">
        <NumInput value={custom.width} width={50} onChange={(v) => setCustom({ ...custom, width: v })} unit="" />×<NumInput value={custom.depth} width={50} onChange={(v) => setCustom({ ...custom, depth: v })} unit="" />×<NumInput value={custom.height} width={50} onChange={(v) => setCustom({ ...custom, height: v })} />
      </Field>
      <Field label="Farbe"><input type="color" value={custom.color} onChange={(e) => setCustom({ ...custom, color: e.target.value })} /></Field>
      <button onClick={() => place({ ...custom })}>Platzieren</button>

      <h4>Möbelliste ({allFurniture.length})</h4>
      <div className="list">
        {allFurniture.map(({ f, l }) => (
          <div
            key={f.id}
            className={`item ${selection?.kind === 'furniture' && selection.id === f.id ? 'sel' : ''}`}
            onClick={() => {
              if (st().levelId !== l.id) st().setLevel(l.id);
              st().select({ kind: 'furniture', id: f.id });
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <span>
                <span className="swatch" style={{ background: f.color }} /> {f.name}
              </span>
              <span>{f.price != null ? `${f.price.toFixed(2).replace('.', ',')} €` : ''}</span>
            </div>
            <div className="sub">
              {l.name} · {f.width / 10} × {f.depth / 10} × {f.height / 10} cm
              {f.url && (
                <>
                  {' · '}
                  <a href={f.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Link ↗</a>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <b>Gesamtpreis</b>
        <b>{total.toFixed(2).replace('.', ',')} €</b>
      </div>
      {level.furniture.length === 0 && <p className="hint">Noch keine Möbel auf dieser Ebene.</p>}
    </div>
  );
}
