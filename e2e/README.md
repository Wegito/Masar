# @masar/e2e

Ende-zu-Ende-Tests mit Playwright gegen die gebauten Apps (API, Web, Portal) und die Testdatenbank
`masar_test`. Warum ein eigener Workspace: Nachtrag zu ADR 0002 (Schritt 0.8).

## Ausführen

```sh
docker compose up -d --wait                                  # im Wurzelordner
pnpm --filter @masar/e2e exec playwright install chromium    # einmalig je Playwright-Version
pnpm test:e2e                                                # baut vorher API, Web und Portal
```

Eine andere Testdatenbank (etwa wenn parallel API-Tests laufen) über `TEST_DATABASE_URL` und
`TEST_MIGRATE_DATABASE_URL` (`support/env.ts`); die Datenbank muss existieren.

Einzelne Tests, wenn die Builds aktuell sind:

```sh
pnpm --filter @masar/e2e exec playwright test --project=portal -g "falsches Passwort"
```

## Aufbau

| Pfad                               | Zweck                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.config.ts`             | Projekte `web` (Pixel 7) und `portal` (Desktop Chrome); startet die Apps auf 3000 bis 3002; leert vorher den Datencache der Web-App |
| `global-setup.ts`                  | migriert die Testdatenbank mit der Migrationsrolle                                                                                  |
| `support/env.ts`                   | Pfade, Ports und Datenbank-URLs                                                                                                     |
| `support/flow.ts`                  | Seed, Fahrten und freie Sitze über die API, Suche in der Oberfläche, Storno nach dem Test                                           |
| `tests/web.spec.ts`                | Spracherkennung, RTL, Manifest, Fehler-Reporter mit Obergrenze, Schrift für arabische Teile                                         |
| `tests/passenger-flow.web.spec.ts` | Suche → Ergebnisse → Sitzwahl in ar und en (Demo-Seed), Geschlecht nie in URLs, CSP                                                 |
| `tests/booking-flow.web.spec.ts`   | Sitzwahl → Fahrgastdaten → Hold → Barreservierung → Ticket in ar und en, Sitz vergeben                                              |
| `tests/ticket.web.spec.ts`         | „Meine Buchung", Ticketseite mit QR, offline, Druck, Barreservierung                                                                |
| `tests/demo.web.spec.ts`           | Demo-Ablauf aus docs/demo.md mit Barbestätigung durch das Personal                                                                  |
| `tests/portal.spec.ts`             | Einstieg per Link, Anmeldung, Sprache, Abmeldung, CSP-Nonce, Fehler-Reporter, Schrift                                               |

## Regeln

- Nie gegen laufende Entwicklungsserver testen (`reuseExistingServer: false`).
- Testdaten erzeugen die Tests selbst, etwa über das echte Admin-Skript. Nichts hängt von der
  Entwicklungsdatenbank ab.
- Ein Worker: Alle Tests teilen sich die Testdatenbank.
