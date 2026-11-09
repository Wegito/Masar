# ADR 0028: Buchungen im Portal: Liste mit enger Suche, maskiertes Telefon mit Audit, Fahrgastliste für Fahrer

Status: Angenommen · Datum: 2026-11-04 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 2.5, Entscheidungen übertragen)

## Kontext

Schritt 2.5 der Roadmap verlangt im Portal eine Liste der Buchungen einer Firma mit Filtern, ein
Detail mit Fahrgästen, Zahlungsstand, Frist und Verlauf sowie eine Fahrgastliste je Fahrt für
Fahrer und Schalter. Vorhanden waren (Stand 2.4):

- Suche über den vollständigen Code, „Barzahlung bestätigen" und Storno für `ADMIN` und `AGENT`
  (`companies/:companyId/bookings/lookup`, `confirm-cash`, `cancel`). Sie lieferten die
  Buchungssicht des Gasts (`BookingView`) mit der Telefonnummer im Klartext und den letzten vier
  Ziffern der Ausweisnummer (`nationalIdLast4`).
- Ein Audit-Log je Buchung mit allen Statuswechseln (`BOOKING_HELD`, `BOOKING_RESERVED_CASH`,
  `BOOKING_CONFIRMED_CASH`, `BOOKING_CANCELLED_BY_*`, `BOOKING_EXPIRED`), Daten nur als IDs und
  Status.
- Keine `payment`-Zeilen: Die Barzahlung bestätigt das Personal direkt an der Buchung
  (`confirmed_at`), Wallet und ecash folgen mit Phase 3 (ADR 0008).
- Kein Fahrer → Fahrt: Ein Fahrer ist Mitglied einer Firma mit der Rolle `DRIVER`, mehr nicht.
- Die Regel „Personenbezogene Daten nie in URLs" mit der einen Ausnahme aus ADR 0019. Der
  HTTP-Logger der API schreibt nur den Pfad, nie die Query (`apps/api/src/common/logging.ts`).

Der Auftrag nannte `GET companies/:companyId/bookings` mit einer Freitext-Suche „nur auf
Buchungscode und die letzten Ziffern der Telefonnummer", ausdrücklich ohne Volltext auf Namen und
Ausweisnummern, und Telefonnummern im Portal maskiert mit „anzeigen" per Klick und Audit-Eintrag.

## Entscheidung

Die Liste ist ein `GET` mit Keyset-Cursor; der Suchtext ist eng (Code-Anfang oder Telefon-Ende)
und steht als zweite dokumentierte Ausnahme der URL-Regel in der Query. Alle Antworten an das
Personal zeigen das Telefon maskiert und die Ausweisnummer nur als „vorhanden"; Klartext gibt es
einzeln über einen `POST` mit Audit-Eintrag. Die Fahrgastliste sehen auch Fahrer, ohne
Kontaktdaten und Codes.

- **Endpunkte:** `GET companies/:companyId/bookings` (Liste), `GET …/bookings/:bookingId`
  (Detail), `POST …/bookings/:bookingId/reveal-contact` (Telefon und E-Mail), dazu
  `GET companies/:companyId/trips/:tripId/passengers` im Buchungsmodul (liest Buchungsdaten).
  `lookup`, `confirm-cash` und `cancel` antworten jetzt mit dem Detail statt mit `BookingView`.
  Lesen und Aktionen `ADMIN` und `AGENT`, die Fahrgastliste zusätzlich `DRIVER`. Eine Buchung oder
  Fahrt einer anderen Firma ist `BOOKING_NOT_FOUND` bzw. `TRIP_NOT_FOUND`; jede Abfrage nennt die
  Firma aus dem geprüften Pfad in der Bedingung.
- **Sortierung und Cursor:** nach der Abfahrt der Fahrt am Starthalt, dann Buchungs-ID; der Cursor
  ist der Schlüssel des letzten Eintrags (base64url, Präfix `b`, opak), `limit` 1 bis 200,
  Standard 50. Ohne Fahrt, Tag und Suchtext zeigt die Liste die Abfahrten ab heute (Damaskus); mit
  Fahrt oder Suchtext ist der Zeitraum offen, damit auch eine vergangene Buchung zu finden ist.
- **Filter:** Fahrt, Tage `from`/`to` in Damaskus (Abfahrt am Starthalt), Status, Zahlweg, Kanal.
  Der Status ist der für das Personal sichtbare: Ein Hold oder eine Reservierung nach Fristende ist
  `EXPIRED`, auch bevor der Ablauf-Job sie freigibt (dieselbe Bedingung wie `expiredCondition`).
