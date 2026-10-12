# ADR 0016: Datenminimierung, Verschlüsselung der Ausweisnummer, Löschfristen

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Masar verarbeitet Daten von Fahrgästen: Name, Telefonnummer, Geschlecht (für die Sitzregel, ADR 0006) und je nach Firma die Ausweisnummer, weil Fernbusse Kontrollpunkte passieren und Firmen Namen erfassen. In der Fragerunde gewählt: **Name und Telefon sind Pflicht, die Ausweisnummer ist je Firma optional**.

Die Betreiberfirma wird syrisch sein, das Hosting liegt in der EU, und Angehörige im Ausland sollen später für Familie in Syrien buchen. Gerade Frauen sollen der App vertrauen können. Ein Datenleck mit Ausweisnummern, Telefonnummern und Geschlecht wäre schwerwiegend.

## Entscheidung

**Maßstab:** Datenschutz auf DSGVO-Niveau, unabhängig davon, welches Recht formal gilt.

**Datenminimierung**

| Datum                 | Zweck                                              | Pflicht          | Frist (Platzhalter)              |
| --------------------- | -------------------------------------------------- | ---------------- | -------------------------------- |
| Name                  | Ticket, Fahrgastliste                              | ja               | nach 12 Monaten pseudonymisieren |
| Telefonnummer (E.164) | Zugriff auf die Buchung, Kontakt bei Fahrtänderung | ja               | nach 12 Monaten pseudonymisieren |
| Geschlecht            | Sitzregel, Fahrgastliste                           | wenn Regel aktiv | mit dem Namen pseudonymisieren   |
| Ausweisnummer         | Kontrollpunkte, nur wenn die Firma es verlangt     | je Firma         | 30 Tage nach Abfahrt löschen     |
| E-Mail                | Benachrichtigung                                   | nein             | wie Telefonnummer                |

**Ausweisnummer**

- Verschlüsselung in der Anwendung mit AES-256-GCM, zufälliger 96-Bit-Nonce je Wert.
- Die ID der Fahrgastzeile ist Associated Data. Ein Chiffrat lässt sich so nicht unbemerkt in eine andere Zeile kopieren.
- Spalten: `national_id_encrypted` (Nonce, Chiffrat, Tag), `national_id_key_id`, `national_id_last4` (nur zur Anzeige).
- Schlüssel kommen aus Compose-Secrets, nie aus dem Repo. Mehrere Schlüssel sind über `key_id` gleichzeitig lesbar; Rotation = neuer Schlüssel für neue Werte plus Job, der alte Werte neu verschlüsselt.
- Klartext nur mit eigener Berechtigung und Audit-Eintrag mit Begründung. Personal und Fahrer sehen sonst nur die letzten vier Stellen.
- Eine Suche nach Ausweisnummern ist nicht vorgesehen.

**Pseudonymisierung und Löschung**

- Jede Fahrgastzeile trägt `pii_purge_after`. Ein Job löscht oder pseudonymisiert nach konfigurierbaren Fristen.
- Name wird durch einen Platzhalter ersetzt. Die Telefonnummer wird durch einen **HMAC-SHA-256 mit eigenem Schlüssel** ersetzt, nicht durch einen einfachen Hash: Telefonnummern sind aufzählbar, ein einfacher Hash ließe sich zurückrechnen. Das Ergebnis bleibt pseudonym, nicht anonym.
- Buchungszeilen mit Beträgen, Daten, Status, Sitz und Teilstrecke bleiben für die Abrechnung erhalten. Provisionsberichte sind Schnappschüsse ohne Namen (ADR 0017).
- Backups laufen nach 30 Tagen ab. Löschungen erreichen Backups damit nach höchstens 30 Tagen.

**Logs, Exporte, Auskunft**

- Nie in Logs: Telefonnummer, Name, Ausweisnummer, Geschlecht, Passwörter, Tokens, Buchungscodes im Klartext. Personen nur als IDs. Redaction im Logger als zweite Linie.
- Abrufe mit personenbezogenen Daten laufen per POST, nie mit Daten in der URL.
- Exporte (Fahrgastliste, Berichte) nur rollenbasiert und mit Audit-Eintrag.
- Auskunft und Löschung auf Antrag im MVP als manueller Support-Prozess mit Admin-Skript.
- Datenschutzhinweise auf Arabisch und Englisch, einschließlich des Zwecks der Geschlechtsangabe.

## Begründung

- Was nicht gespeichert ist, kann nicht abfließen. Kurze Fristen begrenzen den Schaden eines Lecks.
- Verschlüsselung in der Anwendung schützt gegen Datenbank-Dumps, gestohlene Backups und Personen mit reinem Datenbankzugang.
- Der Maßstab DSGVO hält den Weg für EU-Nutzer und EU-Partner offen und passt zum Vertrauensversprechen.

## Konsequenzen

- **Positiv:** Ein Datenbank-Dump allein enthält keine lesbaren Ausweisnummern.
- **Negativ:** Ein kompromittierter Anwendungsserver kennt den Schlüssel; dagegen schützt die Verschlüsselung nicht.
- **Negativ:** Schlüsselverwaltung ist manuell (kein KMS beim gewählten Hoster). Geht ein Schlüssel verloren, sind die damit verschlüsselten Ausweisnummern verloren. Schlüssel werden deshalb getrennt von Datenbank-Backups gesichert.
- **Negativ:** Lösch-Jobs müssen überwacht werden; ein stiller Ausfall verletzt die Fristen.
- **Folgearbeit:** Dateninventar in `docs/datenschutz.md`; Purge-Job mit konfigurierbaren Fristen; Test, dass Logs bei einer Buchung keine Telefonnummer enthalten; Datenschutztexte ar/en vor dem Pilot.

## Verworfene Alternativen

- **Name und Ausweisnummer immer Pflicht:** mehr sensible Daten bei jeder Buchung, auch dort, wo keine Firma sie braucht.
- **Nur der Name:** Risiko, dass Firmen Tickets ohne Ausweisangabe beim Einsteigen ablehnen.

## Annahmen und Revisionsauslöser

- Annahme: Firmen brauchen die Ausweisnummer nur bis kurz nach der Fahrt. Mit der ersten Partnerfirma bestätigen.
- Annahme: Die Fristen 30 Tage und 12 Monate sind Platzhalter. Festlegung mit Partner und rechtlicher Beratung.
- Unbestätigt: Datenschutzvorgaben im syrischen Recht. Genannt wird das Gesetz Nr. 20/2022 über Cyberkriminalität; Inhalt und Anwendbarkeit sind nicht geprüft.
- Vorschlag ohne Entscheidung: Audit-Einträge 24 Monate aufbewahren.
- Neu bewerten bei einem Schlüsselverdacht, bei Verfügbarkeit eines KMS, oder wenn Behörden Datenhaltung im Inland verlangen.

## Verweise

- ADR 0006 (Geschlecht), ADR 0009 (Zugriff), ADR 0014 (Backups), ADR 0017 (Abrechnung ohne Namen)
- `docs/datenschutz.md`, `docs/sicherheit/bedrohungsmodell.md`
