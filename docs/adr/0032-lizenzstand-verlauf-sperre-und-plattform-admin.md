# ADR 0032: Lizenzstand mit Verlauf, Prüfung unter der Firmen-Sperre und Pflege durch den Plattform-Admin

Status: Angenommen · Datum: 2026-11-04 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 2.7; fachliche Vorgaben der Projektleitung aus ADR 0029)

## Kontext

ADR 0029 legt das Lizenzmodell fest: 6 Monate frei (Gründungsphase), danach 1 oder 2 Jahre, Preis
nach Paketen zu 5 Bussen, 14 Tage Kulanz, danach keine neuen Fahrten; Bestehendes läuft weiter.
Schritt 2.7 setzt das um. Offen waren: Datenmodell (eine Zeile je Firma oder Verlauf), Tagesgrenzen,
HTTP-Status der neuen Fehler, wie die Prüfung ohne TOCTOU in die Fahrtplanung (ADR 0027) kommt, und wo
der Plattform-Admin den Stand pflegt. Plattform-Admin ist heute nur das Flag `user.is_platform_admin`
(ADR 0009); einen `/admin`-Bereich gab es weder in der API noch im Portal.

## Entscheidung

**Tabelle `company_license` mit Verlauf.** Je Zeile `plan` (`FOUNDING`, `ONE_YEAR`, `TWO_YEARS`),
`valid_from` und `valid_until` (Kalendertage in Asia/Damascus, **beide eingeschlossen**),
`bus_packages >= 1`, optional `notes` (höchstens 200 Zeichen, interne Notiz ohne Personendaten) und
`created_by_user_id`. Ein EXCLUDE-Constraint `company_license_no_overlap` (btree_gist,
`daterange(valid_from, valid_until, '[]')`) erlaubt je Firma und Tag höchstens einen Zeitraum. Die
Anwendungsrolle darf ändern, aber nicht löschen.

**Startstand per Trigger.** `AFTER INSERT ON company` legt 6 Monate `FOUNDING` mit einem Paket ab
dem Anlagetag in Damaskus an (letzter Tag: Monatsjahrestag minus 1, auf das Monatsende gekürzt wie
PostgreSQL). Bestehende Firmen bekommen in der Migration 6 Monate ab dem Migrationstag und so viele
Pakete, wie ihre aktiven Busse brauchen. Der Seed heilt eine abgelaufene Demo-Lizenz.

**Status als reine Funktion** (`modules/licenses/domain/license-status.ts`) zum Stichtag in Damaskus:
Gilt ein Zeitraum, zählen die Tage bis zum Ende der lückenlosen Kette (eine eingetragene Verlängerung
ab dem Folgetag unterdrückt die Warnung): `ACTIVE` über 30 Tage, `EXPIRING_SOON` bis 30,
`EXPIRING_VERY_SOON` bis 7 (0 am letzten gültigen Tag). Danach `GRACE` von Tag 1 bis Tag 14 nach dem
letzten gültigen Tag (Planen erlaubt), ab Tag 15 `EXPIRED`. Ohne früheren Zeitraum `EXPIRED`.

**Busgrenze.** Erlaubt sind `5 × bus_packages` aktive Busse; abgedeckt sind die ältesten (Anlage,
dann ID). Mit einem nicht abgedeckten Bus lehnt das Veröffentlichen ab; ein Plan nur mit Sitzplan
prüft keine Busgrenze.

**Wirkung nur auf das Veröffentlichen eines Wochenplans.** `POST …/trips/schedule` lehnt ab mit
`LICENSE_EXPIRED` bzw. `LICENSE_BUS_LIMIT_EXCEEDED` (beide **403**), vor Tariflücken und
Doppelbelegung. Die Vorschau liefert dieselbe Auswertung als `license` mit `issue`, ohne Fehler.
Buchung, Zahlung, Barbestätigung, Storno, Schalter, Fahrtabsage, Kontingent und Suche fragen die
Lizenz nie ab.

**Sperre ohne TOCTOU.** Serialisierungspunkt ist die Firmen-Zeile. Das Veröffentlichen sperrt sie
`FOR SHARE` als erste Sperre (Reihenfolge jetzt Firma → Strecke → Bus → Sitzplan) und liest Lizenz und
aktive Busse danach frisch. Lizenz ändern, Bus anlegen und Bus aktivieren sperren sie
`FOR NO KEY UPDATE` (Bus: Firma → Bus bzw. Firma → Sitzplan). Das blockiert Fremdschlüssel-Prüfungen
(`FOR KEY SHARE`) neuer Buchungen nicht; parallele Planungen derselben Firma bleiben parallel.
Deaktivieren sperrt die Firma nicht (es kann die Abdeckung nur vergrößern).