- **Suchtext `q`:** höchstens 32 Zeichen. Nach Bereinigung wie beim Buchungscode (Leerraum,
  Bindestriche, Richtungszeichen, arabische Ziffern, Crockford I/L → 1, O → 0) ist er der Anfang
  eines Codes (4 bis 8 Zeichen) und/oder, wenn er nur aus Ziffern besteht, das Ende der
  Telefonnummer (3 bis 9 Ziffern, eine ganze Nummer zählt mit ihren letzten neun). Alles andere,
  etwa ein Name, ergibt `BOOKING_SEARCH_INVALID` (400, neu). Namen und Ausweisnummern sind nicht
  durchsuchbar.
- **Ausnahme der URL-Regel:** `q` steht in der Query eines `GET`. Die API loggt nur den Pfad (Test
  in `company-bookings-logging.e2e.test.ts`), der Reverse-Proxy muss ebenso eingerichtet werden
  (wie ADR 0019), und das Portal hält `q` nur im Zustand der Seite, nie in deren Adresse. Der
  vollständige Code ohne weitere Filter geht weiter per `POST lookup`.
- **Maskierung:** `maskPhone` in `@masar/shared`: Ländervorwahl, erste und letzte drei Ziffern
  der nationalen Nummer, sonst `*` (`+963 9** *** 456`). Die E-Mail erscheint nur als
  `hasEmail`. Die Ausweisnummer erscheint als `nationalIdPresent`, auch nicht mehr ihre letzten
  vier Ziffern; die Gastsicht (`BookingView`) bleibt unverändert.
- **Kontakt anzeigen:** `POST reveal-contact` liefert `{ phone, email }` und schreibt vorher
  `BOOKING_CONTACT_REVEALED` ins Audit-Log (Person, Firma, Buchung als IDs, `data.fields`). Ein
  `POST`, weil der Aufruf eine Nebenwirkung hat und die Antwort nicht in Caches gehört. Begrenzt
  auf 30 je Minute. Der Verlauf im Detail zeigt diese Einträge mit.
- **Zahlungsstand:** reine Funktion `paymentStateOf` aus Status, `confirmed_at` und den Status der
  `payment`-Zeilen: `UNPAID` (Hold), `CASH_DUE` (Barreservierung), `IN_REVIEW` (Prüfung),
  `PAID` (bestätigt oder Zahlung erfolgreich; bleibt nach Storno einer bezahlten Buchung),
  `NONE` (storniert oder abgelaufen ohne Zahlung). Ohne `payment`-Zeilen folgt der Stand allein
  aus der Buchung.
- **Verlauf:** Einträge des Audit-Logs zur Buchung (nur dieser Firma), ältester zuerst, als
  Aktion, Zeit, Art der Person (`USER`, `GUEST`, `SYSTEM`), ID nur bei Personal, Status vorher und
  nachher, Grund-Code. Keine Rohdaten aus `data`.
- **Fahrgastliste:** aktive Fahrgäste aktiver, nicht abgelaufener Buchungen, nach Sitz (Reihe,
  Spalte) und Einstieg, mit Name, Geschlecht, Zustieg, Ausstieg, Buchungsstatus, Zahlungsstand,
  Ticketstatus und `nationalIdPresent`, dazu Zählung je Halt. Ohne Telefon, E-Mail und
  Buchungscode. Nicht paginiert (ein Bus). Ein Fahrer sieht die Listen aller Fahrten seiner Firma.
- **Nur lesen:** Liste, Detail und Fahrgastliste lesen ohne Sperre (Read Committed). Die Aktionen
  laufen unverändert über den `BookingsService` unter der Trip-Sperre; neue Schreibpfade auf
  `seat_occupation` gibt es nicht. Keine Schemaänderung, keine Migration.

## Begründung

- **`GET` mit Query statt `POST search`:** Der Auftrag nannte `GET`; eine Liste mit Filtern ist
  ein Lesezugriff, bleibt ohne CSRF-Sonderfall und lässt sich mit denselben Parametern blättern.
  Der Suchtext ist ein Bruchstück (Code-Anfang oder Telefon-Ende) einer angemeldeten Person des
  Personals; mit Logger ohne Query und Seitenzustand statt Seitenadresse bleibt er wie das
  Geschlecht in ADR 0019 außerhalb von Logs, Historie und geteilten Links.
- **Enge Suche:** Eine Namenssuche würde das Portal zum Personenregister machen (ADR 0016,
  Datenminimierung) und Namen in Suchfelder und damit früher oder später in Logs bringen. Code und
  Telefon-Ende reichen am Schalter: Der Fahrgast nennt einen davon.
- **Maskierung überall:** Wenn nur die neue Liste maskiert, die Codesuche aber den Klartext
  lieferte, wäre die Maskierung nur Optik. Deshalb antworten auch `lookup`, `confirm-cash` und
  `cancel` maskiert; der Klartext ist ein bewusster, protokollierter Schritt.
