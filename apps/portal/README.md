# @masar/portal

Portal für Busfirmen und Plattform-Admins: Next.js 16, Arabisch (Standard) und Englisch. Es gibt
Anmeldung, Passwort vergessen und setzen, Einladung annehmen und den angemeldeten Bereich mit
Kopfzeile, Navigation, Firmenwahl, Startseite und Buchungen am Schalter (Suche per Code,
Barbestätigung, Storno; Schritt 2.1 und Oberfläche von 2.5, ADR 0025).

## Starten

```sh
pnpm --filter @masar/api dev       # das Portal leitet /api/* an die API weiter
pnpm --filter @masar/portal dev    # http://localhost:3002
```

Erste Anmeldung: den Link aus `pnpm --filter @masar/api admin:create …` öffnen (`docs/setup.md`).

## Aufbau

| Pfad                                | Zweck                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `src/proxy.ts`                      | Sprachpräfix und Content-Security-Policy mit eigenem Nonce je Anfrage      |
| `src/app/[locale]/auth/`            | Anmeldung, Passwort vergessen, Passwort setzen, Einladung annehmen         |
| `src/app/[locale]/(app)/`           | angemeldeter Bereich: Layout mit Sitzungsprüfung, Startseite, `bookings/`  |
| `src/lib/session.ts`                | `getPortalSession()`: Sitzung und Firma auf dem Server (`GET /auth/me`)    |
| `src/components/portal-context.tsx` | `usePortal()` und `useCompany()` für Client-Seiten im Bereich              |
| `src/lib/nav.ts`                    | Einträge der Navigation; fehlende Ziele mit „bald"                         |
| `src/lib/api.ts`                    | Aufrufe der API mit Problem Details, Netzwerkfehlern und `Retry-After`     |
| `src/lib/use-hash-token.ts`         | liest `#token=` aus dem Fragment; das Token erreicht so nie ein Server-Log |
| `src/components/`                   | Formularbausteine, Fehlermeldungen, Sprachwechsel, Fehler-Reporter         |

## Hinweise

- Jede Seite wird dynamisch gerendert (`force-dynamic`), weil jede Antwort einen eigenen CSP-Nonce
  braucht. Statisches Rendern nur zusammen mit einer neuen Lösung für die CSP.
- Next.js 16.4 übernimmt den Nonce auch aus dem Response-Header (beobachtet, nicht dokumentiert).
  `src/proxy.ts` setzt ihn trotzdem zusätzlich im Request-Header, wie die Next-Doku es beschreibt.
- Das Portal gehört nicht in Suchmaschinen (`robots: noindex`) und sendet keinen Referer
  (`Referrer-Policy: no-referrer`).
- `typecheck` erzeugt die Routentypen mit `next typegen` und prüft dann mit `tsc`. Lint und Build
  laufen erst danach (`turbo.json`), weil `next build` die Typen neu schreibt.
- Neue Bereiche legen ihre Seiten unter `src/app/[locale]/(app)/` ab und erben Rahmen, Schutz und
  Firma. Die Firma kommt aus `useCompany()` und geht nur in den Pfad der API.
- Ohne Sitzungs-Cookie leitet `src/proxy.ts` alle Seiten außer `/{locale}/auth/` zum Login; das
  Layout prüft die Sitzung danach verbindlich über die API.
- Tests: `pnpm --filter @masar/portal test` (Vitest, reine Helfer und Schlüssel in ar und en),
  `e2e/tests/portal.spec.ts` und `e2e/tests/bookings.portal.spec.ts`.
