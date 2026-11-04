# ADR 0027: Fahrtplanung: Wochenplan idempotent über Sperren, Tariflücken ablehnen, Absage über den Buchungsservice

Status: Angenommen · Datum: 2026-11-04 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 2.4, Entscheidungen übertragen)

## Kontext

Schritt 2.4 der Roadmap verlangt, dass eine Firma eine Woche Fahrten im Portal plant, mit einem
Kontingent online/Schalter (ADR 0007), und eine Fahrt absagen kann. Vorhanden waren:

- Das Schema aus Schritt 1.1: `trip` (Status `DRAFT`, `SCHEDULED`, `DEPARTED`, `COMPLETED`,
  `CANCELLED`, `online_sales_close_at`, `cash_deadline_at`, `gender_rule_enabled` als Kopie),
  `trip_stop` (Kopie der Strecke, Zeiten je Halt), `trip_seat (online_sellable, blocked)` ohne
  Standardwert und die zusammengesetzten Fremdschlüssel aus ADR 0018.
- Die reine Funktion `expandSchedule` (Wochentage, Abfahrtszeit in Damaskus, Dauer, höchstens
  62 Tage) in `modules/trips/domain/trip-schedule.ts`.
- Der Buchungskern (Schritt 1.3) mit Trip-Sperre, Freigabe abgelaufener Buchungen und Storno durch
  die Firma je Buchung. Zahlungen (`payment`, `refund`) entstehen erst mit Phase 3.
- Folgearbeit aus ADR 0024 (archivierte Sitzpläne und deaktivierte Busse ablehnen) und ADR 0026
  (archivierte Strecken ablehnen, Strecke sperren, bei fehlendem Tarifstand warnen).

Das Schema hat keine Eindeutigkeit, die eine doppelte Fahrt verhindert, und keine Regel gegen einen
Bus, der zur selben Zeit zwei Fahrten fährt.

## Entscheidung

Keine Schemaänderung. Ein Wochenplan wird in einer Transaktion unter Sperren veröffentlicht; die
Eindeutigkeit „dieselbe Fahrt" prüft die Anwendung unter diesen Sperren. Tariflücken und
Busüberschneidungen zeigt die Vorschau an und die Veröffentlichung lehnt sie ab. Die Absage
storniert Buchungen über den Buchungsservice.

- **Endpunkte:** `companies/:companyId/trips` (Liste, Einzelabruf), `trips/schedule/preview`,
  `trips/schedule`, `trips/:tripId/cancel`, `trips/:tripId/quota` in einem eigenen Controller im
  Modul `trips`; die öffentlichen Routen bleiben unverändert. Lesen alle Firmenrollen, Schreiben
  (auch die Vorschau) nur `ADMIN`, wie Flotte und Strecken.
- **Eine Rechnung:** Vorschau und Veröffentlichung rufen dieselbe Auswertung auf (`evaluate` im
  Service, reine Funktionen in `modules/trips/domain/trip-planning.ts`); die Vorschau ohne Sperren
  und ohne zu schreiben. Das Portal rechnet keine Termine selbst.
- **Idempotenz über Eindeutigkeit unter Sperre:** Dieselbe Fahrt heißt dieselbe Strecke, dieselbe
  Abfahrt und derselbe Bus (mit Bus) bzw. ohne Bus derselbe Sitzplan, in jedem Status. Solche
  Termine werden übersprungen (`EXISTS`), auch abgesagte; ein zweiter Aufruf erzeugt nichts und
  holt keine abgesagte Fahrt zurück. Kein `Idempotency-Key`: Der Plan selbst ist der Schlüssel, und
  ein längerer Zeitraum ergänzt nur die neuen Tage.
- **Sperren:** Strecke `FOR UPDATE` (serialisiert Veröffentlichungen derselben Strecke und hält ein
  gleichzeitiges Archivieren auf), Bus `FOR UPDATE` (serialisiert die Belegung eines Busses über
  Strecken hinweg und hält Deaktivieren und Planwechsel auf), Sitzplan `FOR SHARE` (ein
  gleichzeitiges Archivieren wartet). Reihenfolge immer Strecke → Bus → Sitzplan; danach frisch
  lesen. Alle Fahrten samt Halten und Kontingent in einer Transaktion.
