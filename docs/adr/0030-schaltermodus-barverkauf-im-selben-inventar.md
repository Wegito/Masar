# ADR 0030: Schaltermodus: Barverkauf sofort bestätigt im selben Inventar, gleiche Regeln, Idempotenz je Kanal

Status: Angenommen · Datum: 2026-11-04 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 2.6, Entscheidungen übertragen)

## Kontext

Schritt 2.6 der Roadmap: Das Personal einer Firma (`ADMIN`, `AGENT`) verkauft am Schalter Sitze im
selben Inventar wie online. Vorhanden waren (Stand 2.5):

- Der Kanal `COUNTER` im Enum `BookingChannel` und in `checkSeatSelection` (ignoriert
  `online_sellable`, respektiert `blocked`, ADR 0007) und in `salesOpen` (Verkauf bis zur
  Abfahrt). Kein Schreibpfad nutzte ihn.
- Die Buchung entstand nur als `HELD` mit Hold-Frist und Verwaltungstoken (`POST /bookings`), danach
  `RESERVED` (bar) und `CONFIRMED` über „Barzahlung bestätigen". Am Schalter wären das drei Schritte
  mit einer Lücke, in der ein Hold abläuft.
- `booking` erlaubt `CONFIRMED` mit `confirmed_at` ohne Hold (`booking_confirmed_has_timestamp`,
  `booking_held_has_expiry` gilt nur für `HELD`); `manage_token_hash` ist nullable.
- `idempotency_key` ist global eindeutig. Eine Online-Wiederholung gibt ein neues Verwaltungstoken
  für die gefundene Buchung aus (ADR 0020) und prüfte nur Fahrt, Teilstrecke und Sitze.

## Entscheidung

**Verkauf in einer Transaktion.** `POST companies/:companyId/counter/sales` (Body wie
`POST /bookings`, `Idempotency-Key` Pflicht) läuft im `BookingsService` (`sellAtCounter`) unter der
Trip-Sperre: Trip sperren → abgelaufene freigeben → frisch lesen → prüfen → Buchung direkt
`CONFIRMED` mit `payment_method = CASH`, `confirmed_at`, eingefrorener Provision (ADR 0017),
Fahrgäste, Belegungen, Tickets (QR-Hash nach ADR 0022), Audit `BOOKING_SOLD_AT_COUNTER` (Person als
ID) und Outbox `BOOKING_CONFIRMED`. Kein Hold, keine Barfrist, kein Verwaltungstoken; der Fahrgast
liest das Ticket mit Code und Telefon (ADR 0022) oder bekommt den Ausdruck.

**Dieselben Regeln wie online.** Teilstrecke halboffen, Tarif der Teilstrecke am Fahrtag
(ADR 0026), Kontingent mit Kanal `COUNTER` (Schalter- und Online-Sitze, nie gesperrte; ADR 0007),
Geschlechtsregel (ADR 0006) und Ausweisnummer nur verschlüsselt, wenn die Firma sie verlangt
(ADR 0016). Prüfung und Schreiben teilen sich die Bausteine mit der Gastbuchung
(`segmentAndFare`, `checkSeats`, `insertPassengersAndOccupy`, `issueTickets`, `commissionFor`).

- **Geschlechtsregel gilt am Schalter unverändert, ohne Übersteuerung.** ADR 0006 nennt sie das
  Kernversprechen „unabhängig vom Kanal"; eine Übersteuerung durch das Personal würde es brechen und
  ist mit der Ausnahme „dieselbe Buchung" für Familien nicht nötig.
- **Nicht am Schalter:** die Grenze offener Buchungen je Telefon (`TOO_MANY_OPEN_HOLDS`, gegen
  erfundene Holds) und der Online-Verkaufsschluss. Der Schalter verkauft bis zur Abfahrt
  (`SALES_CLOSED` danach).
- **Bleibt:** höchstens 9 Sitze je Buchung (`TOO_MANY_SEATS`); größere Gruppen buchen mehrfach.

**Idempotenz je Kanal und Firma.** Eine Wiederholung ergibt die vorhandene Buchung nur bei gleichem
Kanal, gleicher Firma (Schalter), Fahrt, Teilstrecke und Sitzen (`isSameBookingRequest`), sonst
`IDEMPOTENCY_KEY_REUSED`. Das gilt auch für die Gastbuchung: Ein Schlüssel einer Schalterbuchung
öffnet online kein Verwaltungstoken. Gleichzeitige Absendungen mit demselben Schlüssel warten auf
die Trip-Sperre; die zweite findet den Schlüssel nach der Sperre und antwortet 200.

