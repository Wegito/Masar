# Runbook

Stand: Skelett vom 2026-10-12. Es gibt noch keine Produktion. Die Abschnitte werden in Phase 4 und 5
ausgearbeitet und vor dem Pilot einmal geübt.

## Deployment (geplant)

1. CI baut Images mit dem Git-SHA als Tag und legt sie in der GitHub Container Registry ab.
2. Auf dem Server: Images ziehen, `prisma migrate deploy` als einmaliger Container, dann
   `docker compose up -d`.
3. Migrationen sind additiv. Das vorherige Image muss mit dem neuen Schema weiterlaufen können.

**Rollback:** vorheriges Image-Tag starten. Nie eine Migration rückwärts ausführen.

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

## Reverse Proxy

Entwurf nach ADR 0033: `docker/caddy/Caddyfile` und `compose.prod.example.yaml`. Nur Caddy
veröffentlicht Ports (80, 443); Web (3000), Portal (3002) und API (3001) lauschen im internen Netz
`app`, PostgreSQL im internen Netz `db`. **Nicht hinter echtem Caddy getestet**, die Syntax ist
nicht mit `caddy validate` geprüft.

- Caddy setzt `X-Forwarded-For` selbst auf die IP des Gegenübers und übernimmt nie Werte des
  Clients; `/api/*` geht direkt an die API, alles andere an Web bzw. Portal.
- Web und Portal reichen bei Server-Aufrufen genau eine geprüfte IP weiter (`forwardedClientIp`).
- Die API läuft mit `TRUST_PROXY=1`: ein Hop für beide Wege (Caddy → API und Caddy → Web/Portal →
  API). Keinen anderen Wert setzen, solange nichts vor Caddy steht. Mit `0` teilen sich alle
  Fahrgäste die Limits; mit `2` oder mehr ließe sich die IP fälschen, sobald irgendwo angehängt
  statt ersetzt wird.
- Nie `ports:` an `api`, `web` oder `portal` hängen: Wer die API direkt erreicht, kann jede IP
  vorgeben.
- Zugriffslog: ohne Querystring und Header, IP auf /24 bzw. /48 gekürzt.

**Prüfliste beim ersten Einrichten** (Hosts und IP anpassen):

1. `docker compose -f compose.prod.yaml exec caddy caddy validate --config /etc/caddy/Caddyfile`
   meldet keinen Fehler.
2. Von außen nur 80 und 443 offen: `nmap -p 3000-3002,5432 <server>` zeigt alles geschlossen.
3. Weg Caddy → API: Login mit einem Testkonto und gefälschtem Header, von einem Rechner mit
   bekannter IP. Danach in der Datenbank `SELECT ip FROM session ORDER BY created_at DESC LIMIT 1`:
   Dort steht die eigene IP, nicht `6.6.6.6`.

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<portal-host>/api/v1/auth/login \
     -H 'X-Forwarded-For: 6.6.6.6' -H 'Content-Type: application/json' \
     -H 'Origin: https://<portal-host>' -d '{"email":"<test>","password":"<test>"}'
   ```

4. Weg Caddy → Web → API: im Browser mit einer Erweiterung, die `X-Forwarded-For: 6.6.6.6`
   setzt, eine Testbuchung in der Web-App halten. Im Audit-Log (`BOOKING_HELD`) steht die eigene
   IP, nicht `6.6.6.6`. Danach die Testbuchung stornieren.
5. Zugriffslog: `docker compose logs caddy` enthält bei Suche und Sitzplan keinen Querystring,
   keine Header und nur gekürzte IPs.
6. Ergebnis mit Datum in ADR 0033 als Nachtrag festhalten.

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
| Sitze bleiben blockiert           | Job-Warteschlange prüfen; der Ablauf-Job ist wiederholbar; Reservierungen derselben Fahrt geben Holds auch selbst frei                                                                          |
| Staff-Konto kompromittiert        | Passwort-Reset auslösen (meldet alle Sitzungen ab) oder Sitzungen per SQL widerrufen (`UPDATE session SET revoked_at = now() WHERE user_id = …`); Audit-Log der Person lesen; Firma informieren |
| Massenhafte Holds beobachtet      | betroffene Holds freigeben, Telefonnummern oder Adressbereiche sperren, Captcha-Schwelle senken                                                                                                 |
| Festplatte voll                   | Log-Rotation und alte Sicherungen prüfen; PostgreSQL schreibt sonst nicht mehr                                                                                                                  |

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
