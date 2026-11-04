# Datenschutz

Stand: Entwurf vom 2026-10-12, gilt ab Schritt 1.1. Maßstab ist DSGVO-Niveau, auch wenn die
Betreibergesellschaft syrisch sein wird: Das Hosting liegt in der EU, und Angehörige im Ausland
können Nutzer sein. Welche syrischen Vorschriften gelten, ist noch nicht geprüft (siehe
[offene Entscheidungen](offene-entscheidungen.md)). Entscheidung dazu: ADR 0016.

## Grundsätze

- Nur erheben, was eine Funktion wirklich braucht.
- Jedes Feld hat einen Zweck und eine Frist.
- Personenbezogene Daten erscheinen nie in Logs, URLs, Analysedaten oder Fehlermeldungen.
- Zugriff nach Rolle und Firma; Einsicht in besonders schutzwürdige Felder wird protokolliert.

## Dateninventar

| Daten                          | Zweck                                             | Pflicht                        | Speicherung                                                                                               | Frist (Annahme)                                                                                                                                  | Sichtbar für                                                                                 |
| ------------------------------ | ------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Name des Fahrgasts             | Ticket, Fahrgastliste, Kontrolle beim Einsteigen  | ja                             | Klartext                                                                                                  | 12 Monate nach Abfahrt, dann pseudonymisiert                                                                                                     | Firma der Fahrt, Fahrer der Fahrt                                                            |
| Telefonnummer (Kontakt)        | Zugriff auf die Buchung, Rückfragen der Firma     | ja                             | Klartext, normalisiert (E.164)                                                                            | 12 Monate nach Abfahrt, dann als HMAC                                                                                                            | Firma der Fahrt                                                                              |
| Geschlecht                     | ausschließlich Geschlechtsregel und Fahrgastliste | wenn die Fahrt die Regel nutzt | Klartext (Enum)                                                                                           | wie Name                                                                                                                                         | Firma der Fahrt, Fahrer                                                                      |
| Ausweisnummer                  | nur wenn die Firma sie verlangt (Kontrollpunkte)  | je Firma                       | AES-256-GCM verschlüsselt; der Gast sieht die letzten 4 Stellen, das Personal nur „vorhanden" (ADR 0028)  | 30 Tage nach Abfahrt löschen (Lösch-Job folgt, siehe unten)                                                                                      | Klartext: noch kein Endpunkt; künftig nur mit eigener Berechtigung, protokolliert (ADR 0016) |
| E-Mail (Fahrgast)              | optional für Benachrichtigungen                   | nein                           | Klartext                                                                                                  | wie Name                                                                                                                                         | Firma der Fahrt                                                                              |
| E-Mail, Passwort (Staff)       | Anmeldung                                         | ja                             | Passwort nur als Argon2id-Hash                                                                            | bis Konto gelöscht                                                                                                                               | Plattform-Admin                                                                              |
| Buchungs- und Zahlungsdaten    | Vertrag, Abrechnung, Provision                    | ja                             | ohne Kartendaten (die sieht Masar nie)                                                                    | dauerhaft, aber ohne Personenbezug nach Frist                                                                                                    | Firma, Plattform-Admin                                                                       |
| IP-Adresse, User-Agent         | Sicherheit (Sitzungen, Ratenbegrenzung, Audit)    | technisch                      | Sitzungen (IP, User-Agent), Reset-Links (`password_reset.requested_ip`, nur IP), Audit-Log (nur IP)       | Sitzung und Reset-Link: bis Ablauf, Aufräum-Job folgt (30 Tage nach Ablauf, [offene Entscheidungen](offene-entscheidungen.md)); Audit: 24 Monate | Plattform-Admin                                                                              |
| Fehlerberichte aus dem Browser | Fehler in Web und Portal finden und beheben       | technisch                      | nur im Server-Log: App, Art, bereinigter Pfad, bereinigte Meldung und Stacktrace; keine IP, keine Sitzung | wie Server-Logs (Frist mit der Log-Rotation in Phase 4 festlegen)                                                                                | Betrieb                                                                                      |

