# Roadmap

Stand: 2026-11-02. Jeder Schritt ist ein eigener Commit beziehungsweise Pull Request mit eigener
Verifikation. Legende: ✅ erledigt · 🔄 in Arbeit · ⏳ offen.

## Phase 0: Fundament

| Schritt | Inhalt                                                                                                                            | Stand |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 0.1     | Prototyp archivieren (Tag `prototype-2025-08`), Baum leeren, Lizenz proprietär                                                    | ✅    |
| 0.2     | pnpm-Workspace, Turborepo, TypeScript-Basis, ESLint, Prettier, Git-Hooks                                                          | ✅    |
| 0.3     | Doku, ADRs, Glossar, Agenten-Anweisungen, PR-Vorlage, CODEOWNERS, Renovate                                                        | ✅    |
| 0.4     | `@masar/shared`: Fehlercodes, Enums, Telefon, Geld, Zeit, Buchungscode, Tests                                                     | ✅    |
| 0.5     | API-Skelett: Konfiguration, Logging mit Schwärzung, Fehlerformat, Health, Ratenbegrenzung; Datenbank-Readiness folgt mit 0.6      | ✅    |
| 0.6     | Docker Compose, Prisma, Datenbankrollen, CI-Pipeline                                                                              | ✅    |
| 0.7     | Staff-Auth: Sitzungen, Argon2id, Guards, Einladung, Passwort-Reset, Audit-Grundgerüst                                             | ✅    |
| 0.8     | Web und Portal: Next.js, ar/en mit RTL-Prüfung, Schriften, PWA-Manifest, Portal-Login mit CSP, Browser-Fehler, Ende-zu-Ende-Tests | ✅    |

Phase 0 ist seit dem 2026-10-12 lokal abgeschlossen. Vor dem ersten Push muss das Repo privat sein
(siehe [offene Entscheidungen](offene-entscheidungen.md)).

## Phase 1: Ende-zu-Ende lokal

| Schritt | Inhalt                                                                                      | Stand |
| ------- | ------------------------------------------------------------------------------------------- | ----- |
| 1.1     | Migration Katalog, Flotte, Fahrten, Kontingent; EXCLUDE-Constraint; Seed mit fiktiver Firma | ✅    |
| 1.2     | Suche und Sitzplan-Abfrage                                                                  | ✅    |
| 1.3     | Buchungskern: Hold, Barreservierung, Ablauf, Storno, Bestätigung, Tickets, Outbox           | ✅    |
| 1.4     | Ticketseite mit QR, Zugriff über Code und Telefon                                           | ✅    |
| 1.5     | Web-Ablauf Suche bis Ticket in ar und en                                                    | ✅    |
| 1.6     | Demo-Anleitung, Ende-zu-Ende-Test des Demo-Ablaufs, Tag `v0.1.0-demo`                       | ✅    |

Stand 1.1 (2026-11-02): Migration, Tests und Seed laufen gegen PostgreSQL 18.6. `db:check` meldet
keine Abweichung, auch nicht zwischen laufender Datenbank und Schema (die EXCLUDE- und
CHECK-Constraints stören Prisma 7.10 nicht). Alle 162 API-Tests sind grün, `db:seed` ist idempotent.

