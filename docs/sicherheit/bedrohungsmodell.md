# Bedrohungsmodell

Stand: 2026-10-12, leichtgewichtig für Fundament und MVP. Überarbeitung vor dem Pilot (Phase 5).

## Schutzgüter

In Reihenfolge des Schadens:

1. Richtigkeit des Sitzinventars. Eine Doppelbuchung kostet das Vertrauen der Firma und der Fahrgäste.
2. Personenbezogene Daten der Fahrgäste: Name, Telefon, Geschlecht, Ausweisnummer.
3. Zahlungsreferenzen und Zugangsdaten zu Zahlungsanbietern.
4. Umsatz- und Provisionsdaten der Firmen.
5. Verfügbarkeit zu Spitzenzeiten, etwa vor Feiertagen.
6. Unveränderlichkeit des Audit-Logs.

## Akteure und typische Angriffe

| Akteur                    | Typischer Angriff                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Anonymer Besucher, Bot    | Sitze massenhaft reservieren (Hamstern), Buchungscodes oder Telefonnummern durchprobieren, Auslastung auslesen |
| Fahrgast mit Konto        | Sitzung stehlen, später Einmalcodes durchprobieren                                                             |
| Firmen-Staff (Innentäter) | Fahrgastlisten oder Ausweisnummern abziehen, Zahlungen für Bekannte bestätigen, Erstattungen auslösen          |
| Fahrer                    | Verlorenes Gerät mit Fahrgastliste; doppelt benutztes Ticket übersehen                                         |
| Plattform-Admin           | Übernommenes Konto bedeutet Zugriff auf alle Firmen                                                            |
| Externer Angreifer        | gefälschte Zahlungs-Webhooks, erfundene Wallet-Referenzen, Credential Stuffing auf Staff-Konten                |

## Vertrauensgrenzen

1. Browser → API: alles ist unvertrauenswürdig, auch Rückkehr-URLs vom Zahlungsanbieter und die
   Uhrzeit des Geräts.
2. Zahlungsanbieter → API: erst nach Signatur, Zeitfenster, Duplikatprüfung und Gegenabfrage beim
   Anbieter vertrauenswürdig.
3. Firma A ↔ Firma B: `companyId` kommt ausschließlich aus der Sitzung.
4. Fahrer-Gerät → API: zwischengespeicherte Daten können veraltet sein.
5. API → Datenbank: nur parametrisierte Abfragen, `$queryRaw` nur als Tagged Template.
6. Migrationen und Admin-Skripte → Datenbank: eigene Datenbankrolle, nie die Rolle der Anwendung.

## Kontrollen

F = im Fundament (Phase 0 und 1) · P = vor dem Pilot · S = später