**Lesen für das Personal.** `GET companies/:companyId/trips/:tripId/counter-seat-map` zeigt alle
Sitze mit Kontingent, Zustand für die gewählte Teilstrecke, allen belegten Teilstrecken der Fahrt
und je freiem Sitz „wählbar für Frau/Mann" (reine Funktion `computeCounterSeatMap`); keine Namen,
Kontaktdaten oder Geschlechter anderer Fahrgäste. `POST …/counter/quote` rechnet Preis und prüft
Sitze ohne Sperre und ohne Schreiben. `GET …/bookings/:bookingId/ticket` liefert die Ticketseite mit
QR-Tokens für den Druck. Beide Lesepfade ohne Sperre übergehen Belegungen abgelaufener, noch nicht
freigegebener Buchungen. Storno über die vorhandene Aktion `POST …/bookings/:bookingId/cancel`.

**Rollen.** `ADMIN` und `AGENT` (wie Buchungen, ADR 0028); `DRIVER` nicht.

**Portal.** `/{locale}/counter` (Fahrt des Tages, Strecke, Teilstrecke, Sitzplan zum Antippen,
Fahrgäste, Kontakt, Preis, Verkaufen, danach Buchung mit Storno und Link zum Druck) und
`/{locale}/counter/tickets/{id}` (Druckansicht mit QR als SVG, Kopfzeile und Navigation nicht im
Druck). Ablauf in einem Hook (`use-counter.ts`), Darstellung in getrennten Komponenten, damit das
Design (Branch `william-design`) austauschbar bleibt. Der QR-Code entsteht im Browser mit `uqr`
(Kopie von `apps/web/src/lib/qr.ts`).

Keine Schemaänderung, keine Migration, kein neuer Fehlercode.

## Begründung

- Eine Transaktion ohne Hold schließt die Lücke, in der ein Sitz am Schalter wieder frei würde; die
  Trip-Sperre serialisiert Schalter und Online, wie zwei Online-Buchungen.
- Gemeinsame Bausteine statt eines zweiten Prüfpfads: Eine Regeländerung gilt in beiden Kanälen.
- Der Kanal in der Idempotenz-Prüfung verhindert, dass ein Schlüssel einen fremden Zugriff öffnet.

## Konsequenzen

- **Positiv:** Mit dem Schaltermodus verkauft die Firma alle Sitze in Masar; das Restrisiko aus
  ADR 0007 (Doppelverkauf außerhalb) entfällt, sobald der Schalter das Portal nutzt.
- **Negativ:** Ohne `payment`-Zeile (Phase 3) steht die Barzahlung nur an der Buchung; eine
  Kassenabrechnung je Person fehlt (Folgearbeit, Audit-Log hat die Person).
- **Negativ:** Ohne E-Mail bekommt der Fahrgast keine Bestätigung; der Ausdruck ist der Beleg.
- **Negativ:** Der QR-Helfer liegt doppelt (Web, Portal); beide Dateien gleich halten.

## Verworfene Alternativen

- **Hold, dann bar bestätigen (vorhandene Endpunkte):** drei Aufrufe, Hold-Frist und
  Telefonlimit am Schalter, Verwaltungstoken ohne Nutzen.
- **Übersteuerung der Geschlechtsregel durch das Personal:** bricht das Versprechen aus ADR 0006.
- **Eigener Prüfpfad im Schaltermodul:** doppelte Regeln, Gefahr des Auseinanderlaufens.

## Annahmen und Revisionsauslöser

- Annahme: Am Schalter wird bar bezahlt; Wallet am Schalter folgt mit Phase 3.
- Neu bewerten, wenn Firmen Gruppen über 9 Personen oder eine Kassenabrechnung brauchen.

## Verweise

- ADR 0005, 0006, 0007, 0016, 0017, 0020, 0022, 0026, 0028
- `apps/api/src/modules/bookings/counter.*`, `domain/counter.ts`, `domain/idempotency.ts`
- `docs/api-konventionen.md` (Abschnitt „Schalter"), `docs/domaenenmodell.md` (Umsetzung 2.6)

## Nachtrag 2026-11-04 (Prüfbefund F-IDEMP-01)

Der `Idempotency-Key` des Barverkaufs steht wie beim Gast-Hold nur als SHA-256 (hex) in
`booking.idempotency_key` (ADR 0020, Nachtrag 2026-11-04). Wiederholung und
`IDEMPOTENCY_KEY_REUSED` verhalten sich unverändert, auch zwischen Schalter und Online-Kanal.
Bestehende Zeilen werden nicht umgeschrieben. Alles andere bleibt bestehen.
