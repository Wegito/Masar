# Übergabe: Stand 2026-11-04 und Prompt zum Weiterarbeiten

Diese Datei fasst den Stand nach Phase 1 und den Schritten 2.1 bis 2.5 zusammen. Sie ist für die
Weiterarbeit auf zwei Rechnern gedacht: Der **Haupt-PC (Windows)** führt Funktion und Backend weiter
(2.6, 2.7, Phase 3). Der **Raspberry Pi** mit Allrounder als Plattform ist die **UI/UX-Designerin**:
Er verbessert Aussehen und Bedienung von Fahrgast-App und Portal, ohne das Verhalten zu ändern. Maßgeblich
bleiben `AGENTS.md`, `CLAUDE.md`, `docs/roadmap.md` und die ADRs.

## Stand

- Branch `william` (Stand von WEGITO, Regeln in `CLAUDE.md`). Das Repo `Wegito/Masar` ist **privat**
  (seit 2026-11-04), deshalb darf auf `william` gepusht werden. Nie auf `main`, nie auf den Upstream von
  agy-foreman.
- Phase 1 (1.1 bis 1.6) ist fertig, Tag `v0.1.0-demo`. Phase 2: 2.1 Portal-Rahmen, 2.2 Flotte,
  2.3 Strecken und Tarife, 2.4 Fahrtplanung, 2.5 Buchungen im Portal, 2.6 Schaltermodus
  (ADR 0030) und 2.7 Lizenzstand (ADR 0029 angenommen, Umsetzung ADR 0032; Preise offen) sind fertig.
  Phase 2 ist damit abgeschlossen.
- Zuletzt gemessen (Windows, PostgreSQL 18.6, Stand 2.7): Typecheck grün, 601 API-Tests grün, Portal 63
  und Shared 87 Unit-Tests, alle Playwright-Dateien des Portals (portal, bookings, fleet, routes, trips,
  bookings-list, counter, license) in ar und en grün über einen eigenen Stack. Die Zahlen stammen aus den Agentenberichten und eigenen Läufen.
- Prüfsitzung in der Cloud (2026-11-04, Branch `ultracode-tester`, Bericht
  `REPORTS/2026-11-04-ultracode-tester.md`): `pnpm test:e2e` lief erstmals seit Schritt 1.6 im Ganzen, in der
  Grundlinie 36 von 38 (Anmeldegrenze), auf `ultracode-tester` **38 von 38 grün**, auch auf einer nicht geseedeten
  Datenbank. Endstand dort: API 619, Portal 73, Web 63, Shared 87 Tests grün, `pnpm audit --prod` nur noch
  minimatch (über ESLint).

## Entscheidungen von WEGITO (Gespräch 2026-11-04)

- Zahlungen bleiben in Syrien. Wallet: **Sham Cash**. Es gibt keine offizielle Händler-Schnittstelle
  (Recherche vom 2026-11-04, Drittdienste wie TSA API koppeln sich per QR und PIN auf das Konto, das
  ist ein Sicherheits- und Vertragsrisiko). Plan: Jede Vertragsfirma hinterlegt ihre Sham-Cash-Empfangsadresse,
  der Fahrgast überweist direkt und trägt den Buchungscode als Verwendungszweck ein, das Personal
  bestätigt im Portal (ADR 0008, Wallet-Weg). **ADR 0008 ist dazu noch nicht ergänzt**, WEGITO hat dem
  Vorschlag noch nicht ausdrücklich zugestimmt.
- Keine Provision in der Gründungsphase, stattdessen Lizenz (ADR 0029, angenommen): die ersten 6 Monate
  kostenlos, danach wählt die Firma **1 Jahr oder 2 Jahre**; der Preis richtet sich nach **Paketen zu
  5 Bussen**. Nach Ablauf gilt eine **Kulanzfrist von 14 Tagen**. Preise sind noch offen.
