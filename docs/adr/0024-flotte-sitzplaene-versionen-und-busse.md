# ADR 0024: Flotte: Sitzpläne aus dem Generator, Versionen statt Änderung, Busse mit Status

Status: Angenommen · Datum: 2026-11-04 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 2.2, Entscheidungen übertragen)

## Kontext

Schritt 2.2 der Roadmap verlangt, dass eine Firma Busse und Sitzpläne im Portal pflegt. Das Schema
aus Schritt 1.1 hat `seat_layout` (mit `version`, `status` `DRAFT`/`ACTIVE`/`RETIRED` und
`supersedes_layout_id`), `seat`, `seat_neighbor` und `bus (company_id, plate, seat_layout_id)`.
Der Generator `generateSeatLayout` (2+2, 2+1, Hinterbank) existiert als reine Funktion.

Festgelegt war bereits: Ein Sitzplan ist unveränderlich, sobald eine Fahrt ihn nutzt; Änderungen
erzeugen eine neue Version (Domänenmodell, ADR 0005). Der Fremdschlüssel
`trip (bus_id, company_id, seat_layout_id) → bus` hat `ON UPDATE CASCADE` (ADR 0018): Ändert sich
der Sitzplan eines Busses, würde PostgreSQL den Sitzplan seiner Fahrten still mitändern, solange
die Fahrt noch kein Kontingent hat. Die Firmenrollen sind `ADMIN`, `AGENT`, `DRIVER`; eine
Managerrolle gibt es nicht. Busse ließen sich bisher nicht stilllegen.

## Entscheidung

Sitzpläne entstehen nur aus dem Generator. Solange keine Fahrt einen Plan nutzt, darf er an Ort und
Stelle neu erzeugt werden; danach nur noch eine neue Version oder Archivieren. Busse bekommen einen
Status.

- **Anlegen:** `POST seat-layouts` erzeugt Sitze und Nachbarpaare (beide Richtungen) in einer
  Transaktion. Der neue Plan ist sofort `ACTIVE`; `DRAFT` wird vom Generator nicht genutzt, weil
  ein erzeugter Plan vollständig ist. Ein Name gehört zu einer Versionsreihe: Ein zweiter Plan
  unter einem vorhandenen Namen ist `SEAT_LAYOUT_NAME_TAKEN`.
- **Neu erzeugen:** `PUT seat-layouts/:id` ersetzt Sitze und Nachbarn und darf umbenennen, nur wenn
  keine Fahrt den Plan nutzt und er nicht archiviert ist (`SEAT_LAYOUT_IN_USE`,
  `SEAT_LAYOUT_RETIRED`). Ablauf: Sitzplan-Zeile `FOR UPDATE` sperren, Fahrten zählen, ersetzen.
  Eine gleichzeitig angelegte Fahrt hält über ihren Fremdschlüssel `FOR KEY SHARE` auf derselben
  Zeile; die Sperre wartet auf sie und sieht sie danach. Zusätzlich verhindert
  `trip_seat → seat ON DELETE RESTRICT` das Löschen von Sitzen mit Kontingent.
- **Neue Version:** `POST seat-layouts/:id/versions` legt einen Plan mit demselben Namen,
  `version = max + 1` und `supersedes_layout_id` an. Die Versionen eines Namens werden dafür
  `FOR UPDATE` gesperrt. Der Vorgänger bleibt unverändert und `ACTIVE`; die Firma archiviert ihn,
  wenn sie will. Auch von einem archivierten Plan darf eine Version entstehen.
- **Archivieren:** `RETIRED` ist endgültig im MVP (kein Zurückholen). Bestehende Busse und Fahrten
  behalten den Plan; neue Busse und ein Wechsel auf ihn sind `SEAT_LAYOUT_RETIRED`. Die Prüfung
  liest den Status `FOR SHARE`, damit ein gleichzeitiges Archivieren wartet.
- **Bus:** neue Spalte `bus.status` (`ACTIVE`, `INACTIVE`, Standard `ACTIVE`), additive Migration
  `20261104120000_flotte_busstatus`. Deaktivieren und Aktivieren sind eigene Endpunkte und
  idempotent. Ein Bus wechselt den Sitzplan nur ohne Fahrten (`BUS_IN_USE`), geprüft unter
  `FOR UPDATE` auf der Bus-Zeile. Das Kennzeichen ist immer änderbar.
- **Kennzeichen:** normalisiert (NFC, Richtungszeichen entfernt, westliche Ziffern, Leerraum
  zusammengefasst, Großbuchstaben), je Firma eindeutig über den vorhandenen Index
  `(company_id, plate)`. Erlaubt: Buchstaben jeder Schrift, Ziffern, Leerzeichen, Bindestrich, bis
  20 Zeichen.
- **Rollen:** Lesen alle Firmenrollen, Schreiben nur `ADMIN`. Plattform-Admins haben ohne
  Mitgliedschaft keinen Zugang.
