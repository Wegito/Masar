# ADR 0018: Invarianten über zusammengesetzte Fremdschlüssel und weitere EXCLUDE-Constraints

Status: Vorgeschlagen · Datum: 2026-11-02 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 1.1, Entscheidungen übertragen)

## Kontext

Das Domänenmodell verlangt für die Mandantentrennung zusammengesetzte Fremdschlüssel
`(trip_id, company_id)` auf `booking`, `ticket` und `payment` (Invarianten in
`docs/domaenenmodell.md`). Beim Umsetzen der Migration in Schritt 1.1 zeigte sich, dass dasselbe
Muster weitere Invarianten billig absichert, die sonst nur der Buchungsservice prüfen würde:

- Eine Belegung (`seat_occupation`) könnte eine andere Teilstrecke tragen als ihre Buchung. Dann
  prüfte das EXCLUDE-Constraint gegen falsche Werte.
- Ein Sitz eines fremden Sitzplans könnte ins Kontingent einer Fahrt geraten.
- `booking.from_seq` könnte von der Position des gewählten Einstiegshalts abweichen.
- Der Sitzplan einer Fahrt soll unveränderlich sein, sobald Belegungen existieren (ADR 0005).
- Tarife und Provisionssätze haben Gültigkeitszeiträume; zwei gleichzeitig gültige Einträge machen
  die Preisfindung mehrdeutig.

`payment` hat im Modell keine `trip_id`. Prisma verlangt für jeden referenzierten Spaltensatz einen
eindeutigen Index und kann `DEFERRABLE` sowie EXCLUDE-Constraints nicht ausdrücken (ADR 0004).

## Entscheidung

Die Datenbank erzwingt Zusammenhalt und Mandantentrennung über zusammengesetzte Fremdschlüssel auf
`@@unique`-Tupel des Elternteils. Zeiträume ohne Überlappung sichern EXCLUDE-Constraints.

- **Mandant:** `booking (trip_id, company_id) → trip`, `ticket (trip_id, company_id) → trip`,
  `payment (booking_id, company_id) → booking`, `refund (payment_id, company_id) → payment` und
  `(booking_id, company_id) → booking`, `trip (route_id | seat_layout_id, company_id)`,
  `route (cancellation_policy_id, company_id)`, `bus (seat_layout_id, company_id)`,
  `commission_statement_line (statement_id | booking_id, company_id)`.
- **Abweichung:** `payment` bekommt keine `trip_id`. Der Schlüssel `(booking_id, company_id)` bindet
  die Zahlung an die Firma der Buchung, und die Buchung ist über `(trip_id, company_id)` an die
  Firma der Fahrt gebunden. Das Ergebnis ist dasselbe ohne eine redundante Spalte.
- **Teilstrecke:** `booking (from_trip_stop_id, trip_id, from_seq) → trip_stop (id, trip_id, seq)`,
  ebenso für den Ausstieg. `seat_occupation (booking_id, trip_id, from_seq, to_seq) → booking` und
  `seat_occupation (booking_passenger_id, booking_id, seat_id) → booking_passenger`.
- **Sitzplan:** `trip_seat` trägt `seat_layout_id`; `trip_seat (trip_id, seat_layout_id) → trip` mit
  `ON UPDATE RESTRICT` und `trip_seat (seat_id, seat_layout_id) → seat (id, layout_id)`. Belegungen
  und Fahrgäste verweisen auf `trip_seat (trip_id, seat_id)`. Damit ist ein Sitzplanwechsel einer
  Fahrt unmöglich, sobald ein Kontingent existiert, und jeder belegte Sitz gehört zum Plan der Fahrt.
- **Bus:** `trip (bus_id, company_id, seat_layout_id) → bus`. Ein Bus passt immer zum Sitzplan der
  Fahrt (Busaustausch nur bei gleichem Layout, `docs/domaenenmodell.md`).
