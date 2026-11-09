# Auftrag für die Cloud-Sitzung "ultracode-tester"

Stand: 2026-11-04, nach Abschluss von Phase 2 (Schritte 2.1 bis 2.7). Diese Datei ist der Auftrag für eine
eigenständige Claude-Code-Sitzung in der Cloud (Opus 5.5, höchster Aufwand, Mehr-Agenten-Arbeit erlaubt).
Sie prüft das Projekt gründlich, behebt bestätigte Fehler und schreibt einen eigenen Bericht. Sie baut
**keine neuen Funktionen**.

## Voraussetzungen (einmal durch WEGITO)

1. In Claude Code im Web (claude.ai/code) das GitHub-Konto `Wegito` verbinden.
2. Die Claude-GitHub-App für das **private** Repo `Wegito/Masar` freigeben (Repo ausdrücklich auswählen).
3. Beim Start der Sitzung das Repo `Wegito/Masar` und den Branch `william` wählen.
4. Den Text unter "Startnachricht" einfügen.

## Branch und Regeln

- Arbeitsbranch: **`ultracode-tester`**, abgezweigt von `william`. Nur dorthin pushen. Nie auf `main`, nie auf
  `william` oder `william-design`. Zusammenführung macht WEGITO per Pull Request.
- Regeln aus `AGENTS.md` und `CLAUDE.md` gelten unverändert: Commits, Doku und Kommentare auf Deutsch,
  Bezeichner Englisch, Conventional Commits mit Scope, erst stagen und die Liste prüfen, nie `--no-verify`,
  Architekturänderung zuerst als ADR, angewandte Migrationen nie ändern.
- Die Regel "nicht pushen, solange das Repo öffentlich ist" ist erfüllt: Das Repo ist seit 2026-11-04 privat.
- Keine echten Geheimnisse, Telefonnummern oder Ausweisnummern in Dateien, Logs oder Berichten.

## Umgebung in der Cloud (Linux)

Die portablen Windows-Programme und Pfade aus den Notizen gelten dort nicht.

- Node 26 (`.nvmrc`), pnpm 11.3 (`corepack enable`), dann `pnpm install`.
- PostgreSQL 18 mit der Erweiterung `btree_gist` (Docker, falls vorhanden: `docker compose up -d --wait`;
  sonst PostgreSQL 18 aus dem PGDG-Paketarchiv installieren). Rollen und Datenbanken wie in
  `docker/postgres/initdb/01-roles.sh` (`masar_app`, `masar_migrate`; Datenbanken `masar`, `masar_test`,
  `masar_shadow`). Mailpit als Binärdatei (SMTP 1025, Oberfläche 8025). `apps/api/.env.example` nach
  `apps/api/.env` kopieren.
- Playwright-Browser: `pnpm exec playwright install --with-deps chromium`.
- Parallele Teilagenten brauchen getrennte Testdatenbanken (`TEST_DATABASE_URL`, `TEST_MIGRATE_DATABASE_URL`,
  siehe `apps/api/test/global-setup.ts`). Die API begrenzt Logins auf 10 pro Minute: Bei langen Playwright-
  Läufen die API zwischendurch neu starten.

## Aufgaben in dieser Reihenfolge

