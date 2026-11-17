# Ylvis Klo-Plan 🐱

Kleine Web-App, mit der man festhält, wann Katze Ylvi auf dem Klo war – mit Beweisfoto zu jedem Eintrag.

## Funktionen
- **Eintrag anlegen**: Pipi / Kacka / Beides, Uhrzeit (vorausgefüllt mit „jetzt“), optionale Notiz
- **Beweisfoto**: direkt mit der Handykamera aufnehmen oder aus der Galerie wählen (wird automatisch verkleinert)
- **Verlauf**: alle Einträge nach Tagen gruppiert, mit Vorschaubild; antippen zum Bearbeiten/Löschen, Foto antippen zum Vergrößern
- **Wochenplan**: pro Tag eine 24-Stunden-Zeitleiste mit allen Klo-Besuchen, Woche vor/zurück blättern
- **Status oben**: wie lange der letzte Besuch (und das letzte Kacka) her ist
- **Backup** (Menü ⋯): Export als JSON-Datei inkl. Fotos, Import auf demselben oder einem anderen Gerät

## Wo liegen die Daten?
Alles bleibt **lokal im Browser des Geräts** (IndexedDB), nichts wird hochgeladen.
Daher ab und zu ein Backup exportieren – wenn man die Browserdaten löscht, sind die Einträge weg.

## Benutzen
Die App ist reines HTML/CSS/JS ohne Build-Schritt. Sie braucht nur einen Webserver (wegen Kamera & Offline-Modus am besten mit HTTPS):

- **GitHub Pages**: Repo → Settings → Pages → Branch wählen → App ist dann unter `https://<user>.github.io/<repo>/ylvi/` erreichbar.
- **Lokal testen**: `cd ylvi && python3 -m http.server 8000` → <http://localhost:8000>

Auf dem Handy dann im Browser „Zum Home-Bildschirm hinzufügen“ – danach startet sie wie eine normale App und funktioniert auch offline.
