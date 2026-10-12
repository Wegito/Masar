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

## Sicherung und Wiederherstellung (geplant)

- `pg_dump` verschlüsselt, im Pilot stündlich, sonst täglich; Aufbewahrung 30 Tage.
- Wöchentlicher automatischer Restore-Test in eine Wegwerf-Datenbank.
- Ziele: höchstens 1 Stunde Datenverlust, Wiederherstellung in 4 Stunden.
- Nach einem Restore: Buchungen der verlorenen Zeitspanne mit Zahlungsanbieter und Firmenlisten
  abgleichen. Ein alter Stand kennt Tickets nicht, die Fahrgäste bereits haben.

## Vorfälle

Jeder Vorfall: erkennen, eindämmen, untersuchen, beheben, nachbereiten. Untersuchung immer über die
Request-ID und das Audit-Log, nie über personenbezogene Daten im Log.

| Vorfall                           | Erste Schritte                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Doppelbuchung gemeldet            | Belegungen und Audit der Fahrt prüfen; Herkunft klären (Schalter außerhalb des Kontingents oder Fehler im System)      |
| Zahlung ohne bestätigte Buchung   | Webhook-Tabelle und Status beim Anbieter vergleichen; Sitz neu belegen oder erstatten                                  |
| Buchung bestätigt, Zahlung fehlt  | Audit: wer hat bestätigt; Wallet-Abgleichliste prüfen                                                                  |
| Fahrt gestrichen                  | Fahrt auf `CANCELLED`: storniert alle Buchungen, legt Erstattungen an, benachrichtigt; Ergebnis prüfen                 |
| Webhooks kommen nicht an          | Abgleich manuell starten; Anbieterstatus prüfen; Schlüsselrotation prüfen                                              |
| Zahlungsanbieter nicht erreichbar | Online-Zahlung ausblenden; Bar und Wallet bleiben verfügbar                                                            |
| Sitze bleiben blockiert           | Job-Warteschlange prüfen; der Ablauf-Job ist wiederholbar; Reservierungen derselben Fahrt geben Holds auch selbst frei |
| Staff-Konto kompromittiert        | Sitzungen widerrufen, Passwort zurücksetzen, Audit-Log der Sitzung lesen, betroffene Firma informieren                 |
| Massenhafte Holds beobachtet      | betroffene Holds freigeben, Telefonnummern oder Adressbereiche sperren, Captcha-Schwelle senken                        |
| Festplatte voll                   | Log-Rotation und alte Sicherungen prüfen; PostgreSQL schreibt sonst nicht mehr                                         |

## Überwachung (geplant)

`/api/health/live` und `/api/health/ready` ab Schritt 0.5. In Phase 4 zusätzlich ein Endpunkt, der
meldet: ältester Hold über der Frist, Job-Warteschlange steht, letzter Zahlungsabgleich zu alt, zu
viele Webhook-Fehler, Festplatte fast voll. Ein selbst gehosteter Uptime-Dienst fragt ihn ab und
alarmiert.
