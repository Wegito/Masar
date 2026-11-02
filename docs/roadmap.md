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
| 1.4     | Ticketseite mit QR, Zugriff über Code und Telefon                                           | ⏳    |
| 1.5     | Web-Ablauf Suche bis Ticket in ar und en                                                    | ⏳    |
| 1.6     | Demo-Anleitung, Ende-zu-Ende-Test des Demo-Ablaufs, Tag `v0.1.0-demo`                       | ⏳    |

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

Stand 1.5 (2026-11-02): Teil 1 (Suche und Sitzwahl) erledigt: Suchformular, Ergebnisliste und
Sitzplan-Seite in ar und en mit „Ich buche für" vor der Sitzwahl; „Weiter" ist bis zur Buchung
deaktiviert ([Fahrgast-Ablauf](web-fahrgastablauf.md)). 34 Unit-Tests der Web-App und 15
Playwright-Tests (davon 5 neu für den Ablauf) sind grün. Offen: Fahrgastdaten, Buchung, Ticket.

## Folgephasen

| Phase | Ziel                     | Meilenstein                                                                                  |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------- |
| 2     | Firmenportal             | Eine Firma pflegt eine Woche Fahrten selbst. Danach Schaltermodus im selben Inventar         |
| 3     | Zahlungen                | Wallet-Überweisung mit Bestätigung, dann ecash mit Webhook, Abgleich und Erstattung          |
| 4     | Betrieb und Zusatzmodule | Fahrer-Check-in offline, Benachrichtigungen, Provisionsbericht, Admin-Oberfläche, Monitoring |
| 5     | Pilot                    | Erste echte Firma, Sicherheitsreview, Restore-Übung, Erreichbarkeitstest aus Syrien          |

Danach: Zahlungen aus dem Ausland (sobald es eine nicht-syrische Rechtsperson gibt), native App über
dieselbe API, Row-Level-Security in PostgreSQL.
