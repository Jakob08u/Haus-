import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Project } from '../model/types';
import { useStore } from './store';
import { migrate } from '../model/migrate';
import { emptyProject } from '../model/defaults';
import { STATIC } from '../config';

const KEY = 'raumplaner-projekt-v8';

/** gespeichertes Projekt oder Startprojekt; `fresh` = auf diesem Gerät noch nichts gespeichert */
export async function loadInitialProject(): Promise<{ project: Project; fresh: boolean }> {
  try {
    const saved = await idbGet(KEY);
    if (saved && typeof saved === 'object' && Array.isArray((saved as Project).levels)) return { project: migrate(saved as Project), fresh: false };
  } catch (e) {
    console.warn('IndexedDB nicht verfügbar', e);
  }
  return { project: await loadStartProject(), fresh: true };
}

/** Browser bitten, die Daten nicht automatisch zu löschen (Safari/iPad: v. a. als Home-Bildschirm-App) */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function loadStartProject(): Promise<Project> {
  // Die öffentliche Version (GitHub Pages) enthält den privaten Grundriss nicht.
  if (STATIC) return emptyProject();
  const mod = await import('../../projekt.json');
  return migrate(structuredClone((mod as any).default ?? mod) as Project);
}

let timer: number | undefined;
export function startAutosave() {
  let last: Project | null = null;
  useStore.subscribe((s) => {
    if (s.project === last || !s.project) return;
    last = s.project;
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try {
        await idbSet(KEY, s.project);
        useStore.getState().setStatus('Automatisch gespeichert ' + new Date().toLocaleTimeString('de-DE'));
      } catch (e) {
        useStore.getState().setStatus('Autosave fehlgeschlagen: ' + String(e));
      }
    }, 700);
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportProjectJson(p: Project) {
  const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
  const safe = p.name.replace(/[^\wäöüÄÖÜß -]+/g, '').trim() || 'projekt';
  downloadBlob(blob, `${safe}.json`);
}

export async function importProjectFile(file: File): Promise<Project> {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.levels)) throw new Error('Keine gültige Projektdatei');
  return migrate(data as Project);
}