1. **Grundlinie messen.** Umgebung aufbauen, dann `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
   `pnpm build`, `pnpm test` und **zum ersten Mal seit Schritt 1.6 den vollständigen `pnpm test:e2e`** bei freien
   Ports 3000 bis 3002. `pnpm audit --prod` lesen. Ergebnis ehrlich festhalten, Fehler nicht wegdiskutieren.
   Was fehlschlägt, ist zuerst ein Befund und wird erst nach Analyse behoben.
2. **Tiefenprüfung.** Der erste Prüfbericht (`REPORTS/2026-11-04-phase-1-bis-2-5.md`, Gesamtampel Gelb) war
   bewusst flach: Er hat nicht alle ADRs gelesen und die Oberfläche nicht geprüft. Hole das nach, Schwerpunkte:
   - Sitzinventar und Buchungskern: Sperrreihenfolge Firma → Trip → Booking → Payment, Schreibzugriffe auf
     `seat_occupation`, halb offene Segmente, Geschlechtsregel, Kontingent, Idempotenz, Ablauf-Jobs und Outbox.
   - Mandantentrennung und Rollen auf **jeder** Firmenroute, `@Public()`-Liste in
     `apps/api/test/routes.e2e.test.ts`, Plattform-Admin-Routen unter `/admin`.
   - Datenschutz: keine Telefonnummer, Namen, Ausweisnummer, Tokens oder Buchungscodes in Logs; Tokens nur im
     Fragment; Maskierung im Portal; Verschlüsselung der Ausweisnummer.
   - Datenbank: Migrationen additiv, handgeschriebenes SQL mit Test, Indizes (z. B. fehlt ein Index für die
     Telefon-Suche `LIKE '%…'`), Rollen `masar_app`/`masar_migrate` stehen nicht in den Migrationen.
   - Geld in Minor-Units, Zeiten in UTC, Anzeige in `Asia/Damascus`, Grenzen um Mitternacht.
   - Lizenzprüfung (ADR 0029/0032) beim Planen, Wirkung auf Buchung, Schalter, Storno (darf nichts sperren).
   - Abhängigkeiten: die Treffer von `pnpm audit --prod` einordnen (laut erstem Bericht 9 niedrig/mittel,
     meist Entwicklungswerkzeuge von Prisma).
   - Oberfläche: Arabisch/RTL, logische Klassen, Texte in `ar` und `en`, 360 px, Tastatur und Fokus, CSP ohne
     Inline-Styles. Mit Playwright Screenshots machen und ansehen.
   - Widersprüche zwischen Roadmap, Übergabe, ADRs, Doku und Code.
     Nutze unabhängige Prüfer je Bereich und lass jeden Befund von einem zweiten Prüfer widerlegen lassen
     (Befunde ohne Beleg verwerfen).
3. **Bestätigte Fehler beheben.** Je Fehler ein kleiner Commit mit Test, der ohne den Fix scheitert. Kritische
   Pfade brauchen zusätzlich einen Nebenläufigkeitstest mit zwei echten Datenbankverbindungen. Änderungen am
   Verhalten, die eine Entscheidung brauchen, nicht umsetzen, sondern in den Bericht schreiben.
4. **Bericht.** Eine neue Datei `REPORTS/JJJJ-MM-TT-ultracode-tester.md` (nicht überschreiben, nicht in die
   vorhandene Datei schreiben) nach dem Aufbau des ersten Berichts und seiner Prüfliste im Anhang: Gesamtampel
   je Bereich, Befunde nach Schwere mit Ort (Datei:Zeile), Auswirkung, Empfehlung und Sicherheit der Aussage,
   dazu "verifiziert / nur gelesen / nicht geprüft" mit Befehlen und Zahlen.
5. **Übergabe.** `docs/uebergabe.md` aktualisieren (nur betroffene Zeilen). Alles committen und auf
   `ultracode-tester` pushen.

## Nicht Teil des Auftrags

- Neue Funktionen, Phase 3 (Zahlungen), Werbeplätze (ADR 0031).
- Aussehen und Design: das macht der Raspberry Pi auf `william-design`.
- Anbindung einer inoffiziellen Sham-Cash-Schnittstelle (Drittdienste, die sich per QR und PIN auf ein Konto
  koppeln, sind ein Sicherheits- und Vertragsrisiko).
- Das Repo, die Sichtbarkeit oder die Zugriffsrechte ändern; Upstream-Repos anfassen.

## Bekannte offene Punkte (nicht neu entdecken, aber prüfen, ob sie stimmen)

- `pnpm test:e2e` im Ganzen nie wieder gelaufen (Dev-Server belegten die Ports).
- Der Betriebsentwurf mit Caddy (`docker/caddy/Caddyfile`, `compose.prod.example.yaml`, ADR 0033) ist nicht
  hinter echtem Caddy getestet; es gibt noch keine Dockerfiles für die Apps.
- Die Grenze der Code-Suche liegt im Prozess (ADR 0033): Neustart setzt sie zurück.
- Erstattungen und Zahlungszeilen fehlen bis Phase 3; eine Fahrtabsage storniert ohne Erstattung.
- Fahrer sehen die Fahrgastlisten aller Fahrten ihrer Firma (Zuordnung Fahrer → Fahrt kommt in Phase 4).
- Lizenz: Die Prüfung gilt zum heutigen Tag, nicht zum Fahrtag; Preise und Nachbuchung von Paketen offen.
- Ungeprüft: Papierdruck und QR-Scan, Screenreader, Service Worker außerhalb von Chromium.

## Startnachricht (in die neue Sitzung einfügen)

```text
Du bist die unabhängige Prüfinstanz "ultracode-tester" im Projekt Masar (Repo Wegito/Masar, privat; Buchungs-
plattform für Fernbusse in Syrien; NestJS, Next.js, Prisma, PostgreSQL 18, pnpm-Monorepo). Arbeite mit
Mehr-Agenten-Workflows, höchstem Aufwand und unabhängiger Gegenprüfung jedes Befundes.

Lies zuerst AGENTS.md, CLAUDE.md, docs/ultracode-tester.md (dein Auftrag, Reihenfolge, Umgebung für die
Cloud), docs/uebergabe.md, docs/roadmap.md, REPORTS/README.md und REPORTS/2026-11-04-phase-1-bis-2-5.md.
Alle ADRs in docs/adr/ gehören zu deiner Prüfung.

Arbeite auf dem Branch `ultracode-tester` (von `william` abzweigen) und pushe nur dorthin, nie auf main,
william oder william-design. Sprache: Deutsch für Commits, Doku und Berichte, Bezeichner Englisch. Nutze für
Personen ohne bekannte Pronomen they/them. Baue keine neuen Funktionen und ändere kein Design.

Aufgaben: (1) Umgebung herstellen und die Grundlinie messen, einschließlich des vollständigen pnpm test:e2e,
(2) Tiefenprüfung des gesamten Standes bis Schritt 2.7 mit Gegenprüfung jedes Befundes, (3) bestätigte Fehler
mit Tests beheben, (4) einen neuen Bericht REPORTS/JJJJ-MM-TT-ultracode-tester.md schreiben, (5) docs/uebergabe.md
aktualisieren und alles auf ultracode-tester pushen. Berichte ehrlich, was verifiziert, nur gelesen oder nicht
geprüft ist. Entscheidungen, die die Projektleitung treffen muss, nicht selbst treffen, sondern auflisten.
```
