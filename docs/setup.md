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
docker compose up -d --wait        # die API-Tests brauchen PostgreSQL
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

## Datenbank und Mailpit

```sh
docker compose up -d --wait          # PostgreSQL 18 und Mailpit, nur auf 127.0.0.1
cp apps/api/.env.example apps/api/.env
pnpm --filter @masar/api db:deploy   # Migrationen auf die Entwicklungsdatenbank
```

| Datenbank      | Zweck                                                        |
| -------------- | ------------------------------------------------------------ |
| `masar`        | Entwicklung                                                  |
| `masar_test`   | Tests der API; die Tests migrieren sie vor jedem Lauf selbst |
| `masar_shadow` | Schattendatenbank für Prisma                                 |

Rollen: `masar_migrate` ändert das Schema, `masar_app` liest und schreibt nur Daten. Das Skript
`docker/postgres/initdb/01-roles.sh` legt beides beim ersten Start an. Mailpit fängt E-Mails ab:
http://localhost:8025.

| Befehl                                | Wirkung                                                          |
| ------------------------------------- | ---------------------------------------------------------------- |
| `pnpm --filter @masar/api db:migrate` | Schema geändert: Migration anlegen und lokal anwenden            |
| `pnpm --filter @masar/api db:deploy`  | vorhandene Migrationen anwenden                                  |
| `pnpm --filter @masar/api db:check`   | prüfen, ob Migrationen und Schema zusammenpassen (wie in CI)     |
| `docker compose down -v`              | Container und **alle lokalen Daten** löschen; danach neu starten |

Handgeschriebenes SQL (Extensions, Constraints) entsteht mit
`pnpm --filter @masar/api exec prisma migrate dev --create-only --name <name>`, wird in der
erzeugten Datei ergänzt und dann mit `db:migrate` angewendet.

## API starten

```sh
pnpm --filter @masar/shared build
pnpm --filter @masar/api dev
curl http://localhost:3001/api/health/ready
```

Die OpenAPI-Oberfläche liegt unter `http://localhost:3001/api/docs` (nur außerhalb der Produktion).

## Erste Plattform-Admin-Person

```sh
pnpm turbo run build --filter=@masar/api
pnpm --filter @masar/api admin:create --email ich@example.com --name "Mein Name"
```

Das Skript gibt einen Link aus, der 24 Stunden gilt. Über ihn wird das Passwort gesetzt (bis das
Portal existiert: `POST /api/v1/auth/password-reset/confirm` mit dem Token aus dem Link). E-Mails
der Entwicklung landen in Mailpit: http://localhost:8025.

Safari setzt das Cookie `__Host-masar_session` auf http://localhost nicht. Für die Entwicklung mit
Safari in `apps/api/.env` `SESSION_COOKIE_SECURE=false` setzen.

## Git-Hooks

- Vor jedem Commit formatiert und lintet `lint-staged` die gestagten Dateien.
- Jede Commit-Nachricht prüft `commitlint`: Conventional Commits, Betreff auf Deutsch, z. B.
  `fix(bookings): Hold-Ablauf gibt Sitz frei`.

## Häufige Probleme

| Meldung                                                                      | Ursache und Lösung                                                                                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PNPM_IGNORED_BUILDS`                                                    | Ein neues Paket hat ein Build-Skript. Prüfen, was es tut, dann in `pnpm-workspace.yaml` unter `allowBuilds` mit `true` oder `false` und Kommentar eintragen |
| Fehler zu `minimumReleaseAge`                                                | Die gewünschte Version ist jünger als 24 Stunden. Einen Tag warten oder eine ältere Version wählen; Ausnahmen nur begründet über `minimumReleaseAgeExclude` |
| TypeScript findet `process` oder `node:`-Module nicht                        | TypeScript 6 lädt `@types` nicht automatisch. In der `tsconfig.json` des Workspaces `"types": ["node"]` setzen                                              |
| Hook läuft nicht                                                             | `pnpm install` erneut ausführen; es installiert die Hooks über das `prepare`-Skript                                                                         |
| `overrides` in `pnpm-workspace.yaml` geändert, aber alte Version installiert | pnpm überspringt die Auflösung, wenn sich nur diese Datei ändert. `pnpm install --config.optimistic-repeat-install=false`                                   |
| Migration der Testdatenbank fehlgeschlagen                                   | Die API-Tests brauchen die Datenbank: `docker compose up -d --wait`                                                                                         |

## Demo in fünf Minuten

Folgt mit Schritt 1.6.