Die Fristen sind Platzhalter. Sie sind konfigurierbar und werden mit der ersten Partnerfirma und
rechtlicher Prüfung festgelegt.

## Geschlechtsangabe

Die Angabe dient nur der Sitzregel, die Frauen vor einem Platz neben fremden Männern schützt. Sie ist
eine Selbstauskunft mit zwei Werten. Die Oberfläche zeigt nie das Geschlecht eines anderen
Fahrgasts, sondern nur, ob ein Sitz wählbar ist. Aus der Wählbarkeit lässt sich das Geschlecht eines
Nachbarn erschließen; das entspricht der heutigen Praxis am Schalter und ist bewusst akzeptiert. Die
Datenschutzhinweise erklären den Zweck in Arabisch und Englisch.

Die anonyme Sitzplan-Abfrage nimmt das selbst gewählte Geschlecht als Query-Parameter an (ADR
0019). Die zweite Ausnahme ist der Suchtext der Buchungsliste im Portal (Anfang des Buchungscodes
oder Ende der Telefonnummer, ADR 0028). Für beide gilt: Weder API noch Reverse-Proxy loggen die
Query, und die Oberfläche hält den Wert nur im Zustand der Seite, nie in deren Adresse.

Im Portal sieht das Personal Telefonnummern nur maskiert (`+963 9** *** 456`) und Ausweisnummern
nur als „vorhanden". Den Klartext von Telefon und E-Mail zeigt ein eigener Klick; die API vermerkt
jeden solchen Zugriff im Audit-Log, nur mit IDs (ADR 0028). Fahrer sehen in der Fahrgastliste Name,
Geschlecht, Sitz und Halte, aber keine Kontaktdaten.

## Löschung und Pseudonymisierung

Planungsstand: Den Lösch-Job gibt es noch nicht (ADR 0016, Folgearbeit). Bis dahin bleiben
verschlüsselte Ausweisnummern und Kontaktdaten ohne Frist gespeichert. Der Job muss vor dem Pilot
laufen. Er soll so arbeiten:

- Ein täglicher Job löscht Ausweisnummern nach Ablauf der Frist (aus der Abfahrt der Fahrt) und
  setzt `pii_purged_at`.
- Nach der längeren Frist (`pii_purge_after`) werden Name und E-Mail durch Platzhalter ersetzt.
  Die Telefonnummer wird durch einen HMAC-SHA-256 mit eigenem Schlüssel ersetzt, nicht durch einen
  einfachen Hash: Telefonnummern sind aufzählbar, ein einfacher Hash ließe sich zurückrechnen. Das
  Ergebnis ist pseudonym, nicht anonym. Die Buchungszeile bleibt für Abrechnung und Statistik
  erhalten.
- Provisionsberichte sind unveränderliche Momentaufnahmen und enthalten keine Personendaten.
- Sicherungen laufen nach 30 Tagen ab. Gelöschte Daten verschwinden damit spätestens nach 30 Tagen
  auch aus Sicherungen.

## Schlüssel

- Ausweisnummern: AES-256-GCM mit zufälliger Nonce je Wert. Die ID der Fahrgastzeile ist
  Associated Data, damit sich ein Chiffrat nicht unbemerkt in eine andere Zeile kopieren lässt.
- Schlüssel kommen aus Compose-Secrets, nie aus dem Repo, und tragen eine Version (`key_id`).
  Rotation: neuer Schlüssel für neue Werte, alle eingetragenen Schlüssel entschlüsseln. Ein Job, der
  alte Werte neu verschlüsselt, ist noch nicht umgesetzt; bis dahin bleibt der alte Schlüssel
  eingetragen.
- Schlüssel werden getrennt von den Datenbank-Sicherungen gesichert. Ein verlorener Schlüssel macht
  die damit verschlüsselten Ausweisnummern unlesbar.
