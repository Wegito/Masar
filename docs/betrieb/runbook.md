# Runbook

Stand: Skelett vom 2026-10-12, ergänzt am 2026-10-31 (Jobs, Migrationen). Es gibt noch keine Produktion. Die Abschnitte werden in Phase 4 und 5
ausgearbeitet und vor dem Pilot einmal geübt.

## Deployment (geplant)

1. CI baut Images mit dem Git-SHA als Tag und legt sie in der GitHub Container Registry ab.
2. Auf dem Server: Images ziehen, `prisma migrate deploy` als einmaliger Container, dann
   `docker compose up -d`.
3. Migrationen sind additiv. Das vorherige Image muss mit dem neuen Schema weiterlaufen können.

**Rollback:** vorheriges Image-Tag starten. Nie eine Migration rückwärts ausführen.

**Migration scheitert:** Prisma führt eine Migration nicht atomar aus (beobachtet 2026-10-31, ADR 0004).
Die Anweisungen vor dem Fehler bleiben angewendet, die Migration steht als fehlgeschlagen in
`_prisma_migrations`, und `migrate deploy` verweigert weitere Migrationen (P3009). Vorgehen: Fehler im
Log lesen, den halb angewendeten Stand von Hand prüfen und zurückbauen oder vervollständigen, dann
`prisma migrate resolve --rolled-back <name>` bzw. `--applied <name>`. Vorbeugung: Migrationen, die an
vorhandenen Daten scheitern können (neue Constraints), vorher gegen eine Kopie der Produktionsdaten
probieren.

**Demo-Seed:** nie gegen Produktion. Er verweigert `NODE_ENV=production`.

**Datenbank einrichten (einmalig):** dasselbe Skript wie lokal, `docker/postgres/initdb/01-roles.sh`, mit
Passwörtern aus den Secrets. Die Schattendatenbank wird in Produktion nicht gebraucht. Das offizielle
Image vertraut lokalen Verbindungen innerhalb des Datenbank-Containers ohne Passwort; deshalb läuft
dort nichts anderes, und der Port wird nicht veröffentlicht. Die API verbindet sich über das
Compose-Netz mit Passwort (`scram-sha-256`). Ab PostgreSQL 18 gehört das Volume auf
`/var/lib/postgresql`.

**Erste Plattform-Admin-Person:** `pnpm --filter @masar/api admin:create --email <adresse> --name
<name>` gegen die Produktionsdatenbank. Der ausgegebene Link gilt 24 Stunden und nur einmal; er ist
ein Geheimnis und gehört nicht in Chats oder Tickets. Der Vorgang steht im Audit-Log
(`PLATFORM_ADMIN_GRANTED`).

## Sicherung und Wiederherstellung (geplant)

- `pg_dump` verschlüsselt, im Pilot stündlich, sonst täglich; Aufbewahrung 30 Tage.
- Wöchentlicher automatischer Restore-Test in eine Wegwerf-Datenbank.
- Ziele: höchstens 1 Stunde Datenverlust, Wiederherstellung in 4 Stunden.
- Nach einem Restore: Buchungen der verlorenen Zeitspanne mit Zahlungsanbieter und Firmenlisten
  abgleichen. Ein alter Stand kennt Tickets nicht, die Fahrgäste bereits haben.

## Vorfälle

Jeder Vorfall: erkennen, eindämmen, untersuchen, beheben, nachbereiten. Untersuchung immer über die
Request-ID und das Audit-Log, nie über personenbezogene Daten im Log.

