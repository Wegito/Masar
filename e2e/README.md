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

| Pfad                               | Zweck                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `playwright.config.ts`             | Projekte `web` (Pixel 7) und `portal` (Desktop Chrome); startet die Apps auf 3000 bis 3002  |
| `global-setup.ts`                  | migriert die Testdatenbank mit der Migrationsrolle                                          |
| `support/env.ts`                   | Pfade, Ports und Datenbank-URLs                                                             |
| `tests/web.spec.ts`                | Spracherkennung, RTL, Manifest, Fehler-Reporter mit Obergrenze, Schrift für arabische Teile |
| `tests/passenger-flow.web.spec.ts` | Suche → Ergebnisse → Sitzwahl in ar und en (Demo-Seed), Geschlecht nie in URLs, CSP         |
| `tests/portal.spec.ts`             | Einstieg per Link, Anmeldung, Sprache, Abmeldung, CSP-Nonce, Fehler-Reporter, Schrift       |

## Regeln

- Nie gegen laufende Entwicklungsserver testen (`reuseExistingServer: false`).
- Testdaten erzeugen die Tests selbst, etwa über das echte Admin-Skript. Nichts hängt von der
  Entwicklungsdatenbank ab.
- Ein Worker: Alle Tests teilen sich die Testdatenbank.
