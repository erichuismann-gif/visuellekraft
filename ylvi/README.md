# Ylvis Klo-Plan 🐱

Pipi-Protokoll für Katze Ylvi (Blasenprobleme) mit Beweisfotos und Medikationsverlauf.
Mehrere Personen melden sich an und sehen dieselben Einträge. Neue Einträge erscheinen sofort bei allen.

## Funktionen
- **Pipi eintragen**: Uhrzeit (vorausgefüllt mit „jetzt“), optionale Notiz (z. B. Menge, Blut, Pressen) und Beweisfoto per Kamera oder Galerie
- **Verlauf**: alle Pipi-Einträge nach Tagen, mit Vorschaubild; Dosisänderungen erscheinen direkt im Verlauf
- **Wochenplan**: pro Tag eine 24-Stunden-Zeitleiste und die an dem Tag gültige Dosis; Tage mit Dosisänderung sind hervorgehoben
- **Medikation**: Dosisänderungen eintragen (z. B. Fluoxetin 5 mg → 2,5 mg), Verlauf der Medikation und Vergleich „Ø Pipi pro Tag je Dosis“
- **PDF für den Tierarzt** (im Wochenplan): Wochenübersicht über frei wählbar viele Wochen, mit Medikation, Vergleich je Dosis, Zusammenfassung, optional Notizen-Liste und Beweisfotos. Auf dem Handy direkt teilbar.
- **Status oben**: wie lange das letzte Pipi her ist und die aktuelle Dosis
- **Gemeinsam & live** (mit Datenbank): Trägt eine Person etwas ein, sieht die andere es sofort

## Sofort loslegen – ohne Datenbank
Solange in `config.js` nichts eingetragen ist, läuft die App im **lokalen Modus**:
Alles wird nur auf dem jeweiligen Handy gespeichert. Dafür reicht Schritt 6 der Einrichtung (GitHub Pages).
Jedes Handy hat dann seine eigenen Einträge. Ihr seht die Einträge der anderen Person also noch nicht.

Sobald die Datenbank eingerichtet ist (Schritte 1–5), meldet ihr euch an. Die App bietet dann an,
die lokalen Einträge samt Fotos **in die gemeinsame Datenbank zu übernehmen**. Danach sind sie auf dem Handy gelöscht
und liegen nur noch in der Datenbank.

## Aufbau
- Die App selbst (HTML/CSS/JS) liegt auf **GitHub Pages**.
- Einträge und Fotos liegen in einer kostenlosen **Supabase**-Datenbank.
- Nur angemeldete Personen können Einträge und Fotos sehen oder ändern. Die Fotos liegen in einem privaten Speicher.

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Supabase-Projekt anlegen
1. Auf <https://supabase.com> ein kostenloses Konto anlegen und **New project** wählen.
2. Name z. B. `ylvi`, Region **Frankfurt (eu-central-1)**. Das Datenbank-Passwort brauchst du für die App nicht.

### 2. Datenbank einrichten
1. Im Projekt links auf **SQL Editor** gehen und eine neue Abfrage öffnen.
2. Den kompletten Inhalt von [`supabase-setup.sql`](supabase-setup.sql) einfügen und auf **Run** klicken.
   Das legt die Tabelle, den Foto-Speicher und die Zugriffsregeln an.

### 3. Zugänge für euch beide anlegen
1. Links **Authentication → Users → Add user → Create new user** öffnen.
2. E-Mail und Passwort eintragen und **Auto Confirm User** anhaken.
3. Das Ganze einmal für dich und einmal für deine Freundin machen.

### 4. Registrierung abschalten (wichtig!)
Unter **Authentication → Sign In / Providers** (je nach Version auch unter *Settings*)
**„Allow new users to sign up“ ausschalten**. Sonst könnte sich theoretisch jeder, der die Seite findet,
selbst ein Konto anlegen und eure Einträge sehen.

### 5. App mit Supabase verbinden
1. In Supabase unter **Project Settings → API** (bzw. *API Keys*) zwei Werte kopieren:
   - die **Project URL** (`https://….supabase.co`)
   - den **anon**- bzw. **publishable**-Schlüssel
2. Auf GitHub die Datei [`ylvi/config.js`](config.js) öffnen, auf den Stift klicken, beide Werte eintragen und speichern („Commit changes“).

Der Schlüssel darf öffentlich im Repo stehen. Er erlaubt ohne Anmeldung keinen Zugriff auf eure Daten.
Den **service_role**- bzw. **secret**-Schlüssel dagegen niemals eintragen.

### 6. GitHub Pages einschalten
Auf GitHub im Repo **Settings → Pages** öffnen. Bei *Source* „Deploy from a branch“ wählen, dann den Branch (z. B. `main`) und `/ (root)`, und speichern.
Nach 1–2 Minuten ist die App erreichbar unter:

**https://erichuismann-gif.github.io/visuellekraft/ylvi/**

### 7. Aufs Handy
Link öffnen, anmelden, dann im Browser-Menü **„Zum Home-Bildschirm“** wählen
(iPhone: Safari → Teilen-Symbol; Android: Chrome → ⋮). Beim ersten Anmelden fragt die App nach deinem Namen.
Deiner Freundin schickst du einfach den Link und ihre Zugangsdaten. Ihr Passwort kann sie danach über das Menü ⋯ selbst ändern.

## Gut zu wissen
- Zum Eintragen braucht man Internet.
- Kostenlose Supabase-Projekte werden nach etwa einer Woche **ohne jede Nutzung** pausiert. Im Dashboard reaktiviert man sie mit einem Klick.
  Bei täglicher Nutzung passiert das nicht.
- Im kostenlosen Tarif ist 1 GB Foto-Speicher enthalten. Bei ca. 200–400 KB pro Foto reicht das für mehrere tausend Fotos.

## Lokal testen
```
cd ylvi && python3 -m http.server 8000
```
Dann <http://localhost:8000> öffnen.
