# Glossar

Fachbegriffe in den drei Arbeitssprachen. Die Spalte „Code" nennt den Bezeichner in Datenbank und
API.

## Verkehr und Netz

| Arabisch     | Deutsch              | Code              | Erklärung                                                                           |
| ------------ | -------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| بولمان       | Pullman, Fernbus     | –                 | Reisebus für Strecken zwischen Städten                                              |
| كراج         | Garage, Busbahnhof   | `station`         | Abfahrtsort der Fernbusse, z. B. die großen Busbahnhöfe in Damaskus                 |
| شباك التذاكر | Schalter             | –                 | Ticketverkauf vor Ort; verkauft weiterhin parallel zur Plattform                    |
| مدينة        | Stadt                | `city`            | Suchebene für Fahrgäste („Damaskus nach Aleppo")                                    |
| محطة         | Haltestelle          | `station`         | Konkreter Ort, an dem ein Bus hält; eine Stadt kann mehrere haben                   |
| شركة النقل   | Busfirma             | `company`         | Betreiber der Busse und Mandant der Plattform                                       |
| خط           | Route                | `route`           | Feste Folge von Haltestellen in einer Richtung; die Rückfahrt ist eine eigene Route |
| –            | Routenhalt           | `route_stop`      | Haltestelle an Position `seq` einer Route                                           |
| رحلة         | Fahrt                | `trip`            | Eine konkrete Abfahrt einer Route an einem Tag                                      |
| –            | Fahrthalt            | `trip_stop`       | Kopie des Routenhalts für eine Fahrt, mit Ankunfts- und Abfahrtszeit                |
| مقطع         | Segment, Teilstrecke | `from_seq/to_seq` | Abschnitt einer Fahrt zwischen zwei Halten, als halboffenes Intervall `[von, bis)`  |
| أجرة         | Tarif                | `fare`            | Preis für ein Haltestellenpaar einer Route                                          |
| سائق         | Fahrer               | `DRIVER`          | Rolle für Check-in und Fahrgastliste                                                |

## Sitze und Inventar

| Arabisch     | Deutsch           | Code              | Erklärung                                                                         |
| ------------ | ----------------- | ----------------- | --------------------------------------------------------------------------------- |
| مخطط المقاعد | Sitzplan          | `seat_layout`     | Anordnung der Sitze eines Bustyps, versioniert und unveränderlich, sobald genutzt |
| مقعد         | Sitz              | `seat`            | Einzelner Platz mit Beschriftung (`label`), Reihe und Spalte                      |
| –            | Sitznachbar       | `seat_neighbor`   | Paar direkt nebeneinander liegender Sitze; Grundlage der Geschlechtsregel         |
| –            | Sitzbelegung      | `seat_occupation` | Inventar-Wahrheit: ein Sitz auf einem Segment, nur für aktive Buchungen           |
| حصة          | Online-Kontingent | `online_sellable` | Sitze einer Fahrt, die online verkauft werden dürfen                              |
| –            | Geschlechtsregel  | –                 | Keine Frau neben einem fremden Mann und umgekehrt; gleiche Buchung ausgenommen    |

## Buchung und Zahlung

| Arabisch        | Deutsch            | Code                | Erklärung                                                                     |
| --------------- | ------------------ | ------------------- | ----------------------------------------------------------------------------- |
| راكب            | Fahrgast           | `booking_passenger` | Person auf einem Sitz einer Buchung                                           |
| حجز مؤقت        | Hold               | `HELD`              | Befristete Reservierung, bevor ein Zahlweg gewählt ist (Standard 15 Minuten)  |
| –               | Barreservierung    | `RESERVED`          | Sitz reserviert, Bezahlung bar am Schalter oder beim Einsteigen bis zur Frist |
| حجز             | Buchung            | `booking`           | Kauf eines oder mehrerer Sitze auf einem Segment einer Fahrt                  |
| رمز الحجز       | Buchungscode       | `booking_code`      | 8 Zeichen, nicht erratbar; Zugriff nur zusammen mit der Telefonnummer         |
| –               | Verwaltungslink    | `manage_token`      | Geheimer Link, über den ein Gast die Buchung ansehen oder stornieren kann     |
| تذكرة           | Ticket             | `ticket`            | QR-Code je Fahrgast, entsteht erst bei bestätigter Buchung                    |
| تسجيل الصعود    | Check-in           | `CHECKED_IN`        | Fahrer scannt das Ticket beim Einsteigen                                      |
| إلغاء           | Storno             | `CANCELLED`         | Aufhebung durch Fahrgast, Firma oder System                                   |
| استرداد         | Erstattung         | `refund`            | Rückzahlung als eigener Vorgang mit eigenem Status                            |
| محفظة إلكترونية | Wallet-Überweisung | `WALLET_TRANSFER`   | Zahlung per Sham Cash oder Syriatel Cash, von der Firma manuell bestätigt     |
| –               | ecash              | `ECASH`             | Lizenziertes syrisches Zahlungs-Gateway (geplant, Phase 3)                    |
| عمولة           | Provision          | `commission`        | Anteil von Masar je bestätigter App-Buchung, abgerechnet nach Leistungsmonat  |
| عدم الحضور      | No-Show            | `NO_SHOW`           | Barreservierung ohne Erscheinen; wird je Firma im Bericht gezählt             |

## Technik

| Begriff              | Erklärung                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Minor-Unit           | Kleinste Währungseinheit nach ISO 4217; Beträge werden als ganze Zahl darin gespeichert       |
| Leistungsmonat       | Monat der Abfahrt einer Fahrt; bestimmt, in welchen Provisionsbericht eine Buchung fällt      |
| Mandant              | Eine Busfirma; ihre Daten sind von denen anderer Firmen getrennt                              |
| Outbox               | Tabelle für ausgehende Nachrichten, in derselben Transaktion geschrieben wie die Fachänderung |
| Idempotenz-Schlüssel | Kennung, mit der eine wiederholte Anfrage dasselbe Ergebnis liefert statt eines Duplikats     |
| ADR                  | Architecture Decision Record, siehe `docs/adr/`                                               |
