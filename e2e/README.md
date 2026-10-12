# @masar/e2e

Ende-zu-Ende-Tests mit Playwright gegen die gebauten Apps (API, Web, Portal) und die Testdatenbank
`masar_test`. Warum ein eigener Workspace: Nachtrag zu ADR 0002 (Schritt 0.8).

## Ausführen

```sh
docker compose up -d --wait                                  # im Wurzelordner
pnpm --filter @masar/e2e exec playwright install chromium    # einmalig je Playwright-Version
pnpm test:e2e                                                # baut vorher API, Web und Portal
```

Einzelne Tests, wenn die Builds aktuell sind:

```sh
pnpm --filter @masar/e2e exec playwright test --project=portal -g "falsches Passwort"
```

## Aufbau

| Pfad                   | Zweck                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `playwright.config.ts` | Projekte `web` (Pixel 7) und `portal` (Desktop Chrome); startet die Apps auf 3000 bis 3002  |
| `global-setup.ts`      | migriert die Testdatenbank mit der Migrationsrolle                                          |
| `support/env.ts`       | Pfade, Ports und Datenbank-URLs                                                             |
| `tests/web.spec.ts`    | Spracherkennung, RTL, Manifest, Fehler-Reporter mit Obergrenze, Schrift für arabische Teile |
| `tests/portal.spec.ts` | Einstieg per Link, Anmeldung, Sprache, Abmeldung, CSP-Nonce, Fehler-Reporter, Schrift       |

## Regeln

- Nie gegen laufende Entwicklungsserver testen (`reuseExistingServer: false`).
- Testdaten erzeugen die Tests selbst, etwa über das echte Admin-Skript. Nichts hängt von der
  Entwicklungsdatenbank ab.
- Ein Worker: Alle Tests teilen sich die Testdatenbank.