Stand 1.2 (2026-11-02): `GET /cities`, `GET /trips/search` und `GET /trips/:tripId/seat-map` sind
öffentlich und nur lesend (Format in den [API-Konventionen](api-konventionen.md#suche-und-sitzplan),
Annahmen im [Domänenmodell](domaenenmodell.md#umsetzung-12), Geschlecht im Query: ADR 0019). Alle
242 API-Tests sind gegen PostgreSQL 18 grün, darunter Nachtfahrt über Mitternacht, Tariflücke,
Verkaufsschluss, Wiederbesetzung am Halt, Geschlechtsregel, Kontingent und Kappung. Das Web (1.5)
nutzt die Endpunkte noch nicht.

Stand 1.3 (2026-11-02): Hold, Barreservierung, Barbestätigung mit Tickets und eingefrorener
Provision, Storno durch Fahrgast und Firma, Ablauf per Job und bei jeder Reservierung, Outbox mit
E-Mail-Zustellung ([Domänenmodell](domaenenmodell.md#umsetzung-13),
[API-Konventionen](api-konventionen.md#buchung), ADR 0020 und 0021). Alle 356 API-Tests sind gegen
PostgreSQL 18 grün, darunter sechs Nebenläufigkeitstests mit gesperrter Trip-Zeile und zwei
wartenden Verbindungen (gleicher Sitz, überlappende Teilstrecken, Geschlechtsregel, gleicher
`Idempotency-Key`, Ablauf-Job gegen Reservierung, zwei Jobs gleichzeitig) und ein Test der
Log-Ausgabe ohne Personendaten. Offen für 1.4: Abruf über Code und Telefon, Ausgabe des QR-Tokens.

Stand 1.4 (2026-11-02): `POST /bookings/lookup` mit Code und Telefon (gleiche 404 für falsches
Telefon und unbekannten Code, 5 je Minute und IP, 10 je Stunde und Code), kurzlebiges Lesetoken,
`GET /bookings/:id/ticket` mit QR-Token per HMAC aus Ticket-ID und Version (ADR 0022). Web: „Meine
Buchung" und Ticketseite in ar und en, Token nur im Fragment, QR-Code serverseitig, offline über
Service Worker und gespeicherte Kopie, druckfreundlich ([Fahrgast-Ablauf](web-fahrgastablauf.md),
[Domänenmodell](domaenenmodell.md#umsetzung-14)). 377 API-Tests, 46 Unit-Tests der Web-App und 20
Playwright-Tests (davon 5 neu) sind grün.

Stand 1.5 (2026-11-02): Teil 1 (Suche und Sitzwahl) erledigt: Suchformular, Ergebnisliste und
Sitzplan-Seite in ar und en mit „Ich buche für" vor der Sitzwahl; „Weiter" ist bis zur Buchung
deaktiviert ([Fahrgast-Ablauf](web-fahrgastablauf.md)). 34 Unit-Tests der Web-App und 15
Playwright-Tests (davon 5 neu für den Ablauf) sind grün. Offen: Fahrgastdaten, Buchung, Ticket.

Stand 1.5 Rest (2026-11-02): „Weiter" führt zu den Fahrgastdaten (Name, Geschlecht bei Regel,
Ausweisnummer nur bei Pflicht der Firma, Mobilnummer mit `normalizePhone`, optional E-Mail und
Kontaktname, Sprache der Nachrichten), Hold per Server Action mit `Idempotency-Key` je
Sitzauswahl, Seite „Zahlweg wählen" mit Countdown nach Serveruhr und Barzahlung, danach die
Ticketseite; das Verwaltungstoken steht nur im Fragment (ADR 0023,
[Fahrgast-Ablauf](web-fahrgastablauf.md#buchung-schritt-15)). Sitzfehler führen mit Text und neu
geladenem Sitzplan zurück zur Sitzwahl. Die API meldet im Sitzplan zusätzlich `nationalIdRequired`.
Playwright leert vor dem Lauf den Datencache von Next (veraltete Städteliste), und `pnpm test:e2e`
reicht `TEST_DATABASE_URL` jetzt durch turbo durch. 378 API-Tests, 61 Unit-Tests der Web-App und
24 Playwright-Tests (davon 4 neu, dazu der Demo-Test) sind grün, zweimal hintereinander auf einer
frisch angelegten Testdatenbank.

Stand 1.6 (2026-11-02): [Demo-Anleitung](demo.md) mit Datenbank, Mailpit, Seed samt Demo-Konto,
API, Web und Portal, Ablauf bis zur Barbestätigung durch das Personal (curl und PowerShell, beide
gegen die API geprüft) und Hinweisen für Windows. `e2e/tests/demo.web.spec.ts` spielt denselben
Ablauf durch und prüft danach Status „bestätigt" und QR-Code. Tag `v0.1.0-demo` lokal gesetzt,
nicht gepusht. Nicht geprüft: die Anleitung Schritt für Schritt auf einem frischen Rechner mit
Docker (lokal lief PostgreSQL ohne Docker); die Barbestätigung hat noch keine Oberfläche im Portal
(Phase 2).

## Phase 2: Firmenportal

Ziel: Eine Firma pflegt eine Woche Fahrten selbst und bestätigt Barzahlungen im Portal. Danach
Schaltermodus im selben Inventar. Entscheidungen zur Aufteilung hat der Agent am 2026-11-04
getroffen (Auftrag: alle Entscheidungen für Phase 1 und Datenbank, Phase 2 im selben Zug).

| Schritt | Inhalt                                                                                     | Stand |
| ------- | ------------------------------------------------------------------------------------------ | ----- |
| 2.1     | Portal-Grundgerüst: Rahmen, Navigation, Firmenkontext aus der Sitzung, Startseite          | ✅    |
| 2.2     | Flotte: Busse und Sitzpläne (API und Oberfläche, Generator für 2+2 und 2+1)                | ✅    |
| 2.3     | Strecken, Haltestellen und Tarife je Teilstrecke (API und Oberfläche)                      |       |
| 2.4     | Fahrtplanung: Wochenplan wird zu Fahrten, Kontingent online/Schalter (API, Oberfläche)     |       |
| 2.5     | Buchungen im Portal: Liste, Suche, Barbestätigung, Storno (Oberfläche fertig, Liste fehlt) |       |
| 2.6     | Schaltermodus: Verkauf am Schalter im selben Inventar                                      |       |

Stand 2.1 (2026-11-04): Angemeldeter Bereich unter `apps/portal/src/app/[locale]/(app)/` mit
Kopfzeile (Firma, Person mit Rolle, Sprachwechsel, Abmelden), Seitennavigation (Start, Flotte und
Buchungen verlinkt, Strecken und Fahrten deaktiviert mit „bald", Buchungen für Fahrer „kein
Zugriff") und Startseite mit Begrüßung und vier Platzhalter-Kacheln. Ohne Sitzungs-Cookie leitet
der Proxy zum Login, das Layout prüft die Sitzung auf dem Server über `GET /auth/me`. Bei mehreren
Firmen wählt eine Auswahl in der Kopfzeile die Firma; die Wahl lebt im Cookie
`masar_portal_company` (ADR 0025). Dazu die Oberfläche von 2.5 unter `/{locale}/bookings`: Suche
per Code, „Barzahlung bestätigen", Storno in zwei Schritten mit Grund, Fehler über
`ProblemMessage` in ar und en. Verifiziert: 14 neue Unit-Tests im Portal (Vitest, neu im Portal);
Typecheck, Lint und Build des Portals sowie `pnpm lint:rtl` grün (Stand vor den Flotten-Seiten aus
2.2); der neue Playwright-Test
`e2e/tests/bookings.portal.spec.ts` lief in ar und en grün gegen die laufenden Dev-Server und die
Entwicklungsdatenbank (mit Tag 2 statt 5, ohne Seed). Nicht verifiziert: der Lauf über
`pnpm test:e2e` auf der Testdatenbank (Ports 3000–3002 waren durch Dev-Server belegt), der
Firmenwechsel im Browser (das Seed-Konto hat nur eine Firma) und ein Lauf ohne JavaScript.

Stand 2.2 (2026-11-04): Modul `apps/api/src/modules/fleet` mit Sitzplänen (anlegen aus dem
Generator für 2+2 und 2+1 mit optionaler Hinterbank, Vorschau ohne Speichern, auflisten, lesen,
neu erzeugen solange keine Fahrt den Plan nutzt, neue Version, archivieren) und Bussen (anlegen,
auflisten, lesen, Kennzeichen und Sitzplan ändern, deaktivieren, aktivieren). Lesen alle
Firmenrollen, Schreiben nur `ADMIN` (eine Managerrolle gibt es nicht). Additive Migration
`20261104120000_flotte_busstatus` (`bus.status`), sieben neue Fehlercodes, ADR 0024. Portal-Seite
`/{locale}/fleet` mit Listen, Anlegeformular mit Live-Vorschau des Grundrisses, Sitzplan anzeigen,
archivieren, Bus anlegen, deaktivieren und aktivieren, Texte in ar und en. Verifiziert: alle
API-Tests grün gegen PostgreSQL 18 (48 Dateien, 415 Tests, davon 17 neue Unit-Tests der
Domänenfunktionen und 17 neue Integrationstests mit Rollen, Mandantentrennung in beide Richtungen,
Fremdschlüssel gegen fremde Sitzpläne und drei Nebenläufigkeitstests mit zwei echten Verbindungen);
`db:check` ohne Abweichung; 5 neue Portal-Unit-Tests; `pnpm typecheck`, `pnpm format:check`,
`pnpm lint:rtl`, Lint von API, Portal und e2e sowie der Portal-Build grün. Der neue Playwright-Test
`e2e/tests/fleet.portal.spec.ts` lief in ar und en grün, aber gegen einen eigenen Build von API und
Portal auf den Ports 3101 und 3102 mit der Testdatenbank `masar_test_a`, nicht über
`pnpm test:e2e` (Ports 3000–3002 waren durch Dev-Server belegt). RTL in ar per Screenshot geprüft.
Nicht verifiziert: der Lauf über `pnpm test:e2e`; die Entwicklungsdatenbank `masar` ist noch nicht
migriert (`pnpm --filter @masar/api db:deploy`, sonst scheitern Busabfragen und der Seed in der
Entwicklung). In der Oberfläche fehlen neue Version, Umbenennen und das Ändern eines Busses.

Reihenfolge: 2.1 und 2.2 laufen parallel, danach 2.3, 2.4, 2.5, zuletzt 2.6. Die reine
Wochenplan-Funktion `expandSchedule` (2.4) ist als Auftrag für Allrounder vorbereitet.

## Folgephasen

| Phase | Ziel                     | Meilenstein                                                                                  |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------- |
| 2     | Firmenportal             | Eine Firma pflegt eine Woche Fahrten selbst. Danach Schaltermodus im selben Inventar         |
| 3     | Zahlungen                | Wallet-Überweisung mit Bestätigung, dann ecash mit Webhook, Abgleich und Erstattung          |
| 4     | Betrieb und Zusatzmodule | Fahrer-Check-in offline, Benachrichtigungen, Provisionsbericht, Admin-Oberfläche, Monitoring |
| 5     | Pilot                    | Erste echte Firma, Sicherheitsreview, Restore-Übung, Erreichbarkeitstest aus Syrien          |

Danach: Zahlungen aus dem Ausland (sobald es eine nicht-syrische Rechtsperson gibt), native App über
dieselbe API, Row-Level-Security in PostgreSQL.