| Vorfall                           | Erste Schritte                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doppelbuchung gemeldet            | Belegungen und Audit der Fahrt prüfen; Herkunft klären (Schalter außerhalb des Kontingents oder Fehler im System)                                                                               |
| Zahlung ohne bestätigte Buchung   | Webhook-Tabelle und Status beim Anbieter vergleichen; Sitz neu belegen oder erstatten                                                                                                           |
| Buchung bestätigt, Zahlung fehlt  | Audit: wer hat bestätigt; Wallet-Abgleichliste prüfen                                                                                                                                           |
| Fahrt gestrichen                  | Fahrt auf `CANCELLED`: storniert alle Buchungen, legt Erstattungen an, benachrichtigt; Ergebnis prüfen                                                                                          |
| Webhooks kommen nicht an          | Abgleich manuell starten; Anbieterstatus prüfen; Schlüsselrotation prüfen                                                                                                                       |
| Zahlungsanbieter nicht erreichbar | Online-Zahlung ausblenden; Bar und Wallet bleiben verfügbar                                                                                                                                     |
| Sitze bleiben blockiert           | Log nach `"job":"booking-expiry"` durchsuchen; der Ablauf-Job läuft minütlich im API-Prozess und ist wiederholbar; jede neue Buchung derselben Fahrt gibt abgelaufene Holds auch selbst frei    |
| Staff-Konto kompromittiert        | Passwort-Reset auslösen (meldet alle Sitzungen ab) oder Sitzungen per SQL widerrufen (`UPDATE session SET revoked_at = now() WHERE user_id = …`); Audit-Log der Person lesen; Firma informieren |
| Massenhafte Holds beobachtet      | betroffene Holds freigeben, Telefonnummern oder Adressbereiche sperren, Captcha-Schwelle senken                                                                                                 |
| Festplatte voll                   | Log-Rotation und alte Sicherungen prüfen; PostgreSQL schreibt sonst nicht mehr                                                                                                                  |

## Wiederkehrende Aufgaben

Seit Schritt 1.3 laufen im API-Prozess (`apps/api/src/modules/jobs`):

| Aufgabe          | Takt     | Wirkung                                                                |
| ---------------- | -------- | ---------------------------------------------------------------------- |
| `booking-expiry` | 1 Minute | Holds und Barreservierungen nach ihrer Frist auf `EXPIRED`, Sitze frei |
| `auth-cleanup`   | 1 Stunde | Sitzungen, Reset-Links und Einladungen 30 Tage nach Ablauf löschen     |

Ein Lauf mit Wirkung schreibt `Aufgabe ausgeführt` mit `job` und `affected` ins Log, ein Fehler
`Aufgabe fehlgeschlagen` mit Stufe `error`. Beide Aufgaben arbeiten unter denselben Sperren wie die
Anfragen und sind bei mehreren Instanzen sicher. `JOBS_ENABLED=false` schaltet sie ab (in Tests aus).

## Fehler im Browser

Web und Portal melden unbehandelte Fehler an die API. Im Log stehen sie mit Stufe `warn`, der
Meldung „Fehler im Browser" und dem Feld `clientError` (`app`, `kind`, `path`, `message`,
`stack`), zum Beispiel:

```sh
docker compose logs api | grep '"clientError"'
```

- Viele gleiche Meldungen kurz nach einem Deployment: Fehler im neuen Release; vorheriges Image
  starten.
- „Globales Limit für Browser-Fehler erreicht": Entweder trifft ein Fehler gerade alle Nutzer, oder
  jemand flutet den Endpunkt. Die Zahl verworfener Berichte steht in der Meldung der Folgeminute.
  Bei einer Flut Adressbereiche am Reverse Proxy sperren.
- Grenzen: Stacktraces sind minifiziert, und Source-Maps werden nicht ausgeliefert. Eine
  Build-Kennung fehlt noch in den Berichten; sie kommt mit den Images mit Git-SHA (Phase 4). Fehler,
  die eine Error-Boundary abfängt, erreichen den Reporter nicht.

## Überwachung (geplant)

`/api/health/live` und `/api/health/ready` ab Schritt 0.5. In Phase 4 zusätzlich ein Endpunkt, der
meldet: ältester Hold über der Frist, Job-Warteschlange steht, letzter Zahlungsabgleich zu alt, zu
viele Webhook-Fehler, Festplatte fast voll. Ein selbst gehosteter Uptime-Dienst fragt ihn ab und
alarmiert.