| Kontrolle                                                                                                                                                                                | Wann                  | Schützt vor                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------- |
| UUIDv7 statt fortlaufender Nummern nach außen                                                                                                                                            | F                     | Aufzählen von Datensätzen                            |
| Buchungscode mit etwa 40 Bit Zufall; Zugriff nur mit Code und Telefon; gleiche Antwort bei falschem Code oder Telefon                                                                    | F                     | Erraten fremder Buchungen                            |
| Fahrgastdaten vor dem Hold; höchstens 3 offene Holds je Telefon, 4 Sitze je Buchung, Hold 15 Minuten                                                                                     | F                     | Sitz-Hamstern                                        |
| Ratenbegrenzung (Mechanismus jetzt, Werte vor dem Pilot kalibrieren)                                                                                                                     | F/P                   | Durchprobieren, Scraping                             |
| Sitzungen als zufällige Tokens, nur Hash gespeichert, Cookie `HttpOnly`, `Secure`, `SameSite=Lax`                                                                                        | F                     | Sitzungsdiebstahl                                    |
| Argon2id, Einladung statt Selbstregistrierung, Verzögerung nach Fehlversuchen                                                                                                            | F                     | Credential Stuffing                                  |
| Guard-Kette Sitzung → Rolle → Firmen-Scope; zusätzlich `companyId` in jeder Abfrage; zusammengesetzte Fremdschlüssel                                                                     | F                     | Zugriff auf fremde Firmen                            |
| Ausweisnummer AES-256-GCM mit Schlüsselversion; Klartext nur mit eigener Berechtigung und Protokoll                                                                                      | F                     | Innentäter, Datenbank-Abzug                          |
| Audit-Log nur anhängend, Anwendungsrolle darf nicht ändern oder löschen                                                                                                                  | F                     | Vertuschung                                          |
| Schwärzung personenbezogener Felder im Logger; keine Personendaten in URLs                                                                                                               | F                     | Leck über Logs                                       |
| Maskierung von Ziffernfolgen ab acht Stellen in Fehlermeldungen und Stacktraces im Log; Fehlerobjekte nur mit Typ, Meldung, Stack und Code                                               | F                     | Leck über Meldungen von Bibliotheken                 |
| Browser-Fehler nur an den eigenen Endpunkt; Pfad nur mit statischen Segmenten; Query, Fragment, lange Tokens und Ziffernfolgen geschwärzt; 20 Berichte je Minute und IP, 120 insgesamt   | F                     | Leck über Fehlerberichte, Log-Flut                   |
| Webhook: Signatur über den Rohtext, Zeitfenster ±5 Minuten, zwei gültige Schlüssel für Rotation, Duplikattabelle, Betrag und Währung gegen Buchung prüfen, Status beim Anbieter abfragen | F (Mechanik), Phase 3 | gefälschte Zahlungen                                 |
| Rückkehr-URL vom Zahlungsanbieter gilt nie als Zahlungsnachweis                                                                                                                          | F                     | im Browser vorgetäuschter Erfolg                     |
| Sicherheitsheader (HSTS, CSP mit Nonce im Portal, `frame-ancestors 'none'`), CORS nur für eigene Origins                                                                                 | F                     | Clickjacking, XSS-Folgen                             |
| Secrets nur aus Umgebung oder Compose-Secrets; Geheimnis-Scan in CI; Abbruch beim Start mit Sandbox-Schlüssel in Produktion                                                              | F                     | Schlüsselabfluss, falsche Umgebung                   |
| Abhängigkeiten: Lockfile, Mindestalter 24 h für neue Versionen, Build-Skripte nur nach Freigabe, Audit in CI, Renovate, Sicherheits-Vorgaben (`overrides`) für transitive Lücken         | F                     | Lieferkettenangriffe                                 |
| Getrennte Datenbankrollen: Laufzeit ohne DDL, Migrationsrolle ohne `CREATEDB` (geprüft)                                                                                                  | F                     | Schemaänderung über eine Lücke in der Anwendung      |
| Timeouts je Datenbankverbindung (Sperre 5 s, untätige Transaktion 10 s)                                                                                                                  | F                     | Blockade einer Fahrt durch eine hängende Transaktion |
| Geheimnis-Scan (gitleaks) für jeden Pull Request und Push; Altfunde begründet in `.gitleaksignore`                                                                                       | F                     | versehentlich eingecheckte Geheimnisse               |
| Anomalie-Sperre bei massenhaften Holds je Fahrt; selbst gehostetes Captcha ab Schwellwert                                                                                                | P                     | Bot-Sabotage vor Feiertagen                          |
| No-Show-Zähler je Telefon: nach 2 No-Shows in 90 Tagen nur noch Online-Zahlung                                                                                                           | P                     | Missbrauch der Barreservierung                       |
| TOTP-Zweitfaktor für Firmen- und Plattform-Admins                                                                                                                                        | P                     | Kontoübernahme                                       |
| Signierter QR-Inhalt (Ed25519) mit Versionszähler für die Offline-Prüfung                                                                                                                | P                     | gefälschte oder stornierte Tickets                   |
| Fahrgastliste für Fahrer minimal; Fahrer-Sitzung endet 24 Stunden nach der Fahrt                                                                                                         | P                     | verlorene Geräte                                     |
| Wallet-Bestätigung: erwarteten Betrag eingeben lassen, tägliche Abgleichliste, Erstattung nur durch Firmen-Admin                                                                         | P                     | gefälschte Überweisungen                             |
| Row-Level-Security in PostgreSQL                                                                                                                                                         | S                     | Fehler in der Mandantentrennung                      |

### Stand der Umsetzung (Schritt 0.8)

