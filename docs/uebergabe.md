# Übergabe: Stand 2026-11-04 und Prompt zum Weiterarbeiten

Diese Datei fasst den Stand nach Phase 1 und den Schritten 2.1 bis 2.5 zusammen. Sie ist für die
Weiterarbeit auf einem anderen Rechner gedacht (Raspberry Pi mit Allrounder als Plattform). Maßgeblich
bleiben `AGENTS.md`, `CLAUDE.md`, `docs/roadmap.md` und die ADRs.

## Stand

- Branch `william` (Stand von WEGITO, Regeln in `CLAUDE.md`). Das Repo `Wegito/Masar` ist **privat**
  (seit 2026-11-04), deshalb darf auf `william` gepusht werden. Nie auf `main`, nie auf den Upstream von
  agy-foreman.
- Phase 1 (1.1 bis 1.6) ist fertig, Tag `v0.1.0-demo`. Phase 2: 2.1 Portal-Rahmen, 2.2 Flotte,
  2.3 Strecken und Tarife, 2.4 Fahrtplanung und 2.5 Buchungen im Portal sind fertig. Offen sind
  **2.6 Schaltermodus** und **2.7 Lizenzstand** (ADR 0029, Status Vorschlag).
- Zuletzt gemessen (Windows, PostgreSQL 18.6): Typecheck grün, 526 API-Tests grün, Portal 40 und Shared
  80 Unit-Tests, Playwright-Dateien für Portal (bookings, fleet, routes, trips, bookings-list) in ar und
  en grün über einen eigenen Stack. Die Zahlen stammen aus den Agentenberichten und eigenen Läufen.
- `pnpm test:e2e` im Ganzen lief seit Schritt 1.6 nicht mehr, weil die Dev-Server die Ports 3000 bis 3002
  belegten. **Erste Aufgabe auf dem neuen Rechner: `pnpm test:e2e` bei freien Ports laufen lassen.**

## Entscheidungen von WEGITO (Gespräch 2026-11-04)

- Zahlungen bleiben in Syrien. Wallet: **Sham Cash**. Es gibt keine offizielle Händler-Schnittstelle
  (Recherche vom 2026-11-04, Drittdienste wie TSA API koppeln sich per QR und PIN auf das Konto, das
  ist ein Sicherheits- und Vertragsrisiko). Plan: Jede Vertragsfirma hinterlegt ihre Sham-Cash-Empfangsadresse,
  der Fahrgast überweist direkt und trägt den Buchungscode als Verwendungszweck ein, das Personal
  bestätigt im Portal (ADR 0008, Wallet-Weg). **ADR 0008 ist dazu noch nicht ergänzt**, WEGITO hat dem
  Vorschlag noch nicht ausdrücklich zugestimmt.
- Keine Provision in der Gründungsphase, stattdessen Lizenz: 6 Monate kostenlos, danach Jahreslizenz
  (ADR 0029). "2 Jahre" ist ungeklärt (Mindestlaufzeit oder Preisbindung). Preis und Zuschnitt (pauschal
  oder je Bus) offen.
- Die Präsentationsseite für Firmen kommt ab Phase 3. Hauptaugenmerk der Demo: das Portal, nicht die
  Fahrgast-App. WEGITO meldet sich bald bei Busfirmen.
- Schwerpunkt für den Pilot: Fahrten planen, Sitze online und am Schalter verkaufen, Barzahlung
  bestätigen. Fahrer-Check-in offline, Benachrichtigungen und Admin-Oberfläche erst bei Bedarf.

## Offene Punkte und Stolpersteine

- Schaltermodus (2.6) und Lizenz (2.7) fehlen. Lizenz: Felder je Firma, Prüfung beim Veröffentlichen
  eines Wochenplans (neuer Fehlercode), Hinweis im Portal, Pflege durch den Plattform-Admin.
- Das Antwortformat der Endpunkte `lookup`, `confirm-cash`, `cancel` im Firmenbereich hat sich in 2.5
  geändert (maskiertes Telefon, `nationalIdPresent`). Nur das Portal verbraucht sie.
- Kein Index für die Telefon-Suche (`LIKE '%…'`); Laufzeit bei vielen Buchungen nicht gemessen.
- Erstattungen und Zahlungszeilen fehlen bis Phase 3. Eine Absage storniert Buchungen ohne Erstattung.
- `TRUST_PROXY` und Caddy sind offen: Alle Aufrufe der Web-App teilen sich bei den Ratenbegrenzungen die
  IP des Web-Servers. Die Begrenzung pro Buchungscode liegt nur im Prozess.
- `pnpm lint` im Wurzelverzeichnis scheitert unter Windows an der Quotierung von `'*.js'` in `lint:root`.
- Demo-Seed hat 3 % Provision als Platzhalter (ADR 0017 ruht, Satz sollte 0 sein).
- Ungeprüft: Demo-Anleitung auf einem frischen Rechner mit Docker, echter QR-Scanner, Screenreader,
  Ladezeit im schwachen Netz, `NOT_FOR_YOU` und `TOO_MANY_OPEN_HOLDS` im Browser, Service Worker nur
  in Chromium.
- `apps/portal/AGENTS.md` und `apps/web/AGENTS.md` entstehen durch `next build` (Hinweise von Next.js) und
  sind unversioniert. Entscheiden: committen oder ignorieren.
- Die Historie des ersten Commits enthält `node_modules` und einen Next.js-Build-Schlüssel
  (`docs/offene-entscheidungen.md`). Das Repo ist privat; ob der Schlüssel rotiert wird, ist offen.

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

## Prompt für die nächste Sitzung

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
3. Schritt 2.7 Lizenzstand je Firma nach ADR 0029; vorher mit WEGITO die offenen Punkte klären
   (Bedeutung "2 Jahre", Preis, Zuschnitt).
4. Mit WEGITO klären, ob ADR 0008 um den Sham-Cash-Weg (Empfangsadresse je Firma, Verwendungszweck,
   Bestätigung durch Personal) ergänzt wird, dann Phase 3 planen. Keine inoffizielle Sham-Cash-Schnittstelle
   anbinden.

Regeln: Conventional Commits auf Deutsch mit Scope, erst stagen und prüfen, nie --no-verify, nur auf
`william` pushen (nie `main`), Architekturänderung zuerst als ADR, Berichte von Subagenten selbst
nachprüfen. Allrounder nur für Aufgaben mit Contract-Tests nutzen (Freigabekarte rechtzeitig bestätigen
lassen). Größere unabhängige Schritte an Opus-Subagenten geben. Am Ende jedes Haltepunkts: alles
committen, auf `william` pushen und eine Übergabe in docs/uebergabe.md aktualisieren.
```