- Später soll die Fahrgast-App Platz für **eigene lokale Werbung** haben, die WEGITO selbst hochlädt, ohne
  Werbenetzwerk wie Google (ADR 0031, Vorschlag). Das Design (Raspberry Pi) soll dafür feste Plätze im
  Layout einplanen, ohne sie zu füllen.
- Die Präsentationsseite für Firmen kommt ab Phase 3. Hauptaugenmerk der Demo: das Portal, nicht die
  Fahrgast-App. WEGITO meldet sich bald bei Busfirmen.
- Schwerpunkt für den Pilot: Fahrten planen, Sitze online und am Schalter verkaufen, Barzahlung
  bestätigen. Fahrer-Check-in offline, Benachrichtigungen und Admin-Oberfläche erst bei Bedarf.

## Offene Punkte und Stolpersteine

- Schaltermodus (2.6) offen: Kassenabrechnung je Person, Bon-Drucker und Scan des gedruckten
  QR-Codes ungeprüft. Lizenz (2.7) offen: Preise, Nachbuchung von Paketen, Prüfung gegen den Fahrtag
  statt heute, Admin-Bereich nur für Lizenzen (Firmen anlegen und sperren fehlt). Neue Migration
  `20261104180000_lizenzstand`: auf jeder Datenbank `pnpm --filter @masar/api db:deploy`.
- Das Antwortformat der Endpunkte `lookup`, `confirm-cash`, `cancel` im Firmenbereich hat sich in 2.5
  geändert (maskiertes Telefon, `nationalIdPresent`). Nur das Portal verbraucht sie.
- Kein Index für die Telefon-Suche (`LIKE '%…'`); Laufzeit bei vielen Buchungen nicht gemessen.
- Aus der Prüfsitzung offen: SMTP ohne TLS-Zwang in Produktion (AB-01), CI läuft nicht auf `william` (DT-01),
  Absage einer Fahrt nach der Abfahrt möglich (Planung A1-01), dazu 17 Entscheidungen für die Projektleitung.
  Liste und alle offenen Befunde: `REPORTS/2026-11-04-ultracode-tester.md`.
- Erstattungen und Zahlungszeilen fehlen bis Phase 3. Eine Absage storniert Buchungen ohne Erstattung.
- Caddy und `TRUST_PROXY`: Entwurf nach ADR 0033 (`docker/caddy/Caddyfile`,
  `compose.prod.example.yaml`, `TRUST_PROXY=1`, Web und Portal reichen eine geprüfte IP weiter), nicht
  hinter echtem Caddy getestet (Prüfliste im Runbook). Die Code-Suche zählt je Code und Client plus
  100 je Code; die Zähler liegen weiter nur im Prozess (Neustart setzt zurück, eine Instanz).
- `pnpm lint` im Wurzelverzeichnis scheitert unter Windows an der Quotierung von `'*.js'` in `lint:root`.
- Ungeprüft: Demo-Anleitung auf einem frischen Rechner mit Docker, echter QR-Scanner, Screenreader,
  Ladezeit im schwachen Netz, `NOT_FOR_YOU` und `TOO_MANY_OPEN_HOLDS` im Browser, Service Worker nur
  in Chromium.
- `apps/portal/AGENTS.md` und `apps/web/AGENTS.md` entstehen durch `next build` (Hinweise von Next.js) und
  sind unversioniert. Entscheiden: committen oder ignorieren.
- Die Historie des ersten Commits enthält `node_modules` und einen Next.js-Build-Schlüssel
  (`docs/offene-entscheidungen.md`). Das Repo ist privat; ob der Schlüssel rotiert wird, ist offen.

## Prüfsitzung in der Cloud

Eine eigene Claude-Sitzung in der Cloud hat den Stand bis 2.7 geprüft und bestätigte Fehler behoben, auf dem
Branch `ultracode-tester` (Auftrag: `docs/ultracode-tester.md`). Ergebnis: kein kritischer oder hoher Befund,
38 Befunde behoben, 59 offen, 17 Entscheidungen; Bericht `REPORTS/2026-11-04-ultracode-tester.md`. Zusammenführung
nach `william` über einen Pull Request.

