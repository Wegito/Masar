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

| Daten                       | Zweck                                             | Pflicht                        | Speicherung                                             | Frist (Annahme)                                          | Sichtbar für                                         |
| --------------------------- | ------------------------------------------------- | ------------------------------ | ------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Name des Fahrgasts          | Ticket, Fahrgastliste, Kontrolle beim Einsteigen  | ja                             | Klartext                                                | 12 Monate nach Abfahrt, dann pseudonymisiert             | Firma der Fahrt, Fahrer der Fahrt                    |
| Telefonnummer (Kontakt)     | Zugriff auf die Buchung, Rückfragen der Firma     | ja                             | Klartext, normalisiert (E.164)                          | 12 Monate nach Abfahrt, dann als HMAC                    | Firma der Fahrt                                      |
| Geschlecht                  | ausschließlich Geschlechtsregel und Fahrgastliste | wenn die Fahrt die Regel nutzt | Klartext (Enum)                                         | wie Name                                                 | Firma der Fahrt, Fahrer                              |
| Ausweisnummer               | nur wenn die Firma sie verlangt (Kontrollpunkte)  | je Firma                       | AES-256-GCM verschlüsselt, Anzeige nur letzte 4 Stellen | 30 Tage nach Abfahrt gelöscht                            | Klartext nur mit eigener Berechtigung, protokolliert |
| E-Mail (Fahrgast)           | optional für Benachrichtigungen                   | nein                           | Klartext                                                | wie Name                                                 | Firma der Fahrt                                      |
| E-Mail, Passwort (Staff)    | Anmeldung                                         | ja                             | Passwort nur als Argon2id-Hash                          | bis Konto gelöscht                                       | Plattform-Admin                                      |
| Buchungs- und Zahlungsdaten | Vertrag, Abrechnung, Provision                    | ja                             | ohne Kartendaten (die sieht Masar nie)                  | dauerhaft, aber ohne Personenbezug nach Frist            | Firma, Plattform-Admin                               |
| IP-Adresse, User-Agent      | Sicherheit (Sitzungen, Ratenbegrenzung, Audit)    | technisch                      | Sitzungen, Audit-Log                                    | Sitzung: bis Ablauf, Aufräum-Job folgt; Audit: 24 Monate | Plattform-Admin                                      |

Die Fristen sind Platzhalter. Sie sind konfigurierbar und werden mit der ersten Partnerfirma und
rechtlicher Prüfung festgelegt.

## Geschlechtsangabe

Die Angabe dient nur der Sitzregel, die Frauen vor einem Platz neben fremden Männern schützt. Sie ist
eine Selbstauskunft mit zwei Werten. Die Oberfläche zeigt nie das Geschlecht eines anderen
Fahrgasts, sondern nur, ob ein Sitz wählbar ist. Aus der Wählbarkeit lässt sich das Geschlecht eines
Nachbarn erschließen; das entspricht der heutigen Praxis am Schalter und ist bewusst akzeptiert. Die
Datenschutzhinweise erklären den Zweck in Arabisch und Englisch.

## Löschung und Pseudonymisierung

- Ein täglicher Job löscht Ausweisnummern nach Ablauf der Frist und setzt `pii_purged_at`.
- Nach der längeren Frist werden Name und E-Mail durch Platzhalter ersetzt. Die Telefonnummer wird
  durch einen HMAC-SHA-256 mit eigenem Schlüssel ersetzt, nicht durch einen einfachen Hash:
  Telefonnummern sind aufzählbar, ein einfacher Hash ließe sich zurückrechnen. Das Ergebnis ist
  pseudonym, nicht anonym. Die Buchungszeile bleibt für Abrechnung und Statistik erhalten.
- Provisionsberichte sind unveränderliche Momentaufnahmen und enthalten keine Personendaten.
- Sicherungen laufen nach 30 Tagen ab. Gelöschte Daten verschwinden damit spätestens nach 30 Tagen
  auch aus Sicherungen.

## Schlüssel

- Ausweisnummern: AES-256-GCM mit zufälliger Nonce je Wert. Die ID der Fahrgastzeile ist
  Associated Data, damit sich ein Chiffrat nicht unbemerkt in eine andere Zeile kopieren lässt.
- Schlüssel kommen aus Compose-Secrets, nie aus dem Repo, und tragen eine Version (`key_id`).
  Rotation: neuer Schlüssel für neue Werte, ein Job verschlüsselt alte Werte neu.
- Schlüssel werden getrennt von den Datenbank-Sicherungen gesichert. Ein verlorener Schlüssel macht
  die damit verschlüsselten Ausweisnummern unlesbar.

## Logs und Fehlermeldungen

Nie geloggt werden: Telefonnummer, Name, Ausweisnummer, Geschlecht, Passwörter, Tokens, Einmalcodes,
Buchungscodes im Klartext und Rohdaten von Zahlungs-Webhooks. Personen erscheinen in Logs nur als
interne ID. pino schwärzt die bekannten Felder zusätzlich. Fehlermeldungen und Stacktraces werden vor dem
Loggen auf Ziffernfolgen ab acht Stellen geprüft und maskiert, weil Bibliotheken Eingabewerte in
Meldungen schreiben können. Ein Test prüft die echte Log-Ausgabe der Anwendung.

## Rechte der Betroffenen

Im MVP bearbeitet der Support Auskunft und Löschung manuell mit einem Admin-Skript. Selbstbedienung
folgt später.

## Auftragsverarbeiter

| Dienst                       | Zweck                | Ort    | Stand              |
| ---------------------------- | -------------------- | ------ | ------------------ |
| VPS-Anbieter (z. B. Hetzner) | Hosting, Sicherungen | EU     | geplant            |
| E-Mail-Versand               | Benachrichtigungen   | offen  | Anbieter offen     |
| ecash                        | Online-Zahlungen     | Syrien | Phase 3, ungeprüft |