- **Zeiträume:** `fare_no_overlap` (je Haltestellenpaar) und `commission_rate_no_overlap` (je Firma)
  als `EXCLUDE USING gist (… daterange(valid_from, valid_until, '[)') WITH &&)`. `valid_until NULL`
  heißt unbefristet.
- **Historie:** Die Anwendungsrolle darf `booking`, `booking_passenger`, `ticket`, `payment`,
  `refund` und `payment_webhook_event` nicht löschen (`REVOKE DELETE`), analog zu `audit_log`.
- Die Symmetrie von `seat_neighbor` (beide Richtungen gespeichert) bleibt eine Regel des Generators
  und des Schreibpfads; ein Test prüft sie für die Seed-Daten.

## Begründung

- Ein Fremdschlüssel kostet einen Index und keine Anwendungslogik. Er greift für jeden Schreibpfad,
  auch für Admin-Skripte und den späteren Schaltermodus, genau wie das EXCLUDE-Constraint (ADR 0005).
- Die Teilstrecke der Belegung ist die Eingabe des wichtigsten Constraints. Weicht sie von der
  Buchung ab, schützt das Constraint das Falsche.
- Der eingefrorene Sitzplan folgt aus den Daten selbst, ohne Trigger.

## Konsequenzen

- **Positiv:** Mandantentrennung, Teilstrecken und Sitzplanbindung sind in der Datenbank erzwungen;
  Tests prüfen sie an der Anwendung vorbei.
- **Negativ:** Zusätzliche eindeutige Indizes auf `trip`, `booking`, `booking_passenger`,
  `route_stop`, `seat`, `bus`, `payment` (je Zeile wenige Bytes, bei rund 45 Sitzen je Fahrt
  unkritisch).
- **Negativ:** Prisma bildet die Rückrelationen von `booking_passenger` zu `seat_occupation` und
  `ticket` als Listen ab, obwohl je höchstens eine Zeile existiert (Unique auf
  `booking_passenger_id`), weil Prisma 1:1 nur über eindeutige Felder auf der definierenden Seite
  zulässt.
- **Negativ:** `trip_seat.seat_layout_id` ist redundant zu `trip.seat_layout_id`; der Fremdschlüssel
  hält beide gleich.
- **Folgearbeit:** Der Buchungsservice (Schritt 1.3) setzt `seat_layout_id`, `from_seq` und `to_seq`
  aus frisch gelesenen Daten und bildet `23503` auf einen fachlichen Fehler ab (meist
  `INVALID_SEGMENT` oder `SEAT_UNKNOWN`).
- **Folgearbeit:** Prüfen, ob `prisma migrate diff` die handgeschriebenen EXCLUDE- und
  CHECK-Constraints toleriert (ADR 0004, Folgearbeit 4); Ergebnis als Nachtrag festhalten.

## Verworfene Alternativen

- **Nur `(trip_id, company_id)` wie im Domänenmodell:** schützt die Mandantentrennung, lässt aber
  Teilstrecke und Sitzplan der Anwendung.
- **Trigger statt Fremdschlüssel:** mächtiger (etwa für die Symmetrie der Nachbarpaare), aber
  unsichtbar für Prisma und schwerer zu testen und zu reviewen.
- **`trip_id` auf `payment`:** redundant, siehe Abweichung oben.

## Annahmen und Revisionsauslöser

- Annahme (unbestätigt): Prisma 7.10 entfernt die handgeschriebenen Constraints bei späteren
  Migrationen nicht. Neu bewerten, falls `db:check` sie als Abweichung meldet.
- Neu bewerten, wenn Fahrgäste einer Buchung verschiedene Teilstrecken brauchen (ADR 0005) oder ein
  Busaustausch mit anderem Layout nötig wird.

## Verweise

- ADR 0004, 0005, 0006, 0007, 0011, 0016, 0017
- `docs/domaenenmodell.md` (Abschnitt „Umsetzung 1.1")
- `apps/api/prisma/migrations/20261102040000_katalog_flotte_fahrten_buchung/migration.sql`
- `apps/api/test/inventory.e2e.test.ts`