## Rolle des Raspberry Pi: UI/UX

**Ziel:** Alles, was bisher gebaut ist, sieht professionell aus und lässt sich mühelos bedienen, vor allem
für die Vorführung vor Busfirmen (Portal zuerst) und auf dem Smartphone (Fahrgast-App).

**Erlaubt:** Layout, Abstände, Typografie, Farben, Komponenten, Zustände (leer, lädt, Fehler), Bewegung,
Texte und Mikrotexte in `ar` und `en` (Schlüssel in beiden Sprachen), Barrierefreiheit, Reihenfolge und
Aufbau von Seiten, Icons und Bilder. Plane im Layout der Fahrgast-App feste, leere Plätze für spätere eigene Werbung ein (ADR 0031), ohne sie zu füllen. Geeignet ist ein gemeinsames Designsystem (Tokens und
Basiskomponenten in `apps/portal` und `apps/web`, in einer Datei `docs/design.md` beschrieben).

**Nicht erlaubt (das macht der Haupt-PC):** API, Datenbank, Migrationen, Fehlercodes, Geschäftslogik,
Sicherheits- und Datenschutzregeln (Tokens nur im Fragment, keine Personendaten in Logs, CSP ohne
Inline-Styles), neue Funktionen. Ändert eine Designidee das Verhalten, wird sie als Vorschlag in
`docs/design.md` notiert und nicht umgesetzt.

**Regeln, die das Design einhalten muss** (siehe `AGENTS.md`, Abschnitt Oberfläche):

- Arabisch ist Standard und RTL; nur logische Tailwind-Klassen (`ms-`, `me-`, `ps-`, `pe-`, `start-`,
  `end-`, `text-start`), `pnpm lint:rtl` muss grün bleiben.
- Westliche Ziffern, 24-Stunden-Zeit, Zone `Asia/Damascus`, Arabisch mit `ar-SY`.
- Fremdsprachige Textteile mit `lang`-Attribut. Keine Inline-Styles (CSP erlaubt nur Nonce-Skripte,
  Spalten und Abstände über feste Klassen).
- Mobil zuerst: Layout bei 360 px Breite prüfen, Tabellen auf dem Smartphone als Karten, Touch-Ziele
  mindestens 44 px. Kontrast mindestens WCAG AA, Tastaturbedienung und sichtbarer Fokus.
- Schwaches Netz: keine schweren Schriften, Bilder oder Skripte nachladen; Systemschrift oder wenige
  Schnitte, Bilder klein.

**Tests:** Playwright-Tests wählen teils Elemente über sichtbaren Text. Ändert das Design einen Text oder
eine Struktur, müssen die Tests im selben Commit angepasst werden. Vor jedem Push müssen `pnpm typecheck`,
`pnpm lint`, `pnpm format:check`, die Portal- und Web-Unit-Tests sowie `pnpm test:e2e` grün sein.

**Branch:** Damit sich Design und Funktion nicht in die Quere kommen, arbeitet der Pi auf dem Branch
**`william-design`** (von WEGITO am 2026-11-04 bestätigt, Regel in `CLAUDE.md`).
Zusammengeführt wird über einen Pull Request nach `william`. Der Haupt-PC rebased `william` regelmäßig
auf den Stand von `william-design` oder umgekehrt, bevor neue Portalseiten (2.6, 2.7) entstehen.

**Reihenfolge der Arbeit (Vorschlag):**

1. Bestandsaufnahme mit Screenshots (Portal und Fahrgast-App, `ar` und `en`, 360 px und Desktop) und eine
   Liste der Schwächen in `docs/design.md`.
2. Designsystem: Tokens (Farbe, Abstand, Schrift, Radius, Schatten), Basiskomponenten (Knopf, Eingabe,
   Karte, Tabelle, Hinweis, Leerzustand, Lade- und Fehlerzustand, Seitenkopf).