- QR-Codes der Tickets und Lesetokens nach Code und Telefon: HMAC-Schlüssel `TICKET_QR_KEY` und
  `BOOKING_ACCESS_KEY` (ADR 0022), ebenso aus Compose-Secrets und getrennt gesichert. In der
  Datenbank steht nur der SHA-256 des QR-Tokens.

## Ticket im Browser

Die Ticketseite (Schritt 1.4, ADR 0022) speichert die zuletzt geladene Ansicht im `localStorage` des
Geräts, damit sie ohne Netz lesbar bleibt: Buchungscode, Fahrt, Sitze, Namen der Fahrgäste und die
QR-Codes, keine Telefonnummer, kein Geschlecht, keine Ausweisnummer und nie das Token. Das Token
steht nur im Fragment der Seiten-URL und erreicht den Web-Server nur im Body einer Server Action.
Der Fahrgast kann die Kopie mit „Von diesem Gerät entfernen" löschen. Der Service Worker hält nur
die leere Seite und statische Dateien.

Beim Buchen (Schritt 1.5, ADR 0023) leben Namen, Geschlecht, Ausweisnummer und Kontakt nur im
Speicher der offenen Seite und gehen per Server Action im POST-Body an den Web-Server und von dort
im Body an die API; nichts davon landet in einer URL, im `localStorage` oder in einem Log. Die
Ausweisnummer fragt das Formular nur ab, wenn die Firma sie verlangt. Die Seite „Zahlweg wählen"
bekommt von der API nur Fahrt, Sitze, Namen, Betrag und Hold-Ende zurück, keine Kontaktdaten und
kein Geschlecht.

## Logs und Fehlermeldungen

Nie geloggt werden: Telefonnummer, Name, Ausweisnummer, Geschlecht, Passwörter, Tokens, Einmalcodes,
Buchungscodes im Klartext und Rohdaten von Zahlungs-Webhooks. Personen erscheinen in Logs nur als
interne ID. pino schwärzt die bekannten Felder zusätzlich (`REDACTED_KEYS` in
`apps/api/src/common/logging.ts`, benannt wie die Personenfelder in Schema und Request-DTOs, z. B.
`contactEmail`, `phoneE164`, `nationalIdLast4`, `displayName`, `notes`, der Suchtext und
`contact.name`). Fehlermeldungen und Stacktraces werden vor dem Loggen auf Ziffernfolgen ab acht
Stellen geprüft und maskiert, auch in arabisch-indischen und persischen Ziffern und mit Leerraum,
Bindestrich, Punkt oder Klammern dazwischen; UUIDs und ISO-Zeitstempel bleiben lesbar. Grund:
Bibliotheken können Eingabewerte in Meldungen schreiben. Ein Test prüft die echte Log-Ausgabe der Anwendung.

Fehlerberichte aus dem Browser (`POST /api/v1/client-errors`) bereinigt die API vor dem Loggen:
Pfadsegmente außer statischen Routennamen werden zu `:param`, Query und Fragment fallen weg, lange
Tokens und Ziffernfolgen werden geschwärzt. Der Browser sendet das Sitzungs-Cookie nicht mit, und
der Logeintrag enthält weder IP noch Konto.

## Rechte der Betroffenen

Im MVP bearbeitet der Support Auskunft und Löschung manuell mit einem Admin-Skript. Selbstbedienung
folgt später.

## Auftragsverarbeiter

| Dienst                       | Zweck                | Ort    | Stand              |
| ---------------------------- | -------------------- | ------ | ------------------ |
| VPS-Anbieter (z. B. Hetzner) | Hosting, Sicherungen | EU     | geplant            |
| E-Mail-Versand               | Benachrichtigungen   | offen  | Anbieter offen     |
| ecash                        | Online-Zahlungen     | Syrien | Phase 3, ungeprüft |