Umgesetzt und mit Tests belegt: Sitzungen mit Hash-Speicherung und sicheren Cookie-Flags, Argon2id,
wachsende Wartezeit nach Fehlversuchen, Einladung statt Registrierung, CSRF-Guard, Firmen-Scope
über die Mitgliedschaft (Gegenprobe: ohne den Guard schlägt der Mandantentest fehl), nur
anhängendes Audit-Log, Liste öffentlicher Routen als Test. Offen bis zum Pilot: Zweitfaktor,
Kalibrierung der Ratenbegrenzung, Aufräumen alter Sitzungen.

Seit Schritt 0.8: Das Portal sendet je Anfrage eine CSP mit eigenem Nonce und `strict-dynamic`; ein
Ende-zu-Ende-Test prüft Header, Nonce der Skripte, einen neuen Nonce je Anfrage und Verstöße in der
Konsole. Die Web-App hat noch keine CSP, weil ihre Seiten statisch vorgerendert sind und ein Nonce
je Anfrage das ausschließt (offene Entscheidung, vor Schritt 1.5). Fehlerberichte aus dem Browser
werden bereinigt und begrenzt; ein API-Test prüft die echte Log-Ausgabe auf Telefonnummer,
Buchungscode, Token und Query.

## Sicherheitstests

| Test                                                                                         | Schützt vor                            |
| -------------------------------------------------------------------------------------------- | -------------------------------------- |
| Zwei parallele Transaktionen reservieren denselben Sitz: genau eine gewinnt                  | Doppelbuchung                          |
| Überlappung an der Anwendung vorbei eingefügt: Datenbank lehnt mit `23P01` ab                | vergessene Sperre, verlorene Migration |
| Mitglied von Firma A liest oder ändert Daten von Firma B: 404 oder 403, für jede Route       | Zugriff auf fremde Mandanten           |
| Jede Route ohne passende Rolle: 401 oder 403 (Matrix aller Routen und Rollen)                | vergessener Guard                      |
| Buchungssuche mit richtigem Code und falschem Telefon: dieselbe 404 wie bei unbekanntem Code | Aufzählen                              |
| Webhook mit falscher Signatur oder altem Zeitstempel: abgelehnt, kein Statuswechsel          | Fälschung, Wiederholung                |
| Derselbe Webhook zweimal: zweiter ohne Wirkung                                               | Wiederholungen des Anbieters           |
| Webhook-Betrag weicht ab: Zahlung `AWAITING_REVIEW`, Buchung nicht bestätigt                 | manipulierte Zahlung                   |
| Log-Ausgabe einer Buchung enthält keine Telefonnummer                                        | Leck über Logs                         |
| Fehlerbericht mit Telefonnummer, Buchungscode, Token und Query: nichts davon im Log          | Leck über Fehlerberichte               |
| Sechste Buchungssuche in einer Minute: 429                                                   | Durchprobieren                         |

## Bewusst akzeptierte Risiken

- Ein einzelner Server ohne Hochverfügbarkeit, kurze Ausfälle beim Deployment.
- Wallet-Zahlungen werden manuell bestätigt.
- Der Schalter kann online freigegebene Sitze verkaufen; das System kann das nicht verhindern.
- Keine Row-Level-Security im MVP.
- Die Geschlechtsangabe ist eine Selbstauskunft.
- Ratenbegrenzung im Speicher eines Prozesses, solange es nur eine Instanz gibt.
- Eine hohe Lücke in `braces` (GHSA-vfj7-8cjw-p6xm, Stack-Überlauf bei tief verschachtelten Mustern)
  ohne verfügbaren Fix. Sie betrifft nur das Linten mit Mustern aus dem eigenen Repo und ist in
  `pnpm-workspace.yaml` gezielt ignoriert.
- Fehlerberichte: Ein klein getippter Buchungscode ohne Ziffern sieht aus wie ein Routensegment und
  bleibt im gemeldeten Pfad stehen. Ein Code allein öffnet keine Buchung.
- Die Web-App läuft bis zur Entscheidung ohne CSP. Sie hat bisher keine Eingabefelder.

## Nicht weiter verfolgt

PCI-Anforderungen über die Stufe für gehostete Zahlungsseiten hinaus, Hardware-Sicherheitsmodule,
mehrere Regionen, Vier-Augen-Prinzip für jede Bestätigung, Abwehr staatlicher DDoS-Angriffe.
