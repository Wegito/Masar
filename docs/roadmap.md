# Roadmap

Stand: 2026-10-12. Jeder Schritt ist ein eigener Commit beziehungsweise Pull Request mit eigener
Verifikation. Legende: ✅ erledigt · 🔄 in Arbeit · ⏳ offen.

## Phase 0: Fundament

| Schritt | Inhalt                                                                                    | Stand |
| ------- | ----------------------------------------------------------------------------------------- | ----- |
| 0.1     | Prototyp archivieren (Tag `prototype-2025-08`), Baum leeren, Lizenz proprietär            | ✅    |
| 0.2     | pnpm-Workspace, Turborepo, TypeScript-Basis, ESLint, Prettier, Git-Hooks                  | ✅    |
| 0.3     | Doku, ADRs, Glossar, Agenten-Anweisungen, PR-Vorlage, CODEOWNERS, Renovate                | ✅    |
| 0.4     | `@masar/shared`: Fehlercodes, Enums, Telefon, Geld, Zeit, Buchungscode, Tests             | ✅    |
| 0.5     | API-Skelett: Konfiguration, Logging mit Schwärzung, Fehlerformat, Health, Ratenbegrenzung | ⏳    |
| 0.6     | Docker Compose, Prisma, Datenbankrollen, CI-Pipeline                                      | ⏳    |
| 0.7     | Staff-Auth: Sitzungen, Argon2id, Guards, Einladung, Passwort-Reset, Audit-Grundgerüst     | ⏳    |
| 0.8     | Web und Portal: Next.js, ar/en mit RTL, Schriften, PWA-Manifest, Portal-Login             | ⏳    |

## Phase 1: Ende-zu-Ende lokal

| Schritt | Inhalt                                                                                      | Stand |
| ------- | ------------------------------------------------------------------------------------------- | ----- |
| 1.1     | Migration Katalog, Flotte, Fahrten, Kontingent; EXCLUDE-Constraint; Seed mit fiktiver Firma | ⏳    |
| 1.2     | Suche und Sitzplan-Abfrage                                                                  | ⏳    |
| 1.3     | Buchungskern: Hold, Barreservierung, Ablauf, Storno, Bestätigung, Tickets, Outbox           | ⏳    |
| 1.4     | Ticketseite mit QR, Zugriff über Code und Telefon                                           | ⏳    |
| 1.5     | Web-Ablauf Suche bis Ticket in ar und en                                                    | ⏳    |
| 1.6     | Demo-Anleitung, nächtliche Ende-zu-Ende-Tests, Tag `v0.1.0-demo`                            | ⏳    |

## Folgephasen

| Phase | Ziel                     | Meilenstein                                                                                  |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------- |
| 2     | Firmenportal             | Eine Firma pflegt eine Woche Fahrten selbst. Danach Schaltermodus im selben Inventar         |
| 3     | Zahlungen                | Wallet-Überweisung mit Bestätigung, dann ecash mit Webhook, Abgleich und Erstattung          |
| 4     | Betrieb und Zusatzmodule | Fahrer-Check-in offline, Benachrichtigungen, Provisionsbericht, Admin-Oberfläche, Monitoring |
| 5     | Pilot                    | Erste echte Firma, Sicherheitsreview, Restore-Übung, Erreichbarkeitstest aus Syrien          |

Danach: Zahlungen aus dem Ausland (sobald es eine nicht-syrische Rechtsperson gibt), native App über
dieselbe API, Row-Level-Security in PostgreSQL.
