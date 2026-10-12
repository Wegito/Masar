# @masar/web

Fahrgast-App: Next.js 16 (App Router), mobile-first, installierbar als PWA, Arabisch (Standard) und
Englisch. Regeln für die Oberfläche: `AGENTS.md`; Entscheidungen: ADR 0010.

## Starten

```sh
pnpm --filter @masar/api dev    # die App leitet /api/* an die API weiter
pnpm --filter @masar/web dev    # http://localhost:3000
```

## Aufbau

| Pfad                                       | Zweck                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `src/proxy.ts`                             | Sprachpräfix erzwingen (`/ar`, `/en`); Erkennung über Cookie und Browsersprache  |
| `src/i18n/`                                | Routing, Laden der Texte, Navigation mit Sprache                                 |
| `src/app/[locale]/`                        | Seiten; das Layout setzt `lang`, `dir`, Schriften und den Fehler-Reporter        |
| `src/app/manifest.ts`, `src/app/icons/`    | PWA-Manifest und Symbole (PNG über `ImageResponse`)                              |
| `src/components/client-error-reporter.tsx` | meldet unbehandelte Fehler an `POST /api/v1/client-errors`, höchstens 5 je Seite |
| `messages/ar.json`, `messages/en.json`     | Texte; jeder Schlüssel in beiden Sprachen                                        |
| `next.config.ts`                           | Rewrite `/api/*` an `API_INTERNAL_URL`, Sicherheitsheader                        |

## Hinweise

- Die Seiten sind statisch vorgerendert (`generateStaticParams`), damit sie auf schwachen Netzen
  schnell laden. Eine Content-Security-Policy fehlt deshalb noch (siehe
  `docs/offene-entscheidungen.md`).
- Nur logische Tailwind-Klassen; `pnpm lint:rtl` prüft das.
- `typecheck` erzeugt die Routentypen mit `next typegen` und prüft dann mit `tsc`. Lint und Build
  laufen erst danach (`turbo.json`), weil `next build` die Typen neu schreibt.
- Arabische Textteile auf englischen Seiten tragen `lang="ar"`; `globals.css` gibt ihnen über
  `:lang(ar)` die arabische Schrift (ADR 0010, Nachtrag).
- Tests: `e2e/tests/web.spec.ts` (Spracherkennung, RTL, Manifest, Fehler-Reporter, Schrift).