- **Vorschau:** `POST seat-layouts/preview` ruft denselben Generator ohne Speichern auf. Das Portal
  zeigt damit eine Vorschau, ohne den Generator zu kopieren.
- **Grenzen:** 1 bis 20 Reihen, Hinterbank 2 bis 6 Sitze (`SEAT_LAYOUT_LIMITS` in `@masar/shared`).
  Der Generator selbst erlaubt mehr; die API ist bewusst enger.
- **Audit:** `SEAT_LAYOUT_CREATED`, `_REGENERATED`, `_VERSION_CREATED`, `_RETIRED`, `BUS_CREATED`,
  `BUS_UPDATED`, `BUS_DEACTIVATED`, `BUS_ACTIVATED`, jeweils nur mit IDs, Muster, Sitzzahl und
  Status, ohne Kennzeichen.

## Begründung

- Die Unveränderlichkeit eines genutzten Plans folgt aus den Daten (Fahrten zählen unter Sperre) und
  zusätzlich aus Fremdschlüsseln. Kein Trigger, kein Statusfeld, das von der Wirklichkeit abweichen
  könnte.
- Neu erzeugen für unbenutzte Pläne erspart Tippfehlern eine Versionsreihe. Sobald eine Fahrt den
  Plan nutzt, schützt die Version Belegungen, Kontingent und Nachbarpaare.
- Der Sitzplanwechsel eines Busses muss vor dem `ON UPDATE CASCADE` der Fahrt abgefangen werden,
  sonst änderte sich der Plan einer geplanten Fahrt ohne Kontingent unbemerkt.
- Ein Status statt Löschen: Busse hängen an Fahrten (`ON DELETE RESTRICT`), und die Historie soll
  bleiben.
- Die Vorschau über die API hält eine einzige Quelle für den Generator; der Aufruf ist klein und
  ohne Nebenwirkung.

## Konsequenzen

- **Positiv:** Eine Firma pflegt Pläne und Busse selbst; Fahrten (Schritt 2.4) können nur auf
  vollständige Pläne mit symmetrischen Nachbarpaaren verweisen.
- **Positiv:** Mandantentrennung doppelt: Firma aus dem geprüften Pfad und zusammengesetzter
  Fremdschlüssel `bus (seat_layout_id, company_id)`.
- **Negativ:** Ein archivierter Plan lässt sich nicht zurückholen; der Weg ist eine neue Version.
- **Negativ:** Eigene Beschriftungen (`label`) und nicht verkaufbare Sitze (`is_sellable`) lassen
  sich noch nicht bearbeiten; der Generator setzt `1A …` und alle Sitze verkaufbar.
- **Negativ:** Listen sind nicht paginiert (Annahme: wenige Dutzend Pläne und Busse je Firma).
- **Folgearbeit (2.4):** Fahrtplanung lehnt `RETIRED`-Pläne und `INACTIVE`-Busse für neue Fahrten
  ab und nimmt für Busaustausch nur Busse mit gleichem Plan.
- **Folgearbeit:** Oberfläche für neue Version, Umbenennen und Buswechsel des Plans (die API kann
  es bereits).

## Verworfene Alternativen

- **`DRAFT` → `ACTIVE` mit Freigabe-Schritt:** mehr Klicks ohne Gewinn, weil der Generator nur
  vollständige Pläne erzeugt. Bleibt sinnvoll für frei gezeichnete Pläne (`CUSTOM`).
- **Neuer Plan unter vorhandenem Namen als Version 1 mit anderem Namen erzwingen oder still
  hochzählen:** verwischt den Unterschied zwischen „neuer Plan" und „neue Version".
- **Bus löschen statt deaktivieren:** scheitert an Fahrten und verliert Historie.
- **Generator in `@masar/shared` verschieben und im Browser rechnen:** schnellere Vorschau, aber
  Entscheidungslogik gehört nach AGENTS.md in `modules/<modul>/domain/`.
- **Managerrolle einführen:** nicht im Auftrag; braucht eine eigene Entscheidung über Rechte im
  ganzen Portal.

## Annahmen und Revisionsauslöser

- Annahme (unbestätigt): Firmen haben selten mehr als 50 Busse; sonst Paginierung ergänzen.
- Annahme (unbestätigt): Kennzeichen enthalten nur Buchstaben, Ziffern, Leerzeichen und Bindestrich.
  Mit der ersten Partnerfirma prüfen.
- Neu bewerten, wenn eigene Beschriftungen oder frei gezeichnete Pläne gebraucht werden.

## Verweise

- ADR 0005, 0006, 0018, 0025
- `docs/domaenenmodell.md` (Umsetzung 2.2), `docs/api-konventionen.md` (Abschnitt Flotte)
- `apps/api/src/modules/fleet/`, `apps/api/test/fleet.e2e.test.ts`,
  `apps/portal/src/app/[locale]/(app)/fleet/`, `e2e/tests/fleet.portal.spec.ts`
