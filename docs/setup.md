# Setup für die lokale Entwicklung

Stand: Phase 0. Datenbank und Apps folgen ab Schritt 0.5; dieser Abschnitt wächst mit.

## Voraussetzungen

| Werkzeug | Version                 | Hinweis                                                                            |
| -------- | ----------------------- | ---------------------------------------------------------------------------------- |
| Node.js  | 26 (siehe `.nvmrc`)     | mit nvm oder fnm: `nvm use`. Mindestens 24 wird unterstützt                        |
| pnpm     | 11.3 (`packageManager`) | Node 26 bringt Corepack nicht mehr mit. Installation: `npm install -g pnpm@11.3.0` |
| Docker   | aktuell, mit Compose    | ab Schritt 0.6 für PostgreSQL und Mailpit                                          |
| Git      | aktuell                 | Hooks installiert `pnpm install` automatisch                                       |

## Erste Schritte

```sh
git clone <repo-url> masar
cd masar
nvm use
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

## Befehle

| Befehl                          | Wirkung                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `pnpm lint`                     | ESLint in allen Workspaces und für die Dateien im Wurzelordner          |
| `pnpm typecheck`                | TypeScript-Prüfung in allen Workspaces                                  |
| `pnpm test`                     | Tests in allen Workspaces                                               |
| `pnpm build`                    | Build in Abhängigkeitsreihenfolge                                       |
| `pnpm format`                   | Prettier schreibt; `pnpm format:check` prüft nur                        |
| `pnpm --filter <name> <skript>` | ein Skript in einem Workspace, z. B. `pnpm --filter @masar/shared test` |

## Git-Hooks

- Vor jedem Commit formatiert und lintet `lint-staged` die gestagten Dateien.
- Jede Commit-Nachricht prüft `commitlint`: Conventional Commits, Betreff auf Deutsch, z. B.
  `fix(bookings): Hold-Ablauf gibt Sitz frei`.

## Häufige Probleme

| Meldung                                               | Ursache und Lösung                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PNPM_IGNORED_BUILDS`                             | Ein neues Paket hat ein Build-Skript. Prüfen, was es tut, dann in `pnpm-workspace.yaml` unter `allowBuilds` mit `true` oder `false` und Kommentar eintragen |
| Fehler zu `minimumReleaseAge`                         | Die gewünschte Version ist jünger als 24 Stunden. Einen Tag warten oder eine ältere Version wählen; Ausnahmen nur begründet über `minimumReleaseAgeExclude` |
| TypeScript findet `process` oder `node:`-Module nicht | TypeScript 6 lädt `@types` nicht automatisch. In der `tsconfig.json` des Workspaces `"types": ["node"]` setzen                                              |
| Hook läuft nicht                                      | `pnpm install` erneut ausführen; es installiert die Hooks über das `prepare`-Skript                                                                         |

## Demo in fünf Minuten

Folgt mit Schritt 1.6.