**Lesen und Pflege.** `GET companies/:companyId/license` für alle Rollen der Firma und den
Plattform-Admin (ohne Notiz). Neu: Decorator `@PlatformAdminOnly()` mit globalem
`PlatformAdminGuard` (403 für alle anderen, auch Firmen-Admins) und die Routen
`GET admin/companies`, `GET|POST|PUT admin/companies/:companyId/license`. `POST` legt einen Zeitraum
an (ohne Beginn: Anschluss an den laufenden oder in der Kulanz liegenden, sonst heute; ohne Ende:
Laufzeit des Plans; ohne Pakete: die des letzten Zeitraums). `PUT` ändert Pakete, Beginn, Ende, Plan
oder Notiz des heute maßgeblichen Zeitraums oder eines per `periodId` gewählten. Audit
`LICENSE_PERIOD_CREATED` und `LICENSE_PERIOD_UPDATED` mit IDs und Zahlen, nie die Notiz.

**Portal.** Hinweis im Rahmen (`EXPIRING_SOON` und später, mit Tagen und Datum), Seite
`/{locale}/license` (nur lesen), Warnung und Sperre im Formular „Woche planen". Minimaler
Admin-Bereich `/{locale}/admin/companies` und `/{locale}/admin/companies/{companyId}/license`, in der
Navigation nur für Plattform-Admins. Logik in `lib/license.ts`, Darstellung in eigenen Komponenten.

## Begründung

- **Verlauf statt einer Zeile:** Verlängerungen lassen sich vorab eintragen, ohne den laufenden Stand
  zu überschreiben, und der Verlauf ist für Rechnungen außerhalb nachvollziehbar. Das EXCLUDE-Muster
  gibt es schon bei `fare` und `commission_rate`.
- **Tage eingeschlossen:** „gültig bis 03.05." meint den 03.05. mit; so stehen Daten in Verträgen.
- **403 statt 402:** 402 ist in HTTP reserviert und nicht standardisiert; Masar nimmt kein Geld der
  Firma entgegen (Rechnungen außerhalb), ein Client soll keinen Bezahlweg erwarten. 403 heißt: Die
  Anfrage ist verstanden, die Firma ist derzeit nicht berechtigt; ein Wiederholen hilft nicht. Die
  Unterscheidung von `FORBIDDEN` leistet der stabile `code`.
- **Trigger:** Firmen entstehen heute nur über Seed und Tests, später über den Plattform-Admin. Der
  Trigger gilt für jeden Weg, und keine Firma ist versehentlich ohne Lizenz gesperrt.
- **Firmen-Zeile als Sperre:** Neue Lizenzzeilen lassen sich nicht vorab sperren; die Firma ist das
  gemeinsame Elternteil von Lizenz und Bussen. `FOR SHARE` hält Planungen untereinander parallel.
- **Älteste Busse zuerst:** feste, erklärbare Reihenfolge; ein neuer Bus verdrängt nie einen alten.

## Konsequenzen

- **Positiv:** Ablauf und Busgrenze sperren nur neue Fahrten; Fahrgäste stranden nicht (Test).
- **Positiv:** Lizenzänderung, Busaktivierung und Veröffentlichung sind serialisiert (drei
  Nebenläufigkeitstests mit echten Verbindungen).
- **Negativ:** Die Prüfung gilt zum heutigen Tag, nicht zum Fahrtag: Kurz vor Ablauf kann eine Firma
  noch Fahrten nach dem Ablauf planen (höchstens 62 Tage je Plan). Die Vorschau warnt.
- **Negativ:** Ein Plan nur mit Sitzplan umgeht die Busgrenze. Das ist die bestehende Funktion „Fahrt
  ohne Bus"; die Grenze zählt Busse, nicht Fahrten.
- **Negativ:** Die Notiz ist Freitext. Sie steht nie in Logs, Audit oder der Firmensicht, und das
  Formular weist auf „keine Personendaten" hin; prüfen kann das System es nicht.
- **Lücke:** Der Admin-Bereich ist minimal (nur Lizenzen). Firmen anlegen und sperren fehlt.

## Verworfene Alternativen

- **Felder an `company`:** einfacher, aber jede Verlängerung überschreibt den Stand, und eine
  vorab eingetragene Verlängerung ist nicht möglich.
- **Halboffene Bereiche wie bei `fare`:** technisch gleichwertig, aber fehleranfälliger in Formular
  und Vertrag („bis" heißt im Alltag einschließlich).
- **Prüfung beim Buchen oder am Schalter:** würde Fahrgäste stranden lassen (ADR 0029).
- **Lizenzzeilen statt der Firma sperren:** schützt nicht gegen eine neu eingefügte Zeile.

## Annahmen und Revisionsauslöser

- Annahme: Preise und Rechnungen bleiben außerhalb (ADR 0029, offen).
- Neu bewerten, wenn eine Nachbuchung von Paketen mitten in der Laufzeit eigene Zeiträume braucht oder
  der Plattform-Admin Firmen anlegt (dann der Trigger in den Anlegepfad oder bleibt als zweite Linie).

## Verweise

- ADR 0004, 0009, 0012, 0017 (Nachtrag), 0024, 0027, 0029, 0030
- `apps/api/src/modules/licenses/`, `apps/api/prisma/migrations/20261104180000_lizenzstand/`
- `apps/api/test/licenses.e2e.test.ts`, `licenses-schema.e2e.test.ts`, `licenses-logging.e2e.test.ts`
- `apps/portal/src/lib/license.ts`, `apps/portal/src/app/[locale]/(app)/license/`, `…/admin/`
- `e2e/tests/license.portal.spec.ts`
