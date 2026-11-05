import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { useStore } from './store/store';
import { STATIC } from './config';

// für Tests/Debugging in der Browser-Konsole
(window as any).__raumplaner = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Öffentliche Version: Dateien für die Offline-Nutzung im Browser ablegen
if (STATIC && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker nicht registriert', e));
  });
}
