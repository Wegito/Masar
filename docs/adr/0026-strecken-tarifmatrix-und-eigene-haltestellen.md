# ADR 0026: Strecken mit eingefrorenen Halten, vollständige monotone Tarifmatrix, eigene Haltestellen

Status: Angenommen · Datum: 2026-11-04 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 2.3, Entscheidungen übertragen)

## Kontext

Schritt 2.3 der Roadmap verlangt, dass eine Firma Strecken, Haltestellen und Tarife je Teilstrecke
im Portal pflegt. Das Schema aus Schritt 1.1 hat dafür bereits alle Tabellen:

- `city` und `station` (plattformweit; `station.owner_company_id` optional, „ohne Besitzerfirma
  gehört sie allen", Domänenmodell).
- `route` (Firma, Namen ar/en, `is_active`, Pflichtverweis auf `cancellation_policy` über
  `(cancellation_policy_id, company_id)`), `route_stop (route_id, station_id, seq)` mit eindeutigem
  `seq` und eindeutiger Haltestelle je Route.
- `fare (route_id, from_route_stop_id, to_route_stop_id, amount_minor, currency, valid_from,
valid_until)` mit dem EXCLUDE-Constraint `fare_no_overlap` (je Haltestellenpaar höchstens ein
  Tarif pro Fahrtag) und `amount_minor >= 0`.
- `cancellation_policy` mit Stufen `cancellation_policy_rule (min_minutes_before_departure,
fee_bps)`.

Festgelegt war: `trip_stop` ist eine Kopie der Route beim Anlegen der Fahrt (Domänenmodell), und
`trip_stop → route_stop` hat `ON DELETE RESTRICT`. Ohne gültigen Tarif ist eine Teilstrecke nicht
buchbar (`NO_FARE_FOR_SEGMENT`). Eine Buchung friert ihren Preis ein (`booking.fare_amount_minor`),
storniert aber nach der Stornoregel, auf die die Route **heute** zeigt
(`BookingsRepository.cancellationPolicy`). Es gibt noch keine Oberfläche, mit der die Plattform
Haltestellen anlegt.

## Entscheidung

Keine Schemaänderung. Ein neues Modul `routes` pflegt Strecken, Tarife, Stornoregeln und den
Haltestellen-Katalog einer Firma unter `/companies/:companyId/`. Halte und Stornoregel einer Strecke
frieren ein, sobald eine Fahrt sie nutzt; Preise ändern sich über Tarifstände ab einem Tag.

- **Haltestellen:** Städte und öffentliche Haltestellen (ohne Besitzerfirma) pflegt die Plattform;
  die Firma liest sie. Eine Firma darf **eigene** Haltestellen in bestehenden Städten anlegen
  (`owner_company_id` = Firma, z. B. Büro, Garage, eigener Halteplatz). Nur sie sieht und nutzt
  sie. Eine Strecke darf nur öffentliche und eigene Haltestellen enthalten; eine fremde gilt als
  unbekannt (`STATION_NOT_FOUND`). Städte legt nur die Plattform an.
- **Strecke anlegen:** Namen ar/en, Stornoregel der Firma, 2 bis 15 Haltestellen in Fahrtrichtung,
  jede höchstens einmal (`ROUTE_STOP_DUPLICATE`), und eine vollständige Tarifmatrix. Alles in einer
  Transaktion; die Tarife gelten ab heute (Kalendertag in Damaskus) unbefristet.
- **Tarifmatrix:** Für n Halte genau n·(n−1)/2 Preise, einer je Paar (i, j) mit i < j. Betrag ganz,
  größer 0, höchstens 10⁹ Minor-Units; eine Währung je Stand (`SYP`, `USD`, `EUR`, Standard `SYP`).
  Fehlende Paare sind `FARE_MATRIX_INCOMPLETE`, Paare gegen die Fahrtrichtung, außerhalb der
  Strecke oder doppelt `FARE_MATRIX_INVALID`.
- **Monotonie:** Eine Teilstrecke kostet nie weniger als eine in ihr enthaltene (`FARE_NOT_MONOTONIC`,
  mit beiden Paaren in `params`). Gleich teuer ist erlaubt. Geprüft wird jede Teilstrecke gegen die
  beiden um einen Halt kürzeren; über die Kette gilt die Regel für alle enthaltenen.
- **Ändern:** Namen jederzeit. Halte (`PUT routes/:id/stops`, ersetzt Halte und Tarife) und
  Stornoregel (`PATCH`) nur, solange **keine Fahrt** die Strecke nutzt, egal in welchem Status
  (`ROUTE_IN_USE`). Danach ist der Weg eine neue Strecke; eine Versionsreihe wie bei Sitzplänen gibt
  es für Strecken nicht.
- **Tarifstände:** `PUT routes/:id/fares` legt eine vollständige Matrix ab `validFrom` an (Standard
  heute, nie in der Vergangenheit: `FARE_VALID_FROM_PAST`), auch für genutzte Strecken. Stände, die
  vorher beginnen, enden an `validFrom`; Stände ab `validFrom` werden ersetzt. Gebuchte Preise
  bleiben, weil die Buchung ihren Preis kopiert.
- **Archivieren:** `is_active = false`, in der API `status: ARCHIVED`. Endgültig im MVP, keine
  Änderung mehr (`ROUTE_ARCHIVED`). Bestehende Fahrten bleiben buchbar (die Suche prüft
  `is_active` nicht).
- **Stornoregeln:** anlegen und lesen, danach unveränderlich. Jede Schwelle höchstens einmal, und
  je näher die Abfahrt, desto höher oder gleich die Gebühr (`CANCELLATION_RULES_INVALID`). Das
  Portal schlägt eine Standardregel vor (ab 24 h kostenlos, ab 2 h 25 %, danach 50 %, wie der Seed).
- **Sperren:** Jede Änderung sperrt die Strecken-Zeile `FOR UPDATE` und zählt danach die Fahrten.
  Eine gleichzeitig angelegte Fahrt hält über `trip (route_id, company_id) → route`
  `FOR KEY SHARE`; die Sperre wartet auf sie und sieht sie danach. Zwei gleichzeitige Tarifstände
  derselben Strecke laufen nacheinander.
- **Rollen:** Lesen alle Firmenrollen, Schreiben nur `ADMIN` (wie die Flotte, ADR 0024).
- **Audit:** `ROUTE_CREATED`, `ROUTE_UPDATED`, `ROUTE_STOPS_REPLACED`, `ROUTE_FARES_SET`,
  `ROUTE_ARCHIVED`, `STATION_CREATED`, `CANCELLATION_POLICY_CREATED`, nur mit IDs, Zahlen, Datum und
  Währung.

## Begründung

- **Eingefrorene Halte:** Fahrten kopieren die Halte und verweisen mit `RESTRICT` auf sie;
  Buchungen hängen an den Positionen. Ein Halt, der nachträglich wandert, verschöbe Teilstrecken
  bestehender Buchungen. Die Regel folgt aus den Daten (Fahrten zählen unter Sperre), nicht aus
  einem Statusfeld.
- **Eingefrorene Stornoregel:** Buchungen stornieren nach der aktuellen Regel ihrer Strecke. Ein
  Wechsel änderte rückwirkend die Bedingungen verkaufter Tickets. Dasselbe gilt für das Ändern
  einer Regel; deshalb sind Regeln unveränderlich.
- **Vollständige Matrix:** Eine Lücke heißt, dass eine Teilstrecke einer Fahrt nicht verkauft
  wird, ohne dass es jemand merkt. Die Firma soll jede Teilstrecke bewusst bepreisen; der
  Vorschlag aus Abschnittspreisen im Portal macht das schnell.
- **Monotonie:** Ist die längere Strecke billiger als eine enthaltene, kaufen Fahrgäste das längere
  Ticket für die kürzere Fahrt. Die Firma verliert Geld und der Sitz bleibt auf Abschnitten
  belegt, die niemand fährt; der Schaltermodus (2.6) und Zusteiger finden ihn nicht. Gleichheit
  bleibt erlaubt, weil Einheitspreise auf kurzen Linien üblich sind.
- **Tarifstände statt Änderung:** Das Schema hat Gültigkeitszeiträume und `fare_no_overlap`
  bereits; ein Stand ab einem Tag ändert Preise künftiger Fahrten, ohne Historie zu verlieren.
- **Eigene Haltestellen:** Das Domänenmodell sieht `owner_company_id` vor. Ohne eigene Haltestellen
  könnte eine Firma bis zu einer Plattform-Oberfläche nur vorhandene Busbahnhöfe nutzen.
- **Eigenes Modul `routes`:** `catalog` beantwortet öffentliche Fragen der Fahrgäste (Städteliste);
  `routes` ist Pflege durch die Firma mit Rollen und Sperren. Beide lesen dieselben Tabellen.

## Konsequenzen

- **Positiv:** Eine Firma pflegt Strecken und Preise selbst; jede aktive Strecke hat ab dem
  Anlegen für jede Teilstrecke einen Preis.
- **Positiv:** Mandantentrennung doppelt: Firma aus dem geprüften Pfad und zusammengesetzte
  Fremdschlüssel `route (cancellation_policy_id, company_id)` und `fare (… , route_id)`.
- **Negativ:** `route_stop → station` hat keinen Firmenbezug in der Datenbank; dass eine Strecke
  keine fremde eigene Haltestelle nutzt, prüft nur die Anwendung.
- **Negativ:** Namen eigener Haltestellen erscheinen in der öffentlichen Suche, sobald eine aktive
  Strecke sie nutzt. Eine Moderation gibt es nicht; die Plattform muss notfalls eingreifen.
- **Negativ:** Ein Halt lässt sich bei einer genutzten Strecke auch für künftige Fahrten nicht mehr
  ändern; die Firma legt eine neue Strecke an und archiviert die alte. Fahrten der alten Strecke
  bleiben bestehen.
- **Negativ:** Die Städteliste der Suche (`GET /cities`) zeigt nur Städte an aktiven Strecken; eine
  archivierte Strecke mit noch geplanten Fahrten verschwindet dort, solange keine aktive Strecke
  dieselbe Stadt bedient.
- **Negativ:** Listen sind nicht paginiert (Annahme: wenige Dutzend Strecken je Firma).
- **Folgearbeit (2.4):** Die Fahrtplanung lehnt archivierte Strecken für neue Fahrten ab, liest die
  Strecke dafür `FOR SHARE` (oder hält über den Fremdschlüssel `FOR KEY SHARE`) und kopiert die Halte
  in derselben Transaktion. Sie warnt beim Veröffentlichen, wenn für den Fahrtag kein Tarifstand
  gilt.
- **Folgearbeit:** Oberfläche für eigene Haltestellen, neue Tarifstände ab einem Tag, Umbenennen,
  Halte ändern und eigene Stornoregeln (die API kann es bereits); Plattform-Oberfläche für Städte
  und öffentliche Haltestellen.

## Verworfene Alternativen

- **Versionen für Strecken wie bei Sitzplänen (`supersedes_route_id`):** bräuchte eine Migration
  und brächte wenig, weil eine Strecke anders als ein Sitzplan keine Busse bindet. Eine neue
  Strecke mit neuem Namen ist für Firma und Fahrgast verständlicher.
- **Lücken in der Matrix erlauben:** einfacher für lange Linien mit wenig Zwischenverkehr, aber
  stille Nicht-Verkäufe. Wer eine Teilstrecke nicht verkaufen will, braucht später ein eigenes
  Merkmal statt einer Lücke.
- **Keine Monotonie-Regel:** erlaubt Sonderpreise für Durchreisende, öffnet aber die Arbitrage oben.
- **Preis aus Abschnitten in der API berechnen und nur Abschnitte speichern:** Firmen in Syrien
  rechnen Durchgangspreise oft mit Rabatt; die Matrix muss frei bleiben.
- **Stornoregel einer genutzten Strecke ändern lassen und die Regel in die Buchung kopieren:**
  sauberer für die Zukunft, braucht aber eine Schemaänderung an `booking` und Änderungen im
  Buchungskern; nicht im Auftrag dieses Schritts.
- **Haltestellen nur durch die Plattform:** sicherer gegen unpassende Namen, blockiert aber jede
  Firma, solange es keine Plattform-Oberfläche gibt.

## Annahmen und Revisionsauslöser

- Annahme (unbestätigt): Tarife sind ganze Syrische Pfund; das Portal nimmt nur ganze Beträge an,
  die API erlaubt Minor-Units. Mit der ersten Partnerfirma prüfen.
- Annahme (unbestätigt): Keine Firma braucht Durchgangspreise unter einem Teilstreckenpreis. Neu
  bewerten, sobald eine Firma das verlangt.
- Annahme (unbestätigt): Strecken haben höchstens 15 Halte.
- Neu bewerten, wenn eine Strecke für künftige Fahrten Halte ändern muss, ohne neu angelegt zu
  werden, oder wenn Stornoregeln einer genutzten Strecke wechseln sollen.

## Verweise

- ADR 0005, 0011, 0012, 0018, 0024, 0025
- `docs/domaenenmodell.md` (Umsetzung 2.3), `docs/api-konventionen.md` (Abschnitt Strecken und
  Tarife)
- `apps/api/src/modules/routes/`, `apps/api/test/company-routes.e2e.test.ts`,
  `apps/portal/src/app/[locale]/(app)/routes/`, `e2e/tests/routes.portal.spec.ts`
