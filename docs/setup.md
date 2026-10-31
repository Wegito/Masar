# Setup für die lokale Entwicklung

Stand: 2026-10-31, Phase 1 bis Schritt 1.3.

## Voraussetzungen

| Werkzeug | Version                 | Hinweis                                                                            |
| -------- | ----------------------- | ---------------------------------------------------------------------------------- |
| Node.js  | 26 (siehe `.nvmrc`)     | mit nvm oder fnm: `nvm use`. Mindestens 24 wird unterstützt                        |
| pnpm     | 11.3 (`packageManager`) | Node 26 bringt Corepack nicht mehr mit. Installation: `npm install -g pnpm@11.3.0` |
| Docker   | aktuell, mit Compose    | für PostgreSQL und Mailpit                                                         |
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

| Befehl                          | Wirkung                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm lint`                     | ESLint in allen Workspaces, im Wurzelordner und in `scripts/`, dazu `pnpm lint:rtl` |
| `pnpm lint:rtl`                 | prüft, dass Web und Portal nur logische Tailwind-Klassen nutzen (`ms-` statt `ml-`) |
| `pnpm typecheck`                | TypeScript-Prüfung in allen Workspaces                                              |
| `pnpm test`                     | Tests in allen Workspaces                                                           |
| `pnpm build`                    | Build in Abhängigkeitsreihenfolge                                                   |
| `pnpm test:e2e`                 | baut API, Web und Portal und führt die Playwright-Tests aus (siehe unten)           |
| `pnpm format`                   | Prettier schreibt; `pnpm format:check` prüft nur                                    |
| `pnpm --filter <name> <skript>` | ein Skript in einem Workspace, z. B. `pnpm --filter @masar/shared test`             |

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

| Befehl                                 | Wirkung                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| `pnpm --filter @masar/api db:migrate`  | Schema geändert: Migration anlegen und lokal anwenden            |
| `pnpm --filter @masar/api db:deploy`   | vorhandene Migrationen anwenden                                  |
| `pnpm --filter @masar/api db:check`    | prüfen, ob Migrationen und Schema zusammenpassen (wie in CI)     |
| `pnpm --filter @masar/api db:generate` | Prisma-Client nach einer Schemaänderung neu erzeugen             |
| `pnpm --filter @masar/api db:seed`     | Demo-Daten anlegen (nach dem Build, siehe unten)                 |
| `docker compose down -v`               | Container und **alle lokalen Daten** löschen; danach neu starten |

Handgeschriebenes SQL (Extensions, Constraints) entsteht mit
`pnpm --filter @masar/api exec prisma migrate dev --create-only --name <name>`, wird in der
erzeugten Datei ergänzt und dann mit `db:migrate` angewendet. Jeder handgeschriebene Constraint
bekommt einen Eintrag in `apps/api/test/inventory-schema.e2e.test.ts` (oder dem Test seines Moduls).
Prisma 7 erzeugt den Client dabei nicht mehr selbst: danach `db:generate`.

### Demo-Daten

```sh
pnpm turbo run build --filter=@masar/api
pnpm --filter @masar/api db:seed            # Fahrten für 7 Tage ab heute
pnpm --filter @masar/api db:seed --days 14  # Zeitfenster verlängern
pnpm --filter @masar/api db:seed --agent-email ich@example.com   # zusätzlich ein Agent-Konto
```

Der Seed legt eine erfundene Firma an („Masar Demo Lines“) mit den Routen Damaskus → Homs → Hama →
Aleppo und zurück, einem 45-Sitzer (2+2 mit Hinterbank) und täglich fünf Fahrten, darunter eine
Nachtfahrt um 23:00, die Homs nach Mitternacht erreicht. Die erste Reihe verkauft nur der Schalter,
Sitz 45 ist gesperrt. Ein erneuter Lauf ändert nichts, ein späterer ergänzt nur fehlende Tage. In
Produktion (`NODE_ENV=production`) verweigert der Seed den Start.

Mit `--agent-email` legt der Seed ein Konto mit der Rolle `AGENT` in der Demo-Firma an und gibt einen
Link aus, der 24 Stunden gilt. Er öffnet im Portal die Seite zum Setzen des Passworts; ein festes
Demo-Passwort gibt es bewusst nicht.

### Buchungsablauf ausprobieren

Solange die Oberfläche fehlt (Schritt 1.5), lässt sich der Ablauf mit `curl` und `jq` gegen die
laufende API prüfen. Voraussetzung: Demo-Daten mit Agent-Konto, Passwort über den Link gesetzt, API
läuft (`pnpm --filter @masar/api dev`).

```sh
API=http://localhost:3001/api/v1
DATE=2026-11-02   # ein Tag mit Demo-Fahrten (heute bis sechs Tage voraus)

# Fahrgast: Fahrt suchen, freien Sitz wählen, Hold anlegen, bar zahlen
TRIP=$(curl -s "$API/trips/search?from=damascus&to=aleppo&date=$DATE" | jq -r '.trips[0].tripId')
SEAT=$(curl -s "$API/trips/$TRIP/seat-map?fromSeq=0&toSeq=3&gender=FEMALE" \
  | jq -r '[.seats[] | select(.state=="FREE")][0].seatId')
BOOKING=$(curl -s -X POST "$API/bookings" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"tripId\":\"$TRIP\",\"fromSeq\":0,\"toSeq\":3,
       \"contact\":{\"name\":\"Lina Test\",\"phone\":\"0933 123 456\"},
       \"passengers\":[{\"seatId\":\"$SEAT\",\"fullName\":\"Lina Test\",\"gender\":\"FEMALE\"}]}")
