# Raumplaner Haus (2D + 3D)

Lokale Web-App zum Durchplanen des zweigeschossigen Hauses (Erdgeschoss und Obergeschoss mit Dachschrägen): Wände, Türen/Fenster, Treppe, Elektro und Leitungen, Möbel (auch per Shop-Link), Tapeten, Farben, Fliesen und Böden. Alles wird aus **einem** Projekt-JSON im 2D-Grundriss und in 3D dargestellt und laufend geprüft („Passt alles?“).

## Start

Voraussetzung: Node.js ≥ 20.

```bash
npm install
npm start
```

`npm start` startet den lokalen Hilfsserver (Port 5174) und die App (http://localhost:5173) und öffnet den Browser.

Weitere Befehle:

| Befehl | Zweck |
|---|---|
| `npm test` | Tests: Maß-Parser, Flächen/WoFlV, Materialberechnung, Kollisionen, Installationszonen |
| `npm run serve` | Produktions-Build bauen und alles über einen Port (5173) ausliefern |
| `npm run startprojekt` | `projekt.json` neu aus der Skizze erzeugen (`scripts/generate-startprojekt.ts`) |
| `npm run typecheck` | TypeScript prüfen |

**Optional für JS-lastige Shops:** Der Server versucht bei leeren oder blockierten Seiten einen Abruf per Playwright. Dafür einmalig `npx playwright install chromium` ausführen. Ohne Playwright funktioniert alles andere normal.

## Datenschutz

- Kein Konto, kein Tracking, keine Cloud.
- Das Projekt wird automatisch im Browser gespeichert (IndexedDB). Über *Datei → Projekt speichern/öffnen* geht es als JSON-Datei hin und zurück.
- Der lokale Server ruft nur die eine Produktseite ab, die du eingibst, und gibt die zugehörigen Bilder bzw. 3D-Modelle an die App weiter (wegen CORS). Es wird nichts gespeichert oder weitergesendet.
- Alle Bibliotheken liegen lokal, auch der Draco-Decoder für 3D-Modelle. Es werden keine CDNs geladen.

## Bedienung in Kürze

- **Werkzeuge** (Leiste links):

  | Werkzeug | Was es tut |
  |---|---|
  | Auswahl | auswählen und verschieben |
  | Wand | zeichnen mit Fang auf Raster, 45°, Endpunkte und Wandachsen; Alt schaltet den Fang ab. Oben im Plan Typ und Stärke wählen (z. B. „Trockenbau 10“) |
  | Tür, Fenster, Durchgang | in eine Wand setzen; Fenstergröße oben in der Leiste wählen |
  | Dachfenster | in eine Schräge setzen; Größe oben in der Leiste wählen |
  | Treppe | als Rechteck aufziehen |
  | Raum | einen Raum benennen |
  | Möbel, Elektro, Leitung | platzieren bzw. zeichnen |
  | Maß | Maßlinie setzen |
  | Messen | Strecken messen, in 2D und 3D |
  | Kalibrieren | Hintergrund-Maßstab festlegen |

- **Rechts** sind die Tabs:

  | Tab | Inhalt |
  |---|---|
  | Eigenschaften | alle Maße in cm direkt editierbar |
  | Räume | Grund- und Wohnfläche |
  | Möbel | Link-Import, Bibliothek, Möbelliste |
  | Elektro & Leitungen | Symbole, Leitungen, Ebenen |
  | Oberflächen | Wandseiten, Schrägen, Böden, Materialbedarf |
  | Passt alles? | alle Warnungen |
  | Annahmen | offene Annahmen |
  | Export | Ansichten, Bilder, PDF |

- **Tastatur:**

  | Taste | Funktion |
  |---|---|
  | Strg+Z / Strg+Y | Rückgängig / Wiederholen |
  | Entf | Löschen |
  | R / Shift+R | 90° drehen (Türen: Anschlag durchschalten) |
  | Q / E | ±15° drehen |
  | Pfeiltasten | 1 cm verschieben (mit Shift 10 cm) |
  | Strg+D | Duplizieren |
  | Leertaste + Ziehen | Ansicht schwenken |
  | V / W / T / F / L / M | Werkzeuge |

- **3D:**
  - *Orbit*: drehen, verschieben, zoomen.
  - *Begehen*: ins Bild klicken, dann WASD und Maus; die Augenhöhe passt sich unter Schrägen an.
  - Weitere Schalter: *Decke/Schrägen*, *Geschlossen* (Decke auch von außen sichtbar), *Schnitt* (Wände gekürzt), *Alle Ebenen* (EG und OG übereinander mit Geschossdecke), Sonne (Tageslicht durch Fenster und Dachfenster), Lampen.
  - Möbel lassen sich auch in 3D ziehen.
  - *Ansicht speichern* sichert Kamerapositionen für Bilder und das PDF.
- **Geschosse übereinander ausrichten:**
  - Im 2D-Plan liegt das Geschoss darunter grau als Unterlage (Ebenen-Menü → „Geschoss darunter“).
  - Eigenschaften (ohne Auswahl) → *Ebene verschieben / drehen*: ganze Ebene um x/y verschieben oder um 90° drehen.
  - Kontrolle in 3D mit *Alle Ebenen*: Treppenloch im OG und Treppe im EG müssen übereinander liegen.
- **Grundriss als Hintergrund:**
  1. Eigenschaften (ohne Auswahl) → *Bild/PDF laden*.
  2. *Kalibrieren*: zwei Punkte einer bekannten Strecke anklicken.
  3. Die echte Länge in cm eingeben.

## Funktionen nach Meilensteinen

| | Inhalt |
|---|---|
| M1 | Datenmodell in mm, 2D-Editor (SVG) mit Snapping, Wandtypen Bestand/neu/Abriss, Türen mit Öffnungsrichtung, Fenster, Dachfenster, Treppe/Treppenloch, automatische Raumerkennung, Grund- und Wohnfläche nach WoFlV, Undo/Redo, Autosave, Hintergrund mit Kalibrierung, Startprojekt aus der Skizze |
| M2 | 3D (three.js/react-three-fiber): Wände mit Öffnungen und Laibungen, deren Oberkante exakt der Dachschräge folgt; Decken und Schrägen exakt zerlegt; Dachfenster als Aussparung; Treppe mit Geländer; Orbit und Begehen mit Wandkollision |
| M3 | Möbel-Import per Link (JSON-LD → OpenGraph → Datentabellen → Textmuster), Formular für fehlende Maße, Kategorieerkennung, parametrisches 3D-Modell, Farbe aus dem Produktbild, echtes GLB-Modell falls vorhanden (IKEA); Bibliothek inkl. Bad mit Anschlusspunkten; eigene Möbel; Andocken an Wände, Live-Wandabstände; Prüfung gegen Wände, Möbel, Schrägen, Tür- und Schranktür-Schwenkbereiche, Fenster und Dachfenster; Bewegungsflächen (einstellbar) |
| M4 | Elektro-Symbole mit Höhen (Steckdose 30, Schalter 105, über Arbeitsfläche 115 cm), Leitungen (Strom, Wasser kalt/warm, Abwasser, Heizung, LAN) an Wand, Decke oder Boden mit eigener Farbe und Ebene; Installationszonen nach DIN 18015-3 in 2D und 3D, Warnungen außerhalb der Zonen und bei Leitungen über Öffnungen |
| M5 | Jede Wandseite und jede Schräge einzeln belegbar: Farbe, Tapete (Bild, Bahnbreite, Rollenlänge, Rapport, versetzter Ansatz, maßstäblich gekachelt), Fliesen (Bild, Maß, Fuge, Fliesenspiegel-Höhe); Boden je Raum: Bild, Dielen-/Fliesenmaß, Verlegemuster (Drittel-, Halb-, wilder Verband, Schiffsboden, gerade, Fischgrät) und Drehung; Bedarf: Tapetenrollen (Bahnen werden auf Rollen verteilt), Farbe in Litern, Fliesen und Pakete, Bodenpakete mit 10 % Verschnitt, Sockelleisten |
| M6 | Prüf-Panel „Passt alles?“, Messwerkzeug in 2D und 3D, Bilder aus gespeicherten Kamerapositionen, PDF mit maßstäblichem Grundriss (1:50/1:75/1:100) und Maßketten, Elektro- und Leitungsplan mit Legende, Materialliste mit Rechenweg, Möbelliste mit Links und Gesamtpreis, Prüfbericht; Grundriss und Elektroplan auch als PNG |

## Startprojekt & Annahmen

Das Haus hat zwei Geschosse. Grundlage sind die beiden geschickten Fotos:

- `grundriss/eg-unten.png`: Skizze „unten“ (Erdgeschoss)
- `grundriss/dg-oben.png`: Skizze „oben“ (Obergeschoss; der Dateiname stammt noch vom ersten Stand)
- `grundriss/og-markiert.jpg`: dieselbe Skizze gedreht und markiert – Dachschrägen blau (Beginn und Länge), Treppe gelb; in der App Hintergrund des OG

Daraus erzeugt `scripts/generate-startprojekt.ts` die Datei `projekt.json`.

**Kontrolle gegen deine handschriftlichen Rechnungen** (auch als Test abgesichert):

| Raum | Skizze | App |
|---|---|---|
| Büro (OG) | 3,39 × 6,38 = 21,63 m² | 21,63 m² |
| Flur OG | 2,88 + 4,02 = 6,90 m² | 6,90 m² (Treppenloch abgezogen) |
| Schlafzimmer (OG) | 7,85 + 15,10 + 3,34 = 26,29 m² | 26,28 m² |
| Bad OG | – | 6,16 m² (abgeleitet) |
| EG: Küche / Wohnen / Gäste / Vorraum | 21,16 / 24,50 / 17,85 / 2,70 m² | identisch |

Alle Annahmen stehen im Tab **Annahmen** und sind im Editor violett markiert. Die wichtigsten:

1. **Dachschrägen und Deckenhöhen im OG (deine Angaben):**

   | Raum | Schräge beginnt bei | Tiefe der Schräge (waagrecht) | flache Decke | ergibt Neigung |
   |---|---|---|---|---|
   | Schlafzimmer rechts | 1,15 m | 1,87 m | 2,72 m | ca. 40° |
   | Schlafzimmer links (Nische) | 1,03 m | 1,97 m | 2,72 m | ca. 41° |
   | Büro oben | 1,05 m | 1,67 m | 2,79 m | ca. 46° |
   | Flur | keine Schräge | – | 2,48 m | – |
   | Bad | keine Schräge | – | 2,48 m (angenommen wie Flur) | – |

   Erdgeschoss: Decke auf 2,60 m abgehängt. Die 1,87 / 1,97 / 1,67 m sind als waagrechte Tiefe gedeutet – als Länge entlang der Schräge wären sie im Büro (Anstieg 1,74 m) zu kurz. Umstellbar: Wand anklicken → „Angabe über“. Deckenhöhe je Raum: Raum anklicken → „Deckenhöhe (Raum)“.
   Geschosshöhe EG → OG angenommen 3,00 m (2,60 m + Abhängung + Decke), Treppe 16 Steigungen.
   **Fenster und Dachfenster** setzt du selbst: Werkzeug „Fenster“ bzw. „Dachf.“, Größe oben in der Leiste wählen (Standardgrößen oder eigene Maße). Ein Fenster lässt sich in den Eigenschaften in ein Dachfenster umwandeln (und zurück). „Passt alles?“ meldet Fenster, die über den Kniestock ragen, und Dachfenster, die nicht in die Schräge passen.
2. **Orientierung:** Beide Skizzen sind gleich ausgerichtet angenommen und für die Darstellung um 90° gedreht, damit im OG Büro oben, Bad rechts und Schlafzimmer unten liegt.
3. **Lage OG über EG:** linke Außenwand bündig, das Treppenloch des OG liegt über dem Flur EG (OG dafür um 43 cm versetzt). Die Skizzen sind nicht maßstäblich – bitte prüfen und bei Bedarf mit *Ebene verschieben / drehen* korrigieren.
4. **Treppe EG:** in der Skizze nicht eingezeichnet; angenommen im Flur EG direkt unter dem Treppenloch, 15 Steigungen.
5. **Wandstärken:**
   - außen 30 cm
   - innen im OG nach den Laibungsmaßen der Vinyl-Rechnung: Schlaf/Flur 20 cm, Flur/Büro 30 cm
   - Treppe/Bad 24 cm (aus 2,57 m und 2,29 m)
   - Schlaf/Bad 15 cm
6. **Bad OG:** 2,69 × 2,29 m, abgeleitet.
7. **Büro:** ragt 1,28 m über die Flurwand hinaus.
8. **Wände:** Alle Wände bleiben (Bestand, deine Angabe). Neue Trockenbauwände zeichnest du selbst ein.
9. **Beispiele:** Möbel, Elektro und Oberflächen im Startprojekt sind Beispiele, frei löschbar.

Die Skizzen sind nicht maßstäblich. Der Hintergrund ist deshalb nur grob überlagert (mit Verzerrung H/B). Einen maßstäblichen Plan lädst du über *Bild/PDF laden* und richtest ihn mit *Kalibrieren* aus.

## Link-Import: Stand der Tests

| Shop | Ergebnis |
|---|---|
| IKEA | Live getestet: BILLY, EKTORP, BRIMNES. Name, Preis, Bild, Maße und echtes 3D-Modell werden erkannt. Gespeicherte Seiten liegen in `tests/fixtures/`. |
| Otto, Home24, XXXLutz | Haben den Abruf aus der Testumgebung blockiert (HTTP 400/403 bzw. Bot-Schutz, auch per Headless-Browser). Getestet wird mit nachgebildeten HTML-Fixtures in ihrem typischen Aufbau (siehe `tests/fixtures/README.md`). |

Zuhause, mit einer normalen Internetverbindung, klappt der Direktabruf oft. Falls nicht:

1. Produktseite im Browser speichern (Strg+S, „nur HTML“).
2. In der App unter Möbel → *HTML-Datei hochladen* einlesen.

Fehlen Maße, zeigt die App ein Formular mit den gefundenen Teilwerten.

## Technik

- React 18 + TypeScript + Vite; Zustand (State) + Immer (unveränderliche Updates, Undo/Redo über Snapshots).
- 2D: eigenes SVG. 3D: three.js über @react-three/fiber und drei.
- Geometrie:
  - polygon-clipping für Wandumrisse und lichte Raumflächen.
  - Die Decke ist das Minimum aus der flachen Decke und den Schrägen-Ebenen. Die Zerlegung in konvexe Teilflächen ist exakt; daraus entstehen die 3D-Decke, die Wandoberkanten, die Wohnfläche (≥ 2 m / 1–2 m / < 1 m) und die Schrägenprüfung für Möbel.
- Server: Node `http` + cheerio, optional Playwright; Bild/GLB-Proxy.
- PDF: jsPDF. Pläne werden vektoriell über dieselbe Zeichenfunktion erzeugt wie der PNG-Export.

```
src/model      Datenmodell, Standards, Migration, Wand-Operationen
src/geometry   Vektoren, Polygone, Wände, Räume, Decke/Schrägen, Öffnungen
src/checks     Kollisionen, Bewegungsflächen, Installationszonen
src/calc       Raumstatistik, Materialbedarf
src/plan2d     2D-Editor
src/view3d     3D-Ansicht, Geometrieaufbau, Möbelmodelle, Texturen
src/export     Planzeichnung (Canvas/PDF), PDF-Aufbau
src/ui         Oberfläche, Panels
server/        Produktseiten-Abruf, Parser (dims.ts, extract.ts), Proxy
scripts/       Startprojekt-Generator
tests/         Vitest + HTML-Fixtures
```

## Bekannte Grenzen

- Eine Wandseite, die an mehrere Räume grenzt, hat nur eine Oberfläche. Lösung: Wand → *An Anschlüssen teilen*.
- Tapetenbedarf auf Schrägen wird über die Fläche (+15 %) gerechnet, an senkrechten Wänden exakt über die Bahnlängen.
- Fischgrät verwendet automatisch mindestens 15 % Verschnitt.
- Die DIN-18015-3-Prüfung gilt für Strom- und LAN-Leitungen. Wasser, Abwasser und Heizung werden nur auf schrägen Verlauf und Kreuzung von Öffnungen geprüft.
- Treppen werden als gerade Läufe modelliert.