3. Portal: Rahmen und Startseite, Fahrten, Strecken, Flotte, Buchungen (Vorführung vor Firmen).
4. Fahrgast-App: Suche, Ergebnis, Sitzwahl, Fahrgastdaten, Bezahlseite, Ticketseite.
5. Barrierefreiheit und Kontrast prüfen, Vorher-Nachher-Bilder für die Präsentation sammeln.

**Hinweis zur Hardware:** `next build` und Playwright brauchen auf einem Raspberry Pi viel Arbeitsspeicher
(acht GB sind sicherer als vier) und Zeit. Dev-Server und einzelne Tests nutzen, den ganzen
`pnpm test:e2e` vor dem Push laufen lassen.

## Umgebung auf dem Raspberry Pi

- Dort geht `docker compose up -d --wait` (PostgreSQL 18.6, Mailpit; beide haben ARM-Images). Die
  portablen Windows-Programme aus der lokalen Notiz entfallen.
- Node 26 (`.nvmrc`), pnpm 11.3 (`corepack`), dann `pnpm install`. Playwright braucht die Browser
  (`pnpm exec playwright install --with-deps chromium`).
- Demo starten: siehe `docs/demo.md`. Seed mit `SEED_STAFF_EMAIL=demo-admin@masar.invalid` und
  `SEED_STAFF_PASSWORD=nur-lokale-demo-2026` (nur lokal).
- Parallele Agenten brauchen getrennte Testdatenbanken: `TEST_DATABASE_URL` und
  `TEST_MIGRATE_DATABASE_URL` (siehe `apps/api/test/global-setup.ts`).
- Allrounder: `.agy-foreman.json` im Repo (Tests über `test:unit` mit JUnit unter `apps/api/junit.xml`,
  Pfade vom Repo-Stamm). Jeder Job braucht Contract-Tests und eine bestätigte Freigabekarte (sie
  verfällt nach kurzer Zeit). Geeignet sind reine Domain-Funktionen mit Unit-Tests. `finalize` lehnt bei
  unsauberem Arbeitsbaum ab: dann Dateien per `git checkout agy/<job> -- <pfad>` holen.

## Arbeitsweise, die sich bewährt hat

- Größere unabhängige Schritte an Opus-Subagenten geben (je ein Modul oder eine Portal-Seite), mit
  getrennten Testdatenbanken und festen Pfaden für Commits (`git commit -- <Pfade>`).
- Jeder Schritt: ADR, Tests inklusive Mandantentrennung und Nebenläufigkeit, Portal in ar und en,
  Playwright-Test, Roadmap mit "Stand" (Verifiziertes und Nicht-Verifiziertes getrennt).
- Berichte der Agenten selbst nachprüfen: Typecheck, `format:check`, API-Tests.

## Prompt für den Haupt-PC (Funktion und Backend)