- **Keine letzten Ziffern der Ausweisnummer:** Das Personal vergleicht beim Einsteigen den Namen
  mit dem Ausweis (ADR 0022); die letzten Ziffern braucht es dafür nicht. „Vorhanden" sagt, ob die
  Firma die Nummer im Bedarfsfall entschlüsseln lassen kann.
- **Zahlungsstand abgeleitet:** Solange es keine `payment`-Zeilen gibt, wäre eine eigene Spalte
  doppelt geführt. Die Funktion berücksichtigt die Zeilen schon, damit Phase 3 nichts am Portal
  ändern muss.
- **Fahrer ohne Zuordnung:** Eine Tabelle Fahrer → Fahrt wäre eine Schemaänderung und gehört zum
  Fahrer-Check-in (Phase 4). Bis dahin ist die Firma die Grenze, wie bei Flotte und Fahrten.

## Konsequenzen

- **Positiv:** Das Personal findet Buchungen über Tag, Status, Zahlweg, Kanal, Code-Anfang oder
  Telefon-Ende und sieht Zahlungsstand und Verlauf; Fahrer bekommen eine Fahrgastliste nach Sitz.
- **Positiv:** Jeder Blick auf eine Telefonnummer im Klartext ist im Audit-Log nachvollziehbar.
- **Negativ:** `lookup`, `confirm-cash` und `cancel` haben ein neues Antwortformat (Feld
  `contact.phone` entfällt, `nationalIdLast4` wird `nationalIdPresent`). Einziger Verbraucher ist
  das Portal, das im selben Schritt angepasst ist.
- **Negativ:** Die Suche nach dem Telefon-Ende (`LIKE '%…'`) und die Sortierung über die Abfahrt
  der Fahrt nutzen keinen eigenen Index; die Firma steht immer in der Bedingung. Für eine Firma im
  Pilot unkritisch (Annahme, nicht gemessen).
- **Negativ:** Ein Fahrer sieht Namen und Geschlecht aller Fahrgäste seiner Firma, nicht nur
  seiner Fahrten.
- **Folgearbeit:** Reverse-Proxy ohne Query loggen (mit ADR 0014 und 0019). Zuordnung Fahrer →
  Fahrt mit dem Check-in (Phase 4). Erstattungsstand im Zahlungsstand, sobald es Erstattungen gibt
  (Phase 3). Ein Index für die Liste, wenn eine Firma viele Buchungen hat.

## Verworfene Alternativen

- **`POST companies/:companyId/bookings/search` mit Body:** hält den Suchtext aus jeder URL, ist
  aber kein `GET` mehr, wie der Auftrag es nannte, und verdoppelt die Liste für die Filter ohne
  Suchtext. Bleibt die Option, falls der Reverse-Proxy die Query nicht verlässlich weglässt.
- **Volltextsuche über Namen:** siehe Begründung (Datenminimierung).
- **Maskierung nur im Portal:** Die API hätte den Klartext weiter an jeden Browser geliefert.
- **Fahrgastliste nur für Admin und Agent:** Fahrer brauchen sie beim Einsteigen; Kontaktdaten und
  Codes fehlen in ihr ohnehin.

## Annahmen und Revisionsauslöser

- Annahme (unbestätigt): Am Schalter nennt der Fahrgast den Code oder seine Telefonnummer; eine
  Namenssuche wird nicht vermisst. Mit der ersten Partnerfirma prüfen.
- Annahme (unbestätigt): Die Maskierung mit erster und letzter drei Ziffern reicht dem Personal zum
  Wiedererkennen am Telefon.
- Neu bewerten, wenn ein Reverse-Proxy oder Monitoring-Werkzeug Query-Strings speichert, wenn
  Fahrer Fahrten zugeordnet werden oder wenn Zahlungen und Erstattungen entstehen.

## Verweise

- ADR 0006, 0008, 0009, 0012, 0013, 0014, 0016, 0019, 0020, 0022, 0025, 0027
- `docs/api-konventionen.md` (Abschnitt „Buchungen im Portal"), `docs/domaenenmodell.md`
  (Umsetzung 2.5)
- `apps/api/src/modules/bookings/` (`company-bookings.*`, `trip-passengers.controller.ts`,
  `domain/booking-list.ts`, `domain/payment-state.ts`), `apps/api/test/company-bookings*.e2e.test.ts`,
  `apps/portal/src/app/[locale]/(app)/bookings/`,
  `apps/portal/src/app/[locale]/(app)/trips/[tripId]/passengers/`,
  `e2e/tests/bookings-list.portal.spec.ts`
