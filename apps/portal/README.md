# @masar/portal

Portal für Busfirmen und Plattform-Admins: Next.js 16, Arabisch (Standard) und Englisch. Bisher gibt
es Anmeldung, Passwort vergessen und setzen, Einladung annehmen und eine Übersicht des eigenen
Kontos.

## Starten

```sh
pnpm --filter @masar/api dev       # das Portal leitet /api/* an die API weiter
pnpm --filter @masar/portal dev    # http://localhost:3002
```

Erste Anmeldung: den Link aus `pnpm --filter @masar/api admin:create …` öffnen (`docs/setup.md`).

## Aufbau

| Pfad                        | Zweck                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| `src/proxy.ts`              | Sprachpräfix und Content-Security-Policy mit eigenem Nonce je Anfrage      |
| `src/app/[locale]/auth/`    | Anmeldung, Passwort vergessen, Passwort setzen, Einladung annehmen         |
| `src/app/[locale]/page.tsx` | Übersicht mit Konto und Mitgliedschaften (`GET /api/v1/auth/me`)           |
| `src/lib/api.ts`            | Aufrufe der API mit Problem Details, Netzwerkfehlern und `Retry-After`     |
| `src/lib/use-hash-token.ts` | liest `#token=` aus dem Fragment; das Token erreicht so nie ein Server-Log |
| `src/components/`           | Formularbausteine, Fehlermeldungen, Sprachwechsel, Fehler-Reporter         |

## Hinweise

- Jede Seite wird dynamisch gerendert (`force-dynamic`), weil jede Antwort einen eigenen CSP-Nonce
  braucht. Statisches Rendern nur zusammen mit einer neuen Lösung für die CSP.
- Next.js 16.4 übernimmt den Nonce auch aus dem Response-Header (beobachtet, nicht dokumentiert).
  `src/proxy.ts` setzt ihn trotzdem zusätzlich im Request-Header, wie die Next-Doku es beschreibt.
- Das Portal gehört nicht in Suchmaschinen (`robots: noindex`) und sendet keinen Referer
  (`Referrer-Policy: no-referrer`).
- `typecheck` erzeugt die Routentypen mit `next typegen` und prüft dann mit `tsc`. Lint und Build
  laufen erst danach (`turbo.json`), weil `next build` die Typen neu schreibt.
- Tests: `e2e/tests/portal.spec.ts`.