```text
Du arbeitest im Repo Masar (Wegito/Masar, privat) auf dem Branch `william`. Lies zuerst AGENTS.md,
CLAUDE.md, docs/uebergabe.md, docs/roadmap.md und ADR 0008, 0017, 0029. Die Sprache ist Deutsch
(Commits, Doku, Kommentare), Bezeichner Englisch. Nutze für Personen ohne bekannte Pronomen they/them.

Stand: Phase 1 und Phase 2 Schritte 2.1 bis 2.5 sind fertig und gepusht. Aufgaben in dieser Reihenfolge:
1. Umgebung herstellen (docker compose, pnpm install, Playwright-Browser) und `pnpm typecheck`,
   `pnpm format:check`, API-Tests und bei freien Ports `pnpm test:e2e` laufen lassen. Ergebnis ehrlich
   melden, auch Fehler.
2. Schritt 2.6 Schaltermodus (Verkauf am Schalter im selben Inventar, über den Buchungsservice unter
   der Trip-Sperre, Kontingent Schalter, Portal-Oberfläche in ar und en, Playwright-Test, ADR).
3. Schritt 2.7 ist erledigt (ADR 0032); mit WEGITO die Preise und die Nachbuchung von Paketen
   mitten in der Laufzeit klären.
4. Mit WEGITO klären, ob ADR 0008 um den Sham-Cash-Weg (Empfangsadresse je Firma, Verwendungszweck,
   Bestätigung durch Personal) ergänzt wird, dann Phase 3 planen. Keine inoffizielle Sham-Cash-Schnittstelle
   anbinden.

Regeln: Conventional Commits auf Deutsch mit Scope, erst stagen und prüfen, nie --no-verify, nur auf
`william` pushen (nie `main`), Architekturänderung zuerst als ADR, Berichte von Subagenten selbst
nachprüfen. Allrounder nur für Aufgaben mit Contract-Tests nutzen (Freigabekarte rechtzeitig bestätigen
lassen). Größere unabhängige Schritte an Opus-Subagenten geben. Am Ende jedes Haltepunkts: alles
committen, auf `william` pushen und eine Übergabe in docs/uebergabe.md aktualisieren.
```

## Prompt für den Raspberry Pi (UI/UX)

```text
Du bist die UI/UX-Designerin im Projekt Masar (Wegito/Masar, privat). Arbeite auf dem Branch
`william-design`, der von `william` abzweigt. Lies zuerst AGENTS.md, CLAUDE.md, docs/uebergabe.md
(Abschnitt "Rolle des Raspberry Pi: UI/UX"), docs/web-fahrgastablauf.md und apps/portal/README.md.
Sprache: Deutsch für Commits, Doku und Kommentare, Englisch für Bezeichner, Oberfläche in Arabisch (Standard,
RTL) und Englisch. Nutze für Personen ohne bekannte Pronomen they/them.

Ziel: Fahrgast-App (apps/web) und Portal (apps/portal) sehen professionell aus und sind einfach zu
bedienen, besonders für die Vorführung vor Busfirmen und auf dem Smartphone. Du änderst das Aussehen
und die Bedienung, nicht das Verhalten: keine Änderungen an API, Datenbank, Fehlercodes, Geschäftslogik
oder Sicherheitsregeln.

Vorgehen:
1. Richte die Umgebung ein (docker compose up -d --wait, pnpm install, Seed mit Demo-Konto, API/Web/Portal
   starten, siehe docs/demo.md) und mache Screenshots des Ist-Zustands (ar und en, 360 px und Desktop).
2. Schreibe docs/design.md: Schwächen, Ziele, Designsystem (Tokens und Basiskomponenten).
3. Setze das Designsystem um und wende es auf Portal (Rahmen, Start, Fahrten, Strecken, Flotte,
   Buchungen), dann auf die Fahrgast-App an.
4. Prüfe Barrierefreiheit (Kontrast AA, Tastatur, Fokus, lang-Attribute) und Layout bei 360 px.
5. Committe in kleinen Schritten mit Conventional Commits auf Deutsch (z. B. "style(portal): ..."),
   erst stagen und die Liste prüfen, nie --no-verify. Vor jedem Push: pnpm typecheck, pnpm lint,
   pnpm format:check, Portal- und Web-Unit-Tests und pnpm test:e2e grün. Passe Playwright-Tests im selben
   Commit an, wenn sich Texte oder Struktur ändern. Pushe nur auf `william-design`, nie auf `main`.

Regeln: nur logische Tailwind-Klassen (pnpm lint:rtl), westliche Ziffern, Zeit Asia/Damascus, keine
Inline-Styles (CSP), jeder neue Text mit Schlüssel in ar und en, keine schweren Schriften oder Bilder
(schwaches Netz). Ändert eine Idee das Verhalten, notiere sie als Vorschlag in docs/design.md und setze sie
nicht um. Berichte am Ende ehrlich, was geprüft ist und was nicht (mit Screenshots als Beleg).
```
