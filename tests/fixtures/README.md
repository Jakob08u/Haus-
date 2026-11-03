# Test-Fixtures für den Produktseiten-Parser

| Datei | Herkunft |
|---|---|
| `ikea_billy.html`, `ikea_ektorp.html`, `ikea_brimnes.html` | **Echte** IKEA-Produktseiten (ikea.com/de, abgerufen 03.11.2026), gekürzt: Skripte außer JSON-LD/GLB-Links, Styles und SVGs entfernt. |
| `otto_kommode.html`, `home24_sofa.html`, `xxxlutz_bett.html` | **Nachgebildet.** Otto, Home24 und XXXLutz haben automatische Abrufe aus der Testumgebung blockiert (HTTP 400/403, Bot-Schutz). Die Dateien bilden den typischen Aufbau dieser Shops nach: JSON-LD-Produktdaten, Datentabellen bzw. Maßtexte wie „B/H/T“. |

Echte Seiten dieser Shops lassen sich so testen: Seite im Browser öffnen → Strg+S („Webseite, nur HTML“) → in der App unter Möbel → „HTML-Datei hochladen“.
