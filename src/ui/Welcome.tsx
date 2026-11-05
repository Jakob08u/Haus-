import { useRef } from 'react';
import { useStore } from '../store/store';
import { importProjectFile } from '../store/persist';
import { isTouchDevice } from './touch';

/** Erster Start der öffentlichen Version: eigenes Projekt öffnen oder leer beginnen */
export function Welcome({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone);
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h2>🏠 Raumplaner Haus</h2>
        <p>
          Alles läuft hier im Browser. Deine Planung wird <b>nur auf diesem Gerät</b> gespeichert und nirgends hochgeladen.
        </p>
        <div className="row" style={{ gap: 8, margin: '14px 0' }}>
          <button className="primary" onClick={() => fileRef.current?.click()}>Projekt öffnen (JSON-Datei) …</button>
          <button onClick={onClose}>Leer beginnen</button>
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
              useStore.getState().setProject(await importProjectFile(f), true);
              useStore.getState().setStatus(`Projekt „${f.name}“ geladen`);
              onClose();
            } catch (err) {
              alert('Fehler beim Öffnen: ' + err);
            }
          }}
        />
        <ul className="hint">
          <li>Die Projektdatei (z. B. <i>projekt.json</i>) z. B. in der Dateien-App oder in iCloud Drive ablegen und hier öffnen.</li>
          {isTouchDevice() && !standalone && <li>Tipp: In Safari <b>Teilen → Zum Home-Bildschirm</b>. Dann startet der Planer wie eine App, auch ohne Internet, und Safari löscht die Daten nicht nach einigen Wochen.</li>}
          <li>Zwischendurch sichern: <b>Datei → Projekt speichern (JSON)</b>.</li>
        </ul>
      </div>
    </div>
  );
}
