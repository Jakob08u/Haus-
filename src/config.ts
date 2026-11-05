/**
 * Statische Version (GitHub Pages, `npm run build:pages`): kein lokaler Server.
 * Link-Abruf und Bild-Proxy fallen weg; gespeicherte Seiten und eingefügter Text werden im Browser ausgelesen.
 * Das private Startprojekt (projekt.json) wird in diese Version nicht eingebaut.
 */
export const STATIC = import.meta.env.MODE === 'pages';

/** Bild/Modell von einer Shop-URL: lokal über den eigenen Server (CORS), statisch direkt */
export const proxied = (u: string) => (STATIC || u.startsWith('data:') || u.startsWith('blob:') ? u : `/api/proxy?url=${encodeURIComponent(u)}`);

/** Pfad zu Dateien aus public/ (relativ, damit die Seite auch unter /Haus-/ läuft) */
export const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;