TOKEN=$(echo "$BOOKING" | jq -r .manageToken); CODE=$(echo "$BOOKING" | jq -r .bookingCode)
curl -s -X POST "$API/my-booking/cash" -H "X-Booking-Token: $TOKEN" | jq '{status, deadlineAt}'

# Personal: anmelden, Buchung über den Code finden, Barzahlung bestätigen
curl -s -c /tmp/masar-cookies -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"ich@example.com","password":"<gesetztes Passwort>"}' -o /dev/null
COMPANY=$(curl -s -b /tmp/masar-cookies "$API/auth/me" | jq -r '.user.memberships[0].companyId')
BID=$(curl -s -b /tmp/masar-cookies "$API/companies/$COMPANY/bookings?code=$CODE" | jq -r .bookingId)
curl -s -b /tmp/masar-cookies -X POST "$API/companies/$COMPANY/bookings/$BID/confirm-cash" \
  | jq '{status, tickets}'

# Fahrgast sieht jetzt die Tickets
curl -s "$API/my-booking" -H "X-Booking-Token: $TOKEN" | jq '{status, tickets}'
```

Jeder Lauf braucht eine andere Telefonnummer, sobald drei Buchungen derselben Nummer offen sind
(`TOO_MANY_OPEN_HOLDS`). Holds laufen nach 15 Minuten ab.

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

Das Skript gibt einen Link aus, der 24 Stunden gilt. Er öffnet im Portal die Seite zum Setzen des
Passworts; dafür müssen API und Portal laufen (nächster Abschnitt). E-Mails der Entwicklung landen
in Mailpit: http://localhost:8025.

Safari setzt das Cookie `__Host-masar_session` auf http://localhost nicht. Für die Entwicklung mit
Safari in `apps/api/.env` `SESSION_COOKIE_SECURE=false` setzen.

## Web und Portal starten

```sh
pnpm --filter @masar/api dev       # die Apps leiten /api/* an die API weiter
pnpm --filter @masar/web dev       # Fahrgast-App: http://localhost:3000
pnpm --filter @masar/portal dev    # Portal: http://localhost:3002
```

Beide Apps leiten `/api/*` an `API_INTERNAL_URL` weiter (Standard `http://localhost:3001`), damit der
Browser alles von einer Origin lädt. Die Sprache steht immer im Pfad (`/ar`, `/en`); ohne Präfix
entscheiden Cookie und Browsersprache. Das Portal setzt eine Content-Security-Policy mit Nonce je
Anfrage; in der Entwicklung erlaubt sie zusätzlich `unsafe-eval`, das React dort für ausführlichere
Fehlermeldungen braucht.

## Ende-zu-Ende-Tests

```sh
docker compose up -d --wait
pnpm --filter @masar/e2e exec playwright install chromium   # einmalig je Playwright-Version
pnpm test:e2e
```

`pnpm test:e2e` baut API, Web und Portal, migriert die Testdatenbank `masar_test` und startet die
gebauten Apps auf den Ports 3000 bis 3002. Laufen dort Entwicklungsserver, bricht der Lauf ab, statt
gegen die falsche Datenbank zu testen. Die Tests liegen in `e2e/tests/`. Bei Fehlern liegen Traces
in `e2e/test-results/`; ansehen mit `pnpm --filter @masar/e2e exec playwright show-trace <datei>`.

## Git-Hooks

- Vor jedem Commit formatiert und lintet `lint-staged` die gestagten Dateien.
- Jede Commit-Nachricht prüft `commitlint`: Conventional Commits, Betreff auf Deutsch, z. B.
  `fix(bookings): Hold-Ablauf gibt Sitz frei`.

## Häufige Probleme

| Meldung                                                                      | Ursache und Lösung                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PNPM_IGNORED_BUILDS`                                                    | Ein neues Paket hat ein Build-Skript. Prüfen, was es tut, dann in `pnpm-workspace.yaml` unter `allowBuilds` mit `true` oder `false` und Kommentar eintragen               |
| Fehler zu `minimumReleaseAge`                                                | Die gewünschte Version ist jünger als 24 Stunden. Einen Tag warten oder eine ältere Version wählen; Ausnahmen nur begründet über `minimumReleaseAgeExclude`               |
| TypeScript findet `process` oder `node:`-Module nicht                        | TypeScript 6 lädt `@types` nicht automatisch. In der `tsconfig.json` des Workspaces `"types": ["node"]` setzen                                                            |
| Hook läuft nicht                                                             | `pnpm install` erneut ausführen; es installiert die Hooks über das `prepare`-Skript                                                                                       |
| `overrides` in `pnpm-workspace.yaml` geändert, aber alte Version installiert | pnpm überspringt die Auflösung, wenn sich nur diese Datei ändert. `pnpm install --config.optimistic-repeat-install=false`                                                 |
| Migration der Testdatenbank fehlgeschlagen                                   | Die API-Tests brauchen die Datenbank: `docker compose up -d --wait`                                                                                                       |
| `Executable doesn't exist` beim E2E-Lauf                                     | Browser für Playwright fehlt: `pnpm --filter @masar/e2e exec playwright install chromium`                                                                                 |
| `http://localhost:3000 is already used`                                      | Ein Entwicklungsserver läuft noch. Beenden; `lsof -ti tcp:3000` zeigt den Prozess                                                                                         |
| `lint:rtl` meldet physische Klassen                                          | `ml-`, `pr-`, `left-`, `text-left` durch `ms-`, `pe-`, `start-`, `text-start` ersetzen                                                                                    |
| `TS6053: File '…/.next/types/…' not found`                                   | `next build` lief parallel zu `tsc` oder ESLint. Über `pnpm` und turbo laufen sie nacheinander; nach einem direkten Aufruf `pnpm --filter <app> typecheck` erneut starten |

## Demo in fünf Minuten

Folgt mit Schritt 1.6.