- **Ablehnen:** archivierte Strecke (`ROUTE_ARCHIVED`), deaktivierter Bus (`BUS_INACTIVE`, neu),
  archivierter Sitzplan auch über den Bus (`SEAT_LAYOUT_RETIRED`), Bus in überlappender Zeit
  (`BUS_DOUBLE_BOOKED`, neu; Zeiträume halboffen, gestrichene Fahrten zählen nicht, auch
  Überschneidungen innerhalb desselben Plans), Fahrtag ohne vollständige Tarifmatrix
  (`FARE_MISSING_FOR_DATE`, neu), Beginn vor heute oder vergangene Abfahrt
  (`TRIP_SCHEDULE_IN_PAST`, neu), unpassende Halt-Zeiten (`TRIP_STOP_OFFSETS_INVALID`, neu), mehr
  Online-Sitze als verkaufbare (`TRIP_QUOTA_INVALID`, neu).
- **Tariflücken: ablehnen statt warnen.** Die Vorschau markiert betroffene Tage (`fareMissing`),
  die Veröffentlichung lehnt den ganzen Plan ab. Das erfüllt die Folgearbeit aus ADR 0026 („warnen")
  in der Vorschau und verhindert Fahrten, deren Teilstrecken still aus der Suche fallen.
- **Zeiten der Halte:** Abfahrt am Start, Ankunft am Ziel aus `expandSchedule`. Zwischenhalte
  gleichmäßig über die Fahrzeit verteilt (auf ganze Minuten gerundet) oder per optionalem
  `stopOffsetsMinutes` (Minuten ab Abfahrt, streng steigend, innerhalb der Fahrzeit). Ankunft
  gleich Abfahrt, keine Standzeit.
- **Kontingent:** Ohne Angabe sind alle verkaufbaren Sitze online. Mit `onlineSeatCount` sind die
  ersten n verkaufbaren Sitze von vorn nach hinten (Reihe, dann Spalte) online, der Rest gehört dem
  Schalter. `blocked` bleibt beim Anlegen `false`. Ändern je Sitz über `PUT quota` unter der
  Trip-Sperre, nur für Fahrten im Verkauf und nie für belegte Sitze (`TRIP_SEAT_OCCUPIED`, neu).
- **Weitere Fahrtwerte:** Status direkt `SCHEDULED` (veröffentlicht heißt buchbar; `DRAFT` bleibt
  ungenutzt). `gender_rule_enabled` und Verkaufsschluss (Minuten vor Abfahrt) aus dem Body, sonst
  aus den Firmeneinstellungen. `cash_deadline_at` bleibt leer; es gilt `cash_deadline_minutes` der
  Firma (Umsetzung 1.3).
- **Absage:** Trip-Zeile sperren und abgelaufene Holds freigeben über den Buchungsservice
  (`lockTripForPlanning`), Status `SCHEDULED` → `CANCELLED` (Automat aus Schritt 1.3; sonst
  `INVALID_STATE_TRANSITION`, Wiederholung No-op), dann alle aktiven Buchungen nach ID gesperrt
  stornieren (`cancelBookingsOfCancelledTrip`): Belegung löschen, Tickets `VOID`, Fahrgäste
  `CANCELLED`, `cancelled_by = COMPANY`, Grund `TRIP_CANCELLED`, keine Gebühr, Audit und Outbox
  (Storno-E-Mail) je Buchung. Sperr-Reihenfolge Trip → Booking; Zahlungen gibt es noch nicht.
- **Audit:** `TRIP_SCHEDULE_PUBLISHED` (an der Strecke, mit Zahlen, Zeitraum und Fahrt-IDs),
  `TRIP_CANCELLED`, `TRIP_QUOTA_CHANGED`, jeweils nur IDs, Zahlen und Status.

## Begründung

- **Sperren statt Unique-Index:** Eine Eindeutigkeit „Strecke, Abfahrt, Bus oder Plan" ließe sich
  nur mit `NULLS NOT DISTINCT` oder zwei partiellen Indizes ausdrücken, die Prisma nicht abbildet,
  und eine Migration auf bestehende Entwicklungsdaten wäre riskant. Alle Fahrten entstehen über
  diesen einen Pfad (und den idempotenten Seed); die Sperre der Strecke serialisiert ihn
  vollständig. Ein Nebenläufigkeitstest mit echten Verbindungen hält das fest.
- **Bus-Doppelbelegung in der Anwendung:** Ein EXCLUDE-Constraint auf `trip` wäre die stärkere
  Linie, braucht aber eine Migration mit Bedingung auf den Status und schlüge auf vorhandenen
  Daten fehl, falls dort schon Überschneidungen stehen. Die Sperre der Bus-Zeile serialisiert alle
  Planungen eines Busses.
- **Abgesagte Termine überspringen:** Wer eine Woche erneut veröffentlicht, will keine bewusst
  abgesagte Fahrt zurück. Eine neue Fahrt zur selben Zeit bleibt mit einem anderen Bus möglich.
- **Ablehnen bei Tariflücken:** Eine veröffentlichte Fahrt ohne Tarif für eine Teilstrecke wird
  für diese Teilstrecke nie gefunden, ohne dass es jemand merkt. Die Vorschau zeigt das vorher;
  die Firma legt zuerst den Tarifstand an.
- **Absage im Buchungsservice:** AGENTS.md verlangt, dass jeder Schreibzugriff auf
  `seat_occupation` über den Buchungsservice unter der Trip-Sperre läuft. Die Fahrtplanung ruft
  ihn in ihrer Transaktion auf, statt Belegungen selbst zu löschen.
- **Kontingent von vorn:** Schalterverkauf am Busbahnhof füllt üblicherweise die hinteren Reihen
  (wie im Seed); eine Zahl statt einer Sitzliste hält das Formular einfach. Feinere Wahl je Sitz
  bietet `PUT quota`.

## Konsequenzen

- **Positiv:** Eine Firma plant eine Woche Fahrten selbst; die Fahrten erscheinen sofort in der
  Suche der Fahrgast-App.
- **Positiv:** Doppelte Veröffentlichungen, gleichzeitige Planungen desselben Busses und
  Buchungen während einer Absage sind unter Sperre korrekt (vier Nebenläufigkeitstests).
- **Negativ:** Die Eindeutigkeit der Fahrt und die Bus-Doppelbelegung schützt nur die Anwendung,
  nicht die Datenbank. Ein Skript an der API vorbei kann Dubletten anlegen.
- **Negativ:** Veröffentlichungen derselben Strecke laufen nacheinander; eine Veröffentlichung schreibt
  höchstens 62 Fahrten mit drei Massen-Inserts (Annahme, nicht gemessen: deutlich unter einer
  Sekunde), Wartezeiten sind damit unkritisch.
- **Negativ:** Keine Standzeit an Zwischenhalten; Firmen mit Pausen tragen eigene Minuten ein (API)
  oder leben mit gleichmäßig verteilten Zeiten (Portal).
- **Lücke (bis Phase 3):** Die Absage legt keine Erstattungen an, weil es noch keine
  `payment`-Zeilen gibt. Mit den Zahlungen muss `cancelBookingsOfCancelledTrip` je bestätigter
  Online-Zahlung eine Erstattung anlegen (Sperr-Reihenfolge Trip → Booking → Payment).
- **Folgearbeit:** Bus einer geplanten Fahrt tauschen (gleicher Plan, ADR 0024), Fahrt ohne Bus
  nachträglich einem Bus zuordnen, Status `DEPARTED`/`COMPLETED` setzen (Phase 4), Kontingent im
  Portal bearbeiten und Sitze sperren (`blocked`), eigene Halt-Zeiten im Portal.

## Verworfene Alternativen

- **`Idempotency-Key` wie bei Buchungen:** schützt nur gegen die Wiederholung derselben Anfrage,
  nicht gegen zwei Personen, die denselben Plan veröffentlichen, und bräuchte eine Tabelle.
- **Unique-Index bzw. EXCLUDE-Constraint auf `trip`:** siehe Begründung; bleibt eine Option, wenn
  ein zweiter Schreibpfad (Import, Schaltermodus) Fahrten anlegt.
- **Tariflücken nur warnen und trotzdem veröffentlichen:** stille Nicht-Verkäufe.
- **Fahrten als `DRAFT` anlegen und einzeln freigeben:** zusätzlicher Schritt ohne Gewinn, solange
  die Vorschau vor dem Veröffentlichen alles zeigt.
- **Abgesagte Termine beim erneuten Veröffentlichen neu anlegen:** holt bewusst abgesagte Fahrten
  zurück.

## Annahmen und Revisionsauslöser

- Annahme (unbestätigt): Firmen verkaufen am Schalter die hinteren Reihen. Mit der ersten
  Partnerfirma prüfen.
- Annahme (unbestätigt): Standzeiten an Zwischenhalten sind kurz genug, um sie zu vernachlässigen.
- Neu bewerten, sobald ein zweiter Schreibpfad Fahrten anlegt (dann Datenbank-Constraint) oder
  Zahlungen existieren (Erstattung bei Absage).

## Verweise

- ADR 0004, 0005, 0006, 0007, 0012, 0018, 0024, 0026
- `docs/domaenenmodell.md` (Umsetzung 2.4), `docs/api-konventionen.md` (Abschnitt Fahrtplanung)
- `apps/api/src/modules/trips/`, `apps/api/test/company-trips.e2e.test.ts`,
  `apps/portal/src/app/[locale]/(app)/trips/`, `e2e/tests/trips.portal.spec.ts`
