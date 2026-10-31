# @masar/api

Backend von Masar: NestJS 12 als ESM, Express, Basis-URL `/api/v1`. Architektur und Regeln:
`docs/architektur.md`, `docs/api-konventionen.md`, `AGENTS.md`.

## Starten

```sh
cp apps/api/.env.example apps/api/.env
pnpm --filter @masar/shared build      # einmalig; turbo erledigt das sonst über dependsOn
pnpm --filter @masar/api dev           # Neustart bei Änderungen, http://localhost:3001
```

| Pfad                | Zweck                                            |
| ------------------- | ------------------------------------------------ |
| `/api/health/live`  | Prozess antwortet                                |
| `/api/health/ready` | Abhängigkeiten erreichbar (Datenbank)            |
| `/api/docs`         | OpenAPI-Oberfläche, nur außerhalb der Produktion |
| `/api/v1/...`       | fachliche Endpunkte                              |

## Datenbank

```sh
docker compose up -d --wait           # im Wurzelordner des Repos
pnpm --filter @masar/api db:deploy
```

- `prisma/schema.prisma`: Modelle; `prisma.config.ts`: CLI mit der Migrationsrolle.
- `src/prisma/prisma.service.ts`: Laufzeit mit der Anwendungsrolle und den Timeouts.
- Der erzeugte Client liegt in `src/generated/prisma` (nicht im Repo); turbo erzeugt ihn vor
  Typecheck, Lint, Tests und Build (`db:generate`).
- Die Tests migrieren die Testdatenbank `masar_test` vor jedem Lauf selbst und laufen dateiweise
  nacheinander, weil sie sich die Datenbank teilen.

## Aufbau

| Datei                                  | Aufgabe                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `src/main.ts`                          | Start                                                                          |
| `src/app.setup.ts`                     | Präfix, Versionierung, Sicherheitsheader, Proxy-Vertrauen, Doku; auch in Tests |
| `src/app.module.ts`                    | Konfiguration, Logger, Ratenbegrenzung, globaler Filter und Validierung        |
| `src/config/env.ts`                    | Umgebungsvariablen mit Zod; ungültig = kein Start                              |
| `src/common/app-error.ts`              | `AppError` mit stabilem Code; Übersetzung von Schema-Verletzungen              |
| `src/common/problem-details.filter.ts` | jeder Fehler wird zu RFC 9457                                                  |
| `src/common/logging.ts`                | pino: nur ID, Methode, Pfad; Schwärzung; Maskierung langer Ziffernfolgen       |
| `src/common/request-id.ts`             | Request-ID übernehmen (nur UUID) oder erzeugen                                 |
| `src/prisma/`                          | Datenbankzugriff (Anwendungsrolle)                                             |
| `src/health/`                          | live und ready, ready prüft die Datenbank                                      |

## Anmeldung

- `src/modules/auth/`: Login, Sitzungen, Passwort-Reset, Guards (`SessionGuard`, `CompanyRoleGuard`).
- `src/modules/companies/`: Einladungen; Annahme legt Konto, Mitgliedschaft und Sitzung an.
- `src/common/csrf.guard.ts`: JSON-Pflicht für Bodies und Origin-Prüfung.
- `src/scripts/create-platform-admin.ts`: erste Plattform-Admin-Person (`admin:create`).
- Jede Route verlangt eine Sitzung, außer sie trägt `@Public()`; `test/routes.e2e.test.ts` hält die
  öffentlichen Routen fest.

## Katalog, Fahrten und Buchung (Phase 1)

| Ort                            | Aufgabe                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `src/modules/fleet/domain/`    | Sitzplan-Generator (2+2, 2+1, Hinterbank als Kette)                                        |
| `src/modules/trips/domain/`    | Fahrtplanung (Schnappschuss) und Sitzplan je Segment                                       |
| `src/modules/trips/`           | Suche und Sitzplan (`/trips/search`, `/trips/:tripId/seat-map`), Städte in `catalog/`      |
| `src/modules/bookings/domain/` | Regeln für Überlappung, Geschlecht, Kontingent, Zustände und Fristen; rein, mit Unit-Tests |
| `src/modules/bookings/`        | Buchungskern: Hold, Barzahlung, Storno, Bestätigung; Sperren und Ablauf als SQL            |
| `src/modules/jobs/`            | Ablauf von Holds (minütlich), Aufräumen alter Sitzungen (stündlich); `JOBS_ENABLED`        |
| `src/scripts/demo-data.ts`     | Demo-Seed (`db:seed`), optional mit Agent-Konto (`--agent-email`)                          |
| `src/common/database-error.ts` | SQLSTATE und Constraint aus Prisma-Fehlern, z. B. `23P01` → `SEAT_TAKEN`                   |

Kritische Pfade folgen ADR 0005: Fahrt sperren, abgelaufene Buchungen freigeben, frisch lesen,
prüfen, schreiben. Jeder neue kritische Pfad braucht einen Nebenläufigkeitstest mit echter
Sperr-Barriere (Beispiel: `test/bookings.e2e.test.ts`).

## Fehler aus dem Browser

`src/modules/client-errors/`: `POST /api/v1/client-errors` nimmt Berichte von Web und Portal an,
bereinigt Pfad, Meldung und Stacktrace und schreibt sie mit Stufe `warn` ins Log. Grenzen: 20 je
Minute und IP, 120 je Minute insgesamt.

## Regeln in Kürze

- Eingaben werden über ein Schema am Parameter geprüft: `@Body({ schema })`, `@Query({ schema })`,
  `@Param('id', { schema })`. Die eingebaute `StandardSchemaValidationPipe` ist global registriert.
  Unbekannte Felder entfernt das Zod-Schema.
- Fachliche Fehler: `throw new AppError('SEAT_TAKEN', { params: { seats } })`. Nie eine Exception
  mit Personendaten in der Meldung.
- Logs nur mit IDs. Der Logger schwärzt bekannte Feldnamen und maskiert Ziffernfolgen ab acht
  Stellen in Fehlermeldungen; beides ist die zweite Linie, nicht die erste.

## Tests

```sh
pnpm --filter @masar/api test
```

Vitest mit Vite 8: Die Decorator-Metadaten (`emitDecoratorMetadata`) übernimmt Vite aus der
`tsconfig.json`, ohne Zusatz-Plugin. Logs sind in Tests stumm (`LOG_LEVEL=silent`); der Log-Test
in `test/logging.e2e.test.ts` leitet die echte Ausgabe in einen Puffer um. Andere Tests bekommen
die echte Ausgabe über `createTestApp({ logs })` (Beispiel: `test/client-errors.e2e.test.ts`), in einer
eigenen Testdatei: nestjs-pino hält seinen Logger statisch, eine zweite App in derselben Datei schreibt
nicht in den Mitschnitt.

- Das Test-Setup (`test/global-setup.ts`) leert vor der Migration alle Tabellen; alte Testdaten können
  eine Migration mit neuem Constraint sonst scheitern lassen.
- `test/helpers/inventory.ts` baut Firma, Route, Sitzplan und Fahrt; `insertBookingRows` und
  `occupySeatDirectly` legen Bestand an der Anwendung vorbei an.
- Wiederkehrende Aufgaben sind in Tests aus (`JOBS_ENABLED=false`); Tests rufen sie direkt auf.
