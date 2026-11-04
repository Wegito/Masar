# API-Konventionen

Gilt für `apps/api`. Entscheidungen dazu: ADR 0010 (Sprachen), 0011 (Geld), 0012 (Zeit),
0013 (Kennungen), 0015 (Fehlerformat).

## Grundlagen

| Thema           | Regel                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Basis-URL       | `/api/v1`. Eine neue Hauptversion nur mit ADR                                                                                           |
| Format          | JSON, Feldnamen in `camelCase`                                                                                                          |
| Kennungen       | UUIDv7 als String. Für Fahrgäste sichtbar ist nur der Buchungscode                                                                      |
| Zeitpunkte      | ISO 8601 in UTC mit `Z`, z. B. `2026-10-20T20:30:00.000Z`                                                                               |
| Kalendertage    | `YYYY-MM-DD`, immer als Tag in `Asia/Damascus` gemeint (z. B. Suchdatum, Fahrtag)                                                       |
| Geld            | Objekt `{ "amountMinor": 150000, "currency": "SYP" }`, Betrag als ganze Zahl in Minor-Units nach ISO 4217                               |
| Summen          | In der Datenbank `bigint`, in der API trotzdem eine JSON-Zahl; vorher Prüfung gegen `Number.MAX_SAFE_INTEGER` (rund 9·10¹⁵ Minor-Units) |
| Sprache         | Die API liefert keine übersetzten Texte, nur Codes. Ausnahme: Benachrichtigungen, gerendert in der Sprache der Buchung                  |
| Telefonnummern  | Eingabe in beliebiger Schreibweise, gespeichert und zurückgegeben als E.164 (`+963933123456`)                                           |
| Request-ID      | Header `X-Request-Id` wird übernommen oder erzeugt und in jeder Antwort zurückgegeben                                                   |
| Paginierung     | Wachsende Listen mit Cursor: `?limit=&cursor=` → `{ "items": [], "nextCursor": "…" }`                                                   |
| Idempotenz      | Anlegende Aufrufe mit Nebenwirkung (`POST /bookings`) verlangen den Header `Idempotency-Key`                                            |
| Ratenbegrenzung | Antwort 429 mit `Retry-After` und Code `RATE_LIMITED`                                                                                   |

Personenbezogene Daten stehen nie in URLs. Eine Buchung wird deshalb per `POST /bookings/lookup` mit
Code und Telefon im Body gesucht, nicht per Query-Parameter. Ausnahmen: das selbst gewählte
Geschlecht in der anonymen Sitzplan-Abfrage (ADR 0019) und der Suchtext `q` der Buchungsliste im
Portal (ADR 0028). Die API loggt nur Pfade, nie die Query.

## Authentifizierung

- Web und Portal: Cookie `__Host-masar_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`).
- Spätere native App: `Authorization: Bearer <token>`, derselbe Guard.
- Jede Route verlangt eine Sitzung, außer sie ist ausdrücklich öffentlich (Liste unten).
- Routen einer Firma tragen die Firma im Pfad (`/companies/:companyId/...`). Die API prüft die
  Mitgliedschaft und Rolle; eine fremde Firma ergibt `FORBIDDEN`.
- Zustandsändernde Anfragen mit Body müssen JSON sein (sonst `UNSUPPORTED_MEDIA_TYPE`). Schickt der
  Browser einen `Origin`, muss er erlaubt sein (sonst `FORBIDDEN`).

## Endpunkte

Stand Schritt 2.5. Die Flotte (`/companies/:companyId/seat-layouts`, `/buses`) steht im Abschnitt
[Flotte](#flotte), Strecken, Haltestellen, Tarife und Stornoregeln
(`/companies/:companyId/routes`, `/stations`, `/cancellation-policies`) im Abschnitt
[Strecken und Tarife](#strecken-und-tarife), die Fahrtplanung (`/companies/:companyId/trips`) im
Abschnitt [Fahrtplanung](#fahrtplanung), Liste, Detail und Fahrgastliste der Buchungen
(`/companies/:companyId/bookings`, `/trips/:tripId/passengers`) im Abschnitt
[Buchungen im Portal](#buchungen-im-portal). Lizenzstand und Plattform-Admin (`/companies/:companyId/license`,
`/admin/companies`) stehen im Abschnitt [Lizenz](#lizenz).

| Methode | Pfad                                                            | Zugang                                             | Zweck                                                      |
| ------- | --------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `GET`   | `/api/v1/cities`                                                | öffentlich                                         | bediente Städte mit Haltestellen für die Suchmaske         |
| `GET`   | `/api/v1/trips/search`                                          | öffentlich; 60 je Minute und IP                    | Fahrten für Stadtpaar, Tag und Zahl der Fahrgäste          |
| `GET`   | `/api/v1/trips/:tripId/seat-map`                                | öffentlich; 60 je Minute und IP                    | Sitzplan einer Fahrt für Teilstrecke und Geschlecht        |
| `POST`  | `/api/v1/auth/login`                                            | öffentlich                                         | Anmeldung; setzt das Sitzungs-Cookie                       |
| `POST`  | `/api/v1/auth/logout`                                           | Sitzung                                            | Abmeldung; widerruft die Sitzung                           |
| `GET`   | `/api/v1/auth/me`                                               | Sitzung                                            | eigenes Konto mit Mitgliedschaften                         |
| `POST`  | `/api/v1/auth/password-reset/request`                           | öffentlich                                         | Reset-Link anfordern; Antwort immer 202                    |
| `POST`  | `/api/v1/auth/password-reset/confirm`                           | öffentlich                                         | neues Passwort setzen; meldet alle Sitzungen ab            |
| `POST`  | `/api/v1/companies/:companyId/invitations`                      | Firmen-Admin, Plattform-Admin                      | Einladung per E-Mail                                       |
| `POST`  | `/api/v1/bookings`                                              | öffentlich; `Idempotency-Key`; 20 je Minute und IP | Sitze halten (Hold), liefert Buchung und Verwaltungstoken  |
| `GET`   | `/api/v1/bookings/:bookingId`                                   | Verwaltungs- oder Lesetoken; 60 je Minute und IP   | Buchung abrufen                                            |
| `GET`   | `/api/v1/bookings/:bookingId/ticket`                            | Verwaltungs- oder Lesetoken; 30 je Minute und IP   | Ticketseite mit QR-Tokens                                  |
| `POST`  | `/api/v1/bookings/lookup`                                       | öffentlich; 5 je Minute und IP, 10 je Stunde/Code  | Buchung über Code und Telefon, liefert Lesetoken           |
| `POST`  | `/api/v1/bookings/:bookingId/reserve-cash`                      | Verwaltungstoken; 20 je Minute und IP              | Barzahlung wählen: `HELD` → `RESERVED`                     |
| `POST`  | `/api/v1/bookings/:bookingId/cancel`                            | Verwaltungstoken; 20 je Minute und IP              | Storno durch den Fahrgast                                  |
| `POST`  | `/api/v1/companies/:companyId/bookings/lookup`                  | Firmen-Admin, Agent                                | Buchung über den Code finden                               |
| `POST`  | `/api/v1/companies/:companyId/bookings/:bookingId/confirm-cash` | Firmen-Admin, Agent                                | bar bezahlt: `RESERVED` → `CONFIRMED`, Tickets             |
| `POST`  | `/api/v1/companies/:companyId/bookings/:bookingId/cancel`       | Firmen-Admin, Agent                                | Storno durch die Firma                                     |
| `POST`  | `/api/v1/invitations/accept`                                    | öffentlich; bestehende Konten mit Sitzung          | Einladung annehmen                                         |
| `POST`  | `/api/v1/client-errors`                                         | öffentlich; 20 je Minute und IP                    | Fehlerbericht aus Web oder Portal; gültig ergibt immer 204 |
| `GET`   | `/api/health/live`, `/api/health/ready`                         | öffentlich                                         | Betrieb                                                    |

### Suche und Sitzplan

Öffentlich, weil Gäste ohne Konto suchen (ADR 0009). Beide Abfragen sind ein Schnappschuss ohne
Sperre; verbindlich prüft erst die Reservierung unter der Trip-Sperre (ADR 0005). Fachliche Regeln:
[Domänenmodell, Umsetzung 1.2](domaenenmodell.md#umsetzung-12).

`GET /cities` liefert `{ "items": [{ "id", "slug", "nameAr", "nameEn", "stations": [{ "id",
"nameAr", "nameEn" }] }] }`, sortiert nach englischem Namen. Nur Städte und Haltestellen an einer
aktiven Route einer aktiven Firma. Die Liste ist klein und deshalb nicht paginiert.

`GET /trips/search?from=<cityId>&to=<cityId>&date=YYYY-MM-DD&passengers=1&limit=20&cursor=`

| Parameter    | Regel                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| `from`, `to` | Stadt-IDs (UUID), verschieden; unbekannte Städte ergeben eine leere Liste, keinen 404 |
| `date`       | Kalendertag in `Asia/Damascus`; gefiltert wird die Abfahrt am Einstiegshalt           |
| `passengers` | 1 bis 9 (Standard 1); nur Fahrten mit so vielen freien Online-Sitzen                  |
| `limit`      | 1 bis 50 (Standard 20)                                                                |
| `cursor`     | `nextCursor` der vorigen Seite, opak; ungültig ergibt `VALIDATION_FAILED` (`custom`)  |

```json
{
  "items": [
    {
      "tripId": "…",
      "company": { "id": "…", "nameAr": "…", "nameEn": "…" },
      "departureAt": "2026-11-04T22:10:00.000Z",
      "arrivalAt": "2026-11-05T01:20:00.000Z",
      "from": {
        "tripStopId": "…",
        "stationId": "…",
        "cityId": "…",
        "nameAr": "…",
        "nameEn": "…",
        "arrivalAt": "…",
        "departureAt": "…"
      },
      "to": { "…": "wie from" },
      "stops": [{ "…": "Halte vom Einstieg bis zum Ausstieg, wie from" }],
      "fare": { "amountMinor": 40000, "currency": "SYP" },
      "freeSeats": { "count": 9, "capped": true },
      "genderRuleEnabled": true
    }
  ],
  "nextCursor": null
}
```

- Ein Eintrag je Fahrt und Haltestellenpaar; sortiert nach `departureAt`, dann nach IDs.
- `departureAt` ist die Abfahrt am Einstiegshalt, `arrivalAt` die Ankunft am Ausstiegshalt (`null`,
  wenn die Fahrt dort keine Zeit pflegt). Die Ortszeit rechnet das Frontend.
- `freeSeats`: `capped: true` heißt „mindestens `count`" (Anzeige „9+"). Gezählt wird nur das
  Online-Kontingent ohne Geschlechtsregel.

`GET /trips/:tripId/seat-map?fromStopId=&toStopId=&gender=FEMALE|MALE`

- `fromStopId`, `toStopId` sind Fahrthalt-IDs (`tripStopId` aus der Suche). `gender` ist optional.
- Antwort: `tripId`, `company`, `from`, `to`, `fare` wie in der Suche, dazu
  `genderRule: { "enabled", "applied" }`, `layout: { "rows", "columns" }` und
  `seats: [{ "seatId", "label", "row", "column", "side", "state" }]` (sortiert nach Reihe und
  Spalte, beide ab 0; `side` ist `LEFT`, `RIGHT` oder `BENCH`).
- `nationalIdRequired` (seit Schritt 1.5): Die Firma verlangt je Fahrgast eine Ausweisnummer
  (sonst `NATIONAL_ID_REQUIRED` beim Hold). Die Fahrgast-App fragt sie nur dann ab.
- `state` ist `FREE`, `TAKEN`, `NOT_ONLINE`, `BLOCKED` oder `NOT_FOR_YOU`. Ohne `gender` ist
  `applied` falsch und kein Sitz `NOT_FOR_YOU`; das Frontend fragt dann zuerst, für wen gebucht wird.
- Fehler: `TRIP_NOT_FOUND` (auch Entwürfe und Fahrten gesperrter Firmen), `TRIP_NOT_BOOKABLE`
  (abgefahren, abgeschlossen, gestrichen), `SALES_CLOSED`, `INVALID_SEGMENT`, `NO_FARE_FOR_SEGMENT`.
- Das Geschlecht anderer Fahrgäste steht nie in der Antwort. Der Parameter `gender` ist die
  dokumentierte Ausnahme der URL-Regel (ADR 0019): weder API noch Proxy loggen die Query.

### Buchung

Gastbuchung ohne Konto (ADR 0009, 0020); fachliche Regeln im
[Domänenmodell, Umsetzung 1.3](domaenenmodell.md#umsetzung-13).

`POST /bookings` mit Header `Idempotency-Key` (16 bis 128 Zeichen base64url, z. B. eine UUID):

```json
{
  "tripId": "…",
  "fromStopId": "…",
  "toStopId": "…",
  "locale": "ar",
  "contact": { "name": "…", "phone": "0933 123 456", "email": "optional@example.com" },
  "passengers": [{ "seatId": "…", "fullName": "…", "gender": "FEMALE", "nationalId": "optional" }]
}
```

- `fromStopId`, `toStopId` und `seatId` wie im Sitzplan. 1 bis 9 Fahrgäste, jeder Sitz nur einmal.
  `gender` ist Pflicht, wenn die Fahrt die Geschlechtsregel nutzt; `nationalId` nur, wenn die
  Firma sie verlangt, sonst wird sie verworfen.
- Telefon in beliebiger Schreibweise, gespeichert als E.164; ungültig ergibt `VALIDATION_FAILED`
  mit `errors[].path = "contact.phone"`.
- Antwort 201 `{ "booking": { … }, "manageToken": "…" }`. Das Token kommt nur in dieser Antwort und
  geht bei jedem weiteren Aufruf im Header `X-Manage-Token` mit. Eine Wiederholung mit demselben
  `Idempotency-Key` ergibt 200 mit derselben Buchung und einem neuen Token (das alte gilt dann nicht
  mehr); mit anderer Fahrt, Strecke oder Sitzauswahl `IDEMPOTENCY_KEY_REUSED`. Fehlt der Header,
  antwortet die API mit `VALIDATION_FAILED` (`errors[].path = "headers.idempotency-key"`).
- Fehler: `TRIP_NOT_FOUND`, `TRIP_NOT_BOOKABLE`, `SALES_CLOSED`, `INVALID_SEGMENT`,
  `NO_FARE_FOR_SEGMENT`, `NATIONAL_ID_REQUIRED`, `TOO_MANY_SEATS` (`params.max`),
  `TOO_MANY_OPEN_HOLDS` (`params.max`), `SEAT_UNKNOWN` (`params.seatIds`), `SEAT_BLOCKED`,
  `SEAT_NOT_ONLINE`, `SEAT_TAKEN`, `GENDER_RULE_CONFLICT` (jeweils `params.seats` mit
  Beschriftungen), `GENDER_REQUIRED`, `SERVICE_UNAVAILABLE` mit `Retry-After`, wenn die Fahrt gerade
  zu lange gesperrt ist.

Buchung in der Antwort (Gast und Personal sehen dasselbe Format):

```json
{
  "id": "…",
  "bookingCode": "ABCDEFGH",
  "status": "HELD",
  "channel": "ONLINE",
  "paymentMethod": null,
  "locale": "ar",
  "trip": { "id": "…", "departureAt": "…", "company": { "id": "…", "nameAr": "…", "nameEn": "…" } },
  "from": {
    "tripStopId": "…",
    "stationId": "…",
    "nameAr": "…",
    "nameEn": "…",
    "arrivalAt": null,
    "departureAt": "…"
  },
  "to": { "…": "wie from" },
  "holdExpiresAt": "…",
  "deadlineAt": null,
  "fare": { "amountMinor": 40000, "currency": "SYP" },
  "total": { "amountMinor": 80000, "currency": "SYP" },
  "contact": { "name": "…", "phone": "+963933123456", "email": null },
  "passengers": [
    {
      "id": "…",
      "seatId": "…",
      "seatLabel": "2A",
      "fullName": "…",
      "gender": "FEMALE",
      "nationalIdLast4": null,
      "status": "ACTIVE"
    }
  ],
  "tickets": [{ "id": "…", "passengerId": "…", "seatLabel": "2A", "status": "ISSUED" }],
  "createdAt": "…",
  "confirmedAt": null,
  "cancelledAt": null,
  "cancelledBy": null
}
```

- `bookingCode` ohne Bindestrich; die Anzeige `ABCD-EFGH` macht das Frontend. Tickets tragen hier
  kein QR-Token; das liefert nur die Ticketseite (Abschnitt unten).
- `GET /bookings/:bookingId`, `POST /bookings/:bookingId/reserve-cash` und
  `POST /bookings/:bookingId/cancel` verlangen `X-Manage-Token`. Fehlendes oder falsches Token und
  unbekannte ID ergeben dieselbe 404 `BOOKING_NOT_FOUND`.
- `reserve-cash` setzt `deadlineAt` auf die Barfrist der Fahrt. Fehler: `HOLD_EXPIRED`,
  `CASH_DEADLINE_PASSED`, `INVALID_STATE_TRANSITION`, `TRIP_NOT_BOOKABLE`. Eine Wiederholung auf
  einer bereits reservierten Buchung ändert nichts.
- `cancel` (Fahrgast): Holds und Barreservierungen bis zur Abfahrt, bestätigte Buchungen nach der
  Stornoregel der Route. Fehler: `BOOKING_NOT_CANCELLABLE`, `INVALID_STATE_TRANSITION`,
  `HOLD_EXPIRED`. Eine Wiederholung auf einer stornierten Buchung ändert nichts.
- Personal (`ADMIN`, `AGENT` der Firma aus dem Pfad): `lookup` mit `{ "bookingCode": "abcd-efgh" }`
  (Normalisierung nach ADR 0013), `confirm-cash` ohne Body (Fehler `HOLD_EXPIRED`,
  `INVALID_STATE_TRANSITION`, `TRIP_NOT_BOOKABLE`; Wiederholung ändert nichts), `cancel` mit
  `{ "reason": "PASSENGER_REQUEST" | "OPERATIONAL" | "DUPLICATE" | "OTHER" }`. Eine Buchung einer
  anderen Firma ist `BOOKING_NOT_FOUND`, eine fremde Firma im Pfad `FORBIDDEN`. Seit Schritt 2.5
  antworten alle drei mit der Sicht des Personals (Abschnitt
  [Buchungen im Portal](#buchungen-im-portal)): Telefon maskiert, Ausweisnummer nur als
  `nationalIdPresent`.

### Ticketseite

Schritt 1.4, ADR 0022; fachliche Regeln im [Domänenmodell, Umsetzung 1.4](domaenenmodell.md#umsetzung-14).

`POST /bookings/lookup` mit `{ "bookingCode": "abcd-efgh", "phone": "0933 123 456" }` im Body (nie
in der URL). Code nach ADR 0013 normalisiert, Telefon in beliebiger Schreibweise.

- 200 `{ "accessToken": "…", "accessExpiresAt": "…", "booking": { …Ticketseite… } }`. Das
  Lesetoken (32 Zeichen) gilt 12 Stunden, nur für diese Buchung und nur für `GET /bookings/:id` und
  `GET /bookings/:id/ticket`, im Header `X-Manage-Token` wie das Verwaltungstoken. An
  `reserve-cash` und `cancel` ergibt es `BOOKING_NOT_FOUND`.
- Unbekannter Code und falsches Telefon ergeben dieselbe 404 `BOOKING_NOT_FOUND`. Eine ungültige
  Form (Code nicht 8 Zeichen Crockford-Base32, Telefon keine syrische Nummer) ergibt
  `VALIDATION_FAILED` mit `errors[].path` `bookingCode` bzw. `phone`.
- Grenzen: 5 Anfragen je Minute und IP; 10 Versuche je Stunde für Code und Client (IPv4 oder
  IPv6-/48) und 100 je Stunde für den Code über alle Clients, auch für unbekannte Codes (ADR 0033).
  Ein fremder Client sperrt so nur sich selbst. Darüber 429 `RATE_LIMITED` mit `Retry-After`.

`GET /bookings/:bookingId/ticket` mit Verwaltungs- oder Lesetoken:

```json
{
  "id": "…",
  "bookingCode": "ABCDEFGH",
  "status": "CONFIRMED",
  "paymentMethod": "CASH",
  "holdExpiresAt": "…",
  "deadlineAt": "…",
  "total": { "amountMinor": 80000, "currency": "SYP" },
  "trip": {
    "id": "…",
    "status": "SCHEDULED",
    "departureAt": "…",
    "company": { "id": "…", "nameAr": "…", "nameEn": "…" }
  },
  "from": { "…": "wie in der Buchung" },
  "to": { "…": "wie in der Buchung" },
  "stops": [{ "…": "alle Halte vom Einstieg bis zum Ausstieg, wie from" }],
  "passengers": [{ "id": "…", "seatLabel": "2A", "fullName": "…", "status": "ACTIVE" }],
  "tickets": [
    { "id": "…", "passengerId": "…", "seatLabel": "2A", "status": "ISSUED", "qrToken": "…" }
  ],
  "confirmedAt": "…",
  "cancelledAt": null,
  "cancelledBy": null
}
```

- Ohne Telefon, E-Mail, Geschlecht und Ausweisnummer, weil auch Code und Telefon diese Sicht öffnen.
  Der Name steht drin, weil das Personal ihn beim Einsteigen mit dem Ausweis vergleicht.
- `qrToken` (43 Zeichen base64url) ist der Inhalt des QR-Codes, nur bei `status = CONFIRMED` und
  Ticket `ISSUED`, sonst `null`. Er ist bei jedem Abruf gleich, bis `ticket.version` oder der
  Schlüssel wechselt. Gespeichert ist nur sein SHA-256; geloggt wird er nie.
- Fehlendes, falsches oder abgelaufenes Token und unbekannte ID ergeben dieselbe 404
  `BOOKING_NOT_FOUND`.

### Flotte

Schritt 2.2, ADR 0024; fachliche Regeln im [Domänenmodell, Umsetzung 2.2](domaenenmodell.md#umsetzung-22).
Alle Pfade unter `/companies/:companyId/`. Lesen: `ADMIN`, `AGENT`, `DRIVER` der Firma; Schreiben
nur `ADMIN` (eine Managerrolle gibt es nicht). Eine fremde Firma im Pfad ergibt `FORBIDDEN`, ein
Sitzplan oder Bus einer anderen Firma unter der eigenen `SEAT_LAYOUT_NOT_FOUND` bzw. `BUS_NOT_FOUND`.
Listen sind klein (Busse und Pläne einer Firma) und deshalb nicht paginiert.

| Methode | Pfad                                  | Zugang | Zweck                                                          |
| ------- | ------------------------------------- | ------ | -------------------------------------------------------------- |
| `GET`   | `seat-layouts?status=`                | lesen  | Sitzpläne, sortiert nach Name, neueste Version zuerst          |
| `POST`  | `seat-layouts/preview`                | Admin  | Generator ohne Speichern (Vorschau im Formular), Antwort 200   |
| `POST`  | `seat-layouts`                        | Admin  | Sitzplan aus dem Generator anlegen, Antwort 201                |
| `GET`   | `seat-layouts/:layoutId`              | lesen  | Sitzplan mit Sitzen und Nachbarpaaren                          |
| `PUT`   | `seat-layouts/:layoutId`              | Admin  | neu erzeugen und umbenennen, nur solange keine Fahrt ihn nutzt |
| `POST`  | `seat-layouts/:layoutId/versions`     | Admin  | neue Version unter demselben Namen, Antwort 201                |
| `POST`  | `seat-layouts/:layoutId/archive`      | Admin  | archivieren (`RETIRED`); Wiederholung ändert nichts            |
| `GET`   | `buses`                               | lesen  | Busse, aktive zuerst, dann nach Kennzeichen                    |
| `POST`  | `buses`                               | Admin  | Bus anlegen, Antwort 201                                       |
| `GET`   | `buses/:busId`                        | lesen  | ein Bus                                                        |
| `PATCH` | `buses/:busId`                        | Admin  | Kennzeichen und/oder Sitzplan ändern                           |
| `POST`  | `buses/:busId/deactivate`, `activate` | Admin  | Status `INACTIVE` bzw. `ACTIVE`; Wiederholung ändert nichts    |

Generator-Eingabe (`POST seat-layouts`, `PUT`, `versions` ohne `name`, `preview` ohne `name`):

```json
{ "name": "Standard 45", "pattern": "TWO_PLUS_TWO", "rows": 10, "backBench": 5 }
```

- `pattern`: `TWO_PLUS_TWO` oder `TWO_PLUS_ONE` (`CUSTOM` ist für später reserviert). `rows` 1 bis
  20, `backBench` 2 bis 6 oder weglassen (`SEAT_LAYOUT_LIMITS` in `@masar/shared`). `name` 1 bis 60
  Zeichen, Leerraum zusammengefasst.
- Sitzplan in der Antwort: `id`, `name`, `version`, `pattern`, `status` (`ACTIVE`, `RETIRED`),
  `supersedesLayoutId`, `seatCount`, `tripCount`, `busCount`, `editable` (unbenutzt und nicht
  archiviert), `createdAt`, `updatedAt`; Einzelabruf zusätzlich `layout: { rows, columns }`,
  `seats: [{ id, label, row, column, side, isSellable }]` und `neighbors: [["1A", "1B"], …]` (jedes
  Paar einmal, gespeichert sind beide Richtungen). Die Vorschau liefert `pattern`, `layout`,
  `seatCount`, `seats` ohne `id` und `neighbors`.
- Fehler: `SEAT_LAYOUT_NAME_TAKEN` (Name schon vergeben: neue Version statt zweitem Plan),
  `SEAT_LAYOUT_IN_USE` (`PUT` auf einen Plan mit Fahrten), `SEAT_LAYOUT_RETIRED` (`PUT` auf einen
  archivierten Plan, Bus mit archiviertem Plan), `SERVICE_UNAVAILABLE` mit `Retry-After`, wenn die
  Zeile zu lange gesperrt ist.

Bus: `{ "plate": "دمشق 12345", "seatLayoutId": "…" }`. Antwort: `id`, `plate`, `status`
(`ACTIVE`, `INACTIVE`), `seatLayout: { id, name, version, status, seatCount }`, `tripCount`,
`createdAt`, `updatedAt`.

- Das Kennzeichen wird normalisiert (NFC, Richtungszeichen entfernt, westliche Ziffern, Leerraum
  zusammengefasst, Großbuchstaben) und ist je Firma eindeutig (`BUS_PLATE_TAKEN`). Erlaubt sind
  Buchstaben, Ziffern, Leerzeichen und Bindestrich, höchstens 20 Zeichen; sonst
  `VALIDATION_FAILED` mit `errors[].path = "plate"`, `rule = "custom"`.
- `PATCH` mit mindestens einem Feld. Den Sitzplan wechselt ein Bus nur ohne Fahrten (`BUS_IN_USE`);
  das Kennzeichen ist immer änderbar.

### Strecken und Tarife

Schritt 2.3, ADR 0026; fachliche Regeln im [Domänenmodell, Umsetzung 2.3](domaenenmodell.md#umsetzung-23).
Alle Pfade unter `/companies/:companyId/`. Lesen: `ADMIN`, `AGENT`, `DRIVER` der Firma; Schreiben
nur `ADMIN`. Eine fremde Firma im Pfad ergibt `FORBIDDEN`, eine Strecke oder Stornoregel einer
anderen Firma unter der eigenen `ROUTE_NOT_FOUND` bzw. `CANCELLATION_POLICY_NOT_FOUND`. Listen sind
klein und deshalb nicht paginiert.

| Methode | Pfad                              | Zugang | Zweck                                                                |
| ------- | --------------------------------- | ------ | -------------------------------------------------------------------- |
| `GET`   | `stations`                        | lesen  | alle Städte mit öffentlichen und eigenen Haltestellen der Firma      |
| `POST`  | `stations`                        | Admin  | eigene Haltestelle in einer bestehenden Stadt, Antwort 201           |
| `GET`   | `cancellation-policies`           | lesen  | Stornoregeln der Firma                                               |
| `POST`  | `cancellation-policies`           | Admin  | Stornoregel anlegen (danach unveränderlich), Antwort 201             |
| `GET`   | `cancellation-policies/:policyId` | lesen  | eine Stornoregel                                                     |
| `GET`   | `routes?status=`                  | lesen  | Strecken, aktive zuerst, dann nach englischem Namen                  |
| `POST`  | `routes`                          | Admin  | Strecke mit Halten und Tarifmatrix ab heute, Antwort 201             |
| `GET`   | `routes/:routeId`                 | lesen  | Strecke mit Halten und heute oder künftig gültigen Tarifständen      |
| `PATCH` | `routes/:routeId`                 | Admin  | Namen; Stornoregel nur, solange keine Fahrt die Strecke nutzt        |
| `PUT`   | `routes/:routeId/stops`           | Admin  | Halte und Tarife ersetzen, nur solange keine Fahrt die Strecke nutzt |
| `PUT`   | `routes/:routeId/fares`           | Admin  | neuer Tarifstand ab `validFrom`, auch für genutzte Strecken          |
| `POST`  | `routes/:routeId/archive`         | Admin  | archivieren (`ARCHIVED`); Wiederholung ändert nichts                 |

Strecke anlegen (`POST routes`; `PUT stops` nur mit `stops` und `fares`):

```json
{
  "nameAr": "دمشق – حلب",
  "nameEn": "Damascus – Aleppo",
  "cancellationPolicyId": "…",
  "stops": ["<Haltestelle Damaskus>", "<Haltestelle Homs>", "<Haltestelle Aleppo>"],
  "fares": {
    "currency": "SYP",
    "items": [
      { "fromSeq": 0, "toSeq": 1, "amountMinor": 25000 },
      { "fromSeq": 0, "toSeq": 2, "amountMinor": 60000 },
      { "fromSeq": 1, "toSeq": 2, "amountMinor": 40000 }
    ]
  }
}
```

- `stops`: 2 bis 15 Haltestellen in Fahrtrichtung, jede einmal (`ROUTE_STOP_DUPLICATE`), öffentlich
  oder eigene der Firma (sonst `STATION_NOT_FOUND`). `fromSeq` und `toSeq` sind Positionen ab 0.
- `fares.items`: genau ein Preis je Paar `fromSeq < toSeq` (`FARE_MATRIX_INCOMPLETE` mit
  `params.missing`, `FARE_MATRIX_INVALID` mit `params.pairs`). `amountMinor` ganz, 1 bis 10⁹. Kein
  Preis kleiner als der einer enthaltenen Teilstrecke (`FARE_NOT_MONOTONIC` mit `params.pair` und
  `params.contained`). `currency` `SYP` (Standard), `USD` oder `EUR`. Grenzen: `ROUTE_LIMITS` und
  `CANCELLATION_POLICY_LIMITS` in `@masar/shared`.
- Tarifstand (`PUT fares`): `{ "validFrom": "2026-12-01", "currency": "SYP", "items": […] }`.
  `validFrom` ist ein Kalendertag in Damaskus, Standard heute, nie früher (`FARE_VALID_FROM_PAST`).
  Frühere Stände enden an `validFrom`, Stände ab `validFrom` werden ersetzt.
- Strecke in der Antwort: `id`, `nameAr`, `nameEn`, `status` (`ACTIVE`, `ARCHIVED`),
  `cancellationPolicy: { id, name }`, `stops: [{ id, seq, station: { id, nameAr, nameEn }, city:
{ id, nameAr, nameEn } }]`, `tripCount`, `editable` (aktiv und ohne Fahrten), `createdAt`,
  `updatedAt`; der Einzelabruf zusätzlich `fareSets: [{ validFrom, validUntil, currency, items }]`,
  nur heute oder künftig gültige Stände, nach Beginn sortiert.
- Fehler beim Ändern: `ROUTE_IN_USE` (Halte oder Stornoregel einer Strecke mit Fahrten),
  `ROUTE_ARCHIVED` (jede Änderung an einer archivierten Strecke), `SERVICE_UNAVAILABLE` mit
  `Retry-After`, wenn die Zeile zu lange gesperrt ist.

Haltestelle: `{ "cityId": "…", "nameAr": "مكتب الشركة", "nameEn": "Company office" }` (Namen 1 bis
120 Zeichen). Antwort `id`, `nameAr`, `nameEn`, `own: true`, `cityId`; unbekannte Stadt
`CITY_NOT_FOUND`. Der Katalog nennt je Haltestelle `own` (eigene oder öffentliche).

Stornoregel: `{ "name": "Standard", "allowPassengerCancel": true, "rules": [{ "minMinutesBeforeDeparture": 1440, "feeBps": 0 }, …] }`.
Höchstens 10 Stufen, Schwelle 0 bis 43 200 Minuten, Gebühr 0 bis 10 000 bps. Jede Schwelle einmal,
und die Gebühr steigt oder bleibt gleich, je näher die Abfahrt (`CANCELLATION_RULES_INVALID`).
Antwort mit `rules` (größte Schwelle zuerst) und `routeCount`.

### Fahrtplanung

Schritt 2.4, ADR 0027; fachliche Regeln im [Domänenmodell, Umsetzung 2.4](domaenenmodell.md#umsetzung-24).
Alle Pfade unter `/companies/:companyId/`. Lesen: `ADMIN`, `AGENT`, `DRIVER` der Firma; Schreiben
(auch die Vorschau) nur `ADMIN`. Eine fremde Firma im Pfad ergibt `FORBIDDEN`, eine Fahrt einer
anderen Firma unter der eigenen `TRIP_NOT_FOUND`; Strecke, Bus oder Sitzplan einer anderen Firma im
Wochenplan `ROUTE_NOT_FOUND`, `BUS_NOT_FOUND` bzw. `SEAT_LAYOUT_NOT_FOUND`.

| Methode | Pfad                     | Zugang | Zweck                                                                     |
| ------- | ------------------------ | ------ | ------------------------------------------------------------------------- |
| `GET`   | `trips`                  | lesen  | Fahrten nach Abfahrt, mit Kontingent und Zahl aktiver Buchungen           |
| `GET`   | `trips/:tripId`          | lesen  | Fahrt mit Halten und Sitzen (Kontingent, Sperre, Belegung)                |
| `POST`  | `trips/schedule/preview` | Admin  | Wochenplan durchrechnen ohne zu schreiben, Antwort 200                    |
| `POST`  | `trips/schedule`         | Admin  | Wochenplan veröffentlichen: neue Termine anlegen, vorhandene überspringen |
| `POST`  | `trips/:tripId/cancel`   | Admin  | Fahrt absagen, aktive Buchungen stornieren; Wiederholung ändert nichts    |
| `PUT`   | `trips/:tripId/quota`    | Admin  | Online-Kontingent einzelner Sitze ändern                                  |

Wochenplan (`POST trips/schedule` und `preview`, beide Antwort 200):

```json
{
  "routeId": "…",
  "busId": "…",
  "weekdays": [6, 0, 1, 2, 3, 4, 5],
  "departureTime": "07:00",
  "durationMinutes": 320,
  "from": "2026-11-07",
  "to": "2026-11-13",
  "stopOffsetsMinutes": [120, 190],
  "onlineSeatCount": 36,
  "genderRuleEnabled": true,
  "onlineSalesCloseMinutes": 30
}
```

- Genau eines von `busId` und `seatLayoutId` (sonst `VALIDATION_FAILED` mit `errors[].path =
"busId"`). Mit Bus gilt sein Sitzplan und die Prüfung auf Doppelbelegung; ohne Bus nur der Plan.
- `weekdays`: 0 = Sonntag bis 6 = Samstag, jeder Tag einmal. `departureTime` `HH:MM` (24 Stunden,
  Ortszeit Damaskus) am Starthalt, `durationMinutes` 1 bis 2 880 bis zum letzten Halt. `from` und
  `to` sind Kalendertage in Damaskus, beide eingeschlossen, höchstens 62 Tage
  (`TRIP_SCHEDULE_LIMITS` in `@masar/shared`).
- `stopOffsetsMinutes` (optional): Minuten ab Abfahrt je Zwischenhalt, streng steigend, größer 0
  und kleiner `durationMinutes`; ohne Angabe gleichmäßig verteilt (auf ganze Minuten gerundet). An
  Zwischenhalten sind Ankunft und Abfahrt gleich.
- `onlineSeatCount` (optional): so viele verkaufbare Sitze von vorn nach hinten (Reihe, dann
  Spalte) sind online, der Rest gehört dem Schalter; ohne Angabe alle. `genderRuleEnabled` und
  `onlineSalesCloseMinutes` (0 bis 1 440) ohne Angabe aus den Einstellungen der Firma.
- Antwort (Vorschau und Veröffentlichung gleich): `routeId`, `busId`, `seatLayoutId`, `seatCount`
  (verkaufbare Sitze), `onlineSeats`, `genderRuleEnabled`, `onlineSalesCloseMinutes`,
  `stopOffsetsMinutes`, `items` und `summary: { total, new, existing, busConflicts,
fareMissingDates }`. Je Termin in `items`: `serviceDate`, `departureAt`, `arrivalAt`, `state`,
  `tripId`, `fareMissing` und `stops: [{ seq, arrivalAt, departureAt }]`.
- `state` ist `NEW` (Vorschau: entsteht; Veröffentlichung: angelegt), `EXISTS` (dieselbe Fahrt gibt
  es schon, auch gestrichen: übersprungen) oder `BUS_CONFLICT`. `tripId` ist bei `EXISTS` die
  vorhandene, nach dem Veröffentlichen bei `NEW` die neue Fahrt.
- Dieselbe Fahrt heißt: dieselbe Strecke, dieselbe Abfahrt und derselbe Bus (mit Bus) bzw. ohne Bus
  derselbe Sitzplan. Ein zweiter Aufruf desselben Plans legt deshalb nichts doppelt an; ein
  längerer Zeitraum ergänzt nur die neuen Tage.
- Die Vorschau meldet Tariflücken (`fareMissing`) und Busüberschneidungen (`BUS_CONFLICT`); die
  Veröffentlichung lehnt dann den ganzen Plan ab (`FARE_MISSING_FOR_DATE` mit `params.dates`,
  `BUS_DOUBLE_BOOKED` mit `params.departures`, je höchstens zehn). Beide lehnen ab:
  `TRIP_SCHEDULE_IN_PAST`, `ROUTE_ARCHIVED`, `BUS_INACTIVE`, `SEAT_LAYOUT_RETIRED`,
  `TRIP_STOP_OFFSETS_INVALID` (`params.intermediateStops`), `TRIP_QUOTA_INVALID` (`params.max`),
  `SERVICE_UNAVAILABLE` mit `Retry-After`, wenn Strecke oder Bus zu lange gesperrt sind.
- Lizenz (Schritt 2.7, ADR 0032): Beide Antworten enthalten `license: { status, planningAllowed,
coveredUntil, daysUntilExpiry, graceEndsOn, allowedBuses, activeBuses, busCovered, issue }`. Die
  Vorschau meldet `issue` nur; die Veröffentlichung lehnt dann ab, vor allen anderen Fachfehlern
  außer den Prüfungen von Strecke, Bus und Sitzplan: `LICENSE_EXPIRED` (`params.validUntil`,
  `params.graceEndsOn`) nach der Kulanz, auch ohne Bus; `LICENSE_BUS_LIMIT_EXCEEDED`
  (`params.allowedBuses`, `params.activeBuses`) mit einem Bus, den die Pakete nicht abdecken.

Fahrt in der Antwort: `id`, `status`, `serviceDate`, `departureAt`, `arrivalAt`,
`onlineSalesCloseAt`, `genderRuleEnabled`, `route: { id, nameAr, nameEn }`,
`bus: { id, plate }` oder `null`, `seatLayout: { id, name, version }`,
`quota: { total, online, counter, blocked, occupied }` (Sitze; `occupied` mit aktiver Belegung auf
irgendeiner Teilstrecke) und `activeBookings`. Der Einzelabruf zusätzlich
`stops: [{ id, seq, arrivalAt, departureAt, station, city }]`, `layout: { rows, columns }` und
`seats: [{ seatId, label, row, column, side, isSellable, onlineSellable, blocked, occupied }]`.
Keine Personendaten.

- Liste: `?from=&to=&routeId=&status=&limit=&cursor=`. `from` und `to` sind Kalendertage in
  Damaskus (Standard: heute und 13 Tage danach, höchstens 62 Tage), gefiltert wird die Abfahrt am
  Starthalt. Sortiert nach Abfahrt, dann ID; `limit` 1 bis 200 (Standard 100), `nextCursor` opak
  wie in der Suche.
- Absagen (`cancel`, ohne Body): nur aus `SCHEDULED` (sonst `INVALID_STATE_TRANSITION`). Antwort
  `{ "trip": { … }, "cancelledBookings": 2 }`. Jede aktive Buchung wird von der Firma storniert
  (`cancelledBy = COMPANY`, Grund `TRIP_CANCELLED`, ohne Gebühr), mit Storno-E-Mail. Erstattungen
  folgen mit den Zahlungen (Phase 3).
- Kontingent (`PUT quota`): `{ "seats": [{ "seatId": "…", "onlineSellable": false }] }`, 1 bis
  200 Einträge. Nur Fahrten im Verkauf (`SCHEDULED`, noch nicht abgefahren, sonst
  `TRIP_NOT_BOOKABLE`); fremde Sitze `SEAT_UNKNOWN` (`params.seatIds`); ein belegter Sitz wechselt
  den Kanal nicht (`TRIP_SEAT_OCCUPIED` mit `params.seats`). Antwort wie der Einzelabruf.

### Buchungen im Portal

Schritt 2.5, ADR 0028; fachliche Regeln im [Domänenmodell, Umsetzung 2.5](domaenenmodell.md#umsetzung-25).
Alle Pfade unter `/companies/:companyId/`. Buchungen lesen und bearbeiten `ADMIN` und `AGENT`; die
Fahrgastliste sehen zusätzlich `DRIVER`. Eine fremde Firma im Pfad ergibt `FORBIDDEN`, eine Buchung
einer anderen Firma unter der eigenen `BOOKING_NOT_FOUND`, eine fremde Fahrt `TRIP_NOT_FOUND`.

| Methode | Pfad                                 | Zugang                     | Zweck                                                          |
| ------- | ------------------------------------ | -------------------------- | -------------------------------------------------------------- |
| `GET`   | `bookings`                           | Admin, Agent               | Liste nach Abfahrt mit Filtern und Cursor                      |
| `GET`   | `bookings/:bookingId`                | Admin, Agent               | Detail mit Fahrgästen, Zahlungsstand, Tickets und Verlauf      |
| `POST`  | `bookings/:bookingId/reveal-contact` | Admin, Agent; 30 je Minute | Telefon und E-Mail im Klartext, mit Audit-Eintrag; Antwort 200 |
| `GET`   | `trips/:tripId/passengers`           | Admin, Agent, Fahrer       | Fahrgastliste einer Fahrt nach Sitz                            |

Liste: `?tripId=&from=&to=&status=&paymentMethod=&channel=&q=&limit=&cursor=`

| Parameter       | Regel                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `tripId`        | nur Buchungen dieser Fahrt                                                                                               |
| `from`, `to`    | Kalendertage in Damaskus, beide eingeschlossen; gefiltert wird die Abfahrt der Fahrt am Starthalt                        |
| `status`        | wie im Detail sichtbar: Holds und Reservierungen nach Fristende sind `EXPIRED`                                           |
| `paymentMethod` | `CASH`, `WALLET_TRANSFER`, `ECASH`, `INTL_CARD`                                                                          |
| `channel`       | `ONLINE`, `COUNTER`, `ADMIN`                                                                                             |
| `q`             | Anfang des Buchungscodes (4 bis 8 Zeichen) oder Ende der Telefonnummer (3 bis 9 Ziffern), sonst `BOOKING_SEARCH_INVALID` |
| `limit`         | 1 bis 200 (Standard 50)                                                                                                  |
| `cursor`        | `nextCursor` der vorigen Seite, opak; ungültig ergibt `VALIDATION_FAILED` (`custom`)                                     |

- Ohne `tripId`, `from`, `to` und `q`: Abfahrten ab heute (Damaskus), Ende offen. Mit Fahrt oder
  Suchtext ist der Zeitraum offen. Sortiert nach Abfahrt der Fahrt, dann Buchungs-ID.
- `q` wird wie ein Buchungscode bereinigt (Leerraum, Bindestriche, arabische Ziffern; I und L als
  1, O als 0). Nur Ziffern suchen zusätzlich im Ende der Telefonnummer; eine ganze Nummer
  (`0933 123 456`, `+963…`) zählt mit ihren letzten neun Ziffern. Namen und Ausweisnummern sind
  nicht durchsuchbar. `q` ist eine dokumentierte Ausnahme der URL-Regel (ADR 0028): Die API loggt
  ihn nicht, die Oberfläche hält ihn nicht in der Seitenadresse.
- Eintrag: `id`, `bookingCode`, `status`, `channel`, `paymentMethod`, `paymentState`,
  `trip: { id, departureAt, status, route: { id, nameAr, nameEn } }`, `from` und `to` (`tripStopId`,
  `seq`, `nameAr`, `nameEn`, `arrivalAt`, `departureAt`), `contact: { name, phoneMasked }`,
  `passengerCount`, `total`, `holdExpiresAt`, `deadlineAt`, `createdAt`.
- `paymentState`: `UNPAID` (Hold), `CASH_DUE` (Barreservierung bis `deadlineAt`), `IN_REVIEW`
  (Zahlung in Prüfung), `PAID` (bezahlt; bleibt nach Storno, Erstattungen ab Phase 3), `NONE`
  (storniert oder abgelaufen ohne Zahlung). Ohne `payment`-Zeilen folgt er aus Status und
  Bestätigung.
- `phoneMasked`: Vorwahl, erste und letzte drei Ziffern, z. B. `+963 9** *** 456`.

Detail (`GET bookings/:bookingId`, auch die Antwort von `lookup`, `confirm-cash` und `cancel`): wie
der Listeneintrag, dazu `locale`, `trip.arrivalAt`, `trip.bus` (`{ id, plate }` oder `null`),
`fare`, `contact: { name, phoneMasked, hasEmail, purged }`,
`passengers: [{ id, seatId, seatLabel, fullName, gender, nationalIdPresent, status, ticketStatus }]`
(nach Sitz), `tickets: [{ id, passengerId, seatLabel, status }]`,
`payments: [{ id, method, status, amount, createdAt, confirmedAt }]` (bis Phase 3 leer),
`history: [{ at, action, actorType, actorUserId, fromStatus, toStatus, reason }]` (ältester zuerst),
`confirmedAt`, `cancelledAt`, `cancelledBy`, `cancelReason`.

- Die Ausweisnummer erscheint nie, auch nicht ihre letzten Ziffern; nur `nationalIdPresent`.
- `history` stammt aus dem Audit-Log: `actorType` `USER` (mit `actorUserId`), `GUEST` oder
  `SYSTEM`; `reason` nur als Code. Auch `BOOKING_CONTACT_REVEALED` steht darin.

Kontakt (`POST bookings/:bookingId/reveal-contact`, ohne Body): `{ "phone": "+963933123456",
"email": null }`. Vorher schreibt die API `BOOKING_CONTACT_REVEALED` ins Audit-Log (Person, Firma,
Buchung als IDs, `data.fields`). Nach der Löschfrist (`contact.purged`) steht dort der
pseudonymisierte Wert.

Fahrgastliste (`GET trips/:tripId/passengers`): `trip: { id, status, departureAt, arrivalAt, route,
bus, stops }`, `items` und `summary: { passengers, paid, open, perStop: [{ tripStopId, boarding,
alighting }] }`. Je Eintrag `passengerId`, `bookingId`, `seatId`, `seatLabel`, `fullName`,
`gender`, `nationalIdPresent`, `bookingStatus`, `channel`, `paymentState`, `ticketStatus`, `from`,
`to`. Nur aktive Fahrgäste aktiver, nicht abgelaufener Buchungen, nach Sitz (Reihe, Spalte), dann
Einstieg. Ohne Telefon, E-Mail und Buchungscode; nicht paginiert.

### Schalter

Schritt 2.6, ADR 0030; fachliche Regeln im [Domänenmodell, Umsetzung 2.6](domaenenmodell.md#umsetzung-26).
Alle Pfade unter `/companies/:companyId/`, nur `ADMIN` und `AGENT` (Fahrer `FORBIDDEN`). Eine Fahrt
einer anderen Firma ist `TRIP_NOT_FOUND`, eine Buchung einer anderen Firma `BOOKING_NOT_FOUND`.

| Methode | Pfad                             | Zweck                                                                       |
| ------- | -------------------------------- | --------------------------------------------------------------------------- |
| `GET`   | `trips/:tripId/counter-seat-map` | alle Sitze mit Kontingent und Belegung je Teilstrecke                       |
| `POST`  | `counter/quote`                  | Preis und Sitzprüfung ohne Schreiben; Antwort 200                           |
| `POST`  | `counter/sales`                  | Barverkauf, sofort bestätigt; 201 neu, 200 Wiederholung (`Idempotency-Key`) |
| `GET`   | `bookings/:bookingId/ticket`     | Ticketseite mit QR-Tokens zum Drucken (wie `GET /bookings/:id/ticket`)      |

- Sitzplan: `?fromStopId=&toStopId=` optional (ohne Angabe die ganze Fahrt). Antwort `trip` (mit
  `stops`, `route`, `bus`), `from`, `to`, `fare` (oder `null` ohne Tarif), `salesOpen` (geplant und
  vor der Abfahrt), `genderRuleEnabled`, `nationalIdRequired`, `layout`, `summary: { free, taken,
blocked, counterOnly }` und `seats: [{ seatId, label, row, column, side, quota, state,
occupiedRanges, selectableFor }]`. `quota`: `ONLINE`, `COUNTER`, `BLOCKED`; `state` für die
  Teilstrecke: `FREE`, `TAKEN`, `BLOCKED`; `occupiedRanges`: belegte Teilstrecken der ganzen Fahrt
  als `[{ fromSeq, toSeq }]` (zusammengefasst); `selectableFor: { FEMALE, MALE }` nur bei freien
  Sitzen und aktiver Geschlechtsregel, sonst `null`. Keine Namen, Kontaktdaten oder Geschlechter.
- Vorschau: `{ tripId, fromStopId, toStopId, seats: [{ seatId, gender? }] }`; Antwort `{ tripId,
fromStopId, toStopId, seats: [{ seatId, label }], fare, total }`. Dieselben Fehler wie der
  Verkauf; die Geschlechtsregel nur, wenn jeder Sitz ein Geschlecht trägt.
- Verkauf: Body wie `POST /bookings`. Antwort `{ booking }` im Format des Details aus „Buchungen im
  Portal" (`status: CONFIRMED`, `channel: COUNTER`, `paymentMethod: CASH`, `paymentState: PAID`,
  Tickets `ISSUED`). Kein Verwaltungstoken. Wie online: `INVALID_SEGMENT`, `NO_FARE_FOR_SEGMENT`,
  `SEAT_UNKNOWN`, `SEAT_BLOCKED`, `SEAT_TAKEN`, `GENDER_REQUIRED`, `GENDER_RULE_CONFLICT`,
  `NATIONAL_ID_REQUIRED`, `TOO_MANY_SEATS`, `TRIP_NOT_BOOKABLE`; anders als online verkauft der
  Schalter auch Sitze außerhalb des Online-Kontingents, ohne Grenze offener Buchungen je Telefon und
  bis zur Abfahrt (danach `SALES_CLOSED`). `IDEMPOTENCY_KEY_REUSED`, wenn der Schlüssel zu einer
  anderen Anfrage, einer anderen Firma oder einer Online-Buchung gehört (umgekehrt ebenso).
- Storno über `POST bookings/:bookingId/cancel` (Buchungen im Portal).

### Lizenz

Schritt 2.7, ADR 0029 und 0032; fachliche Regeln im [Domänenmodell, Umsetzung 2.7](domaenenmodell.md#umsetzung-27).
Preise und Rechnungen stehen nicht im System.

| Methode | Pfad                                         | Zugang                                          | Zweck                                                |
| ------- | -------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `GET`   | `/api/v1/companies/:companyId/license`       | Admin, Agent, Fahrer der Firma; Plattform-Admin | Lizenzstand zum heutigen Tag in Damaskus             |
| `GET`   | `/api/v1/admin/companies`                    | Plattform-Admin                                 | alle Firmen mit Lizenzstand                          |
| `GET`   | `/api/v1/admin/companies/:companyId/license` | Plattform-Admin                                 | Stand mit allen Zeiträumen und interner Notiz        |
| `POST`  | `/api/v1/admin/companies/:companyId/license` | Plattform-Admin                                 | neuer Zeitraum (setzen oder verlängern), Antwort 201 |
| `PUT`   | `/api/v1/admin/companies/:companyId/license` | Plattform-Admin                                 | Zeitraum ändern (Pakete, Beginn, Ende, Plan, Notiz)  |

- Alle Routen unter `/admin` verlangen `isPlatformAdmin` (sonst `FORBIDDEN`, auch für Firmen-Admins);
  ein Test hält das für jede Route fest. Eine unbekannte Firma ergibt `NOT_FOUND`.
- Stand (`GET …/license`): `companyId`, `today`, `status` (`ACTIVE`, `EXPIRING_SOON` ab 30 Tagen,
  `EXPIRING_VERY_SOON` ab 7, `GRACE` bis Tag 14 nach dem letzten gültigen Tag, `EXPIRED`), `plan`
  (`FOUNDING`, `ONE_YEAR`, `TWO_YEARS`), `validFrom`, `validUntil` (des heutigen bzw. zuletzt
  abgelaufenen Zeitraums, Tage eingeschlossen), `coveredUntil` (Ende der lückenlosen Kette mit
  eingetragenen Verlängerungen), `daysUntilExpiry` (0 am letzten gültigen Tag, negativ danach),
  `graceEndsOn`, `planningAllowed`, `busPackages`, `allowedBuses` (5 je Paket), `activeBuses`,
  `busesOverLimit`, `upcoming` (Zeitraum nach einer Lücke oder `null`) und
  `periods: [{ plan, validFrom, validUntil, busPackages }]`. Keine Notiz.
- Admin-Sicht: dazu `company`, `periodId` (Ziel eines `PUT` ohne `periodId`) und je Zeitraum `id`,
  `notes`, `createdByUserId`, `createdAt`, `updatedAt`. Liste: `items: [{ id, slug, nameAr, nameEn,
status, license: { status, plan, validUntil, coveredUntil, daysUntilExpiry, busPackages,
allowedBuses, activeBuses } }]`.
- `POST`: `{ "plan": "ONE_YEAR", "validFrom"?: "2027-05-04", "validUntil"?: "2028-05-03",
"busPackages"?: 2, "notes"?: "…" }`. Ohne `validFrom` schließt der Zeitraum an den laufenden oder in
  der Kulanz liegenden an, sonst beginnt er heute; ohne `validUntil` gilt die Laufzeit des Plans (6, 12
  oder 24 Monate minus ein Tag); ohne `busPackages` die des letzten Zeitraums.
- `PUT`: `{ "periodId"?, "plan"?, "validFrom"?, "validUntil"?, "busPackages"?, "notes"? }`, mindestens
  ein Feld außer `periodId`. Ohne `periodId` der heute geltende, sonst der zuletzt abgelaufene
  Zeitraum (`LICENSE_NOT_FOUND`, wenn es keinen gibt oder die ID zu einer anderen Firma gehört).
  `notes: ""` oder `null` löscht die Notiz.
- `busPackages` 1 bis 100, `notes` höchstens 200 Zeichen (`LICENSE_RULES` in `@masar/shared`). Ende
  vor Beginn: `VALIDATION_FAILED` mit `errors[].path = "validUntil"`, `rule = "custom"`. Überschneidung
  mit einem anderen Zeitraum der Firma: `LICENSE_PERIOD_OVERLAP`.
- Jede Änderung schreibt `LICENSE_PERIOD_CREATED` bzw. `LICENSE_PERIOD_UPDATED` ins Audit-Log
  (Person, Firma, Zeitraum als IDs, geänderte Werte als Zahlen und Tage, `notesChanged`), nie die Notiz.

### Fehlerberichte aus dem Browser

```json
{
  "app": "web",
  "kind": "error",
  "message": "Cannot read properties of undefined (reading 'seats')",
  "stack": "TypeError: …",
  "path": "/ar/t/:param"
}
```

- `app`: `web` oder `portal`; `kind`: `error` oder `unhandledrejection`.
- Höchstlängen: `message` 500, `stack` 4000 (optional), `path` 300 Zeichen
  (`CLIENT_ERROR_LIMITS` in `@masar/shared`).
- Die API bereinigt Pfad, Meldung und Stacktrace vor dem Loggen, auch wenn der Browser schon
  bereinigt hat.
- Über alle Absender gilt zusätzlich eine Grenze von 120 Berichten je Minute. Darüber verwirft die
  API Berichte und antwortet trotzdem 204; Clients wiederholen nicht.

## Fehlerformat (RFC 9457)

Fehler kommen als `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "code": "SEAT_TAKEN",
  "detail": "One or more seats are already taken on an overlapping segment.",
  "instance": "urn:uuid:0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12",
  "params": { "seats": ["12"] }
}
```

- `code` ist das stabile Merkmal. Das Frontend übersetzt ihn; Clients werten nie `title` oder
  `detail` aus.
- `title` und `detail` sind englisch und für Entwickler gedacht. Sie enthalten nie personenbezogene
  Daten.
- `instance` enthält die Request-ID, damit sich ein Fehler im Log wiederfinden lässt.
- `params` enthält nur unkritische Werte, die der Text braucht (z. B. Sitzbeschriftungen).
- Bei `VALIDATION_FAILED` beschreibt `errors` jede verletzte Regel, z. B.
  `[{ "path": "passengers.0.gender", "rule": "invalid_type" }]`. `rule` ist der Code des Validators
  (Zod: `invalid_type`, `too_small`, `too_big`, `invalid_format`, `invalid_value`); fehlende Felder
  erscheinen als `invalid_type`. Kaputtes JSON ergibt `VALIDATION_FAILED` ohne `errors`.
- Stacktraces und interne Meldungen erreichen den Client nie.
- Technische Fehler ohne eigenen Code werden über ihren HTTP-Status abgebildet; unbekannte 4xx-Status
  ergeben einheitlich `VALIDATION_FAILED` mit Status 400.

Ein Code wird nie umbenannt oder mit anderer Bedeutung wiederverwendet. Neue Codes werden zuerst hier
und in `packages/shared/src/errors.ts` ergänzt.

## Fehlercodes

### Allgemein

| Code                     | HTTP | Bedeutung                                                |
| ------------------------ | ---- | -------------------------------------------------------- |
| `VALIDATION_FAILED`      | 400  | Eingabe verletzt das Schema; Details in `errors`         |
| `UNAUTHENTICATED`        | 401  | keine oder abgelaufene Sitzung                           |
| `FORBIDDEN`              | 403  | angemeldet, aber ohne Berechtigung                       |
| `NOT_FOUND`              | 404  | Ressource unbekannt oder für diese Person nicht sichtbar |
| `UNSUPPORTED_MEDIA_TYPE` | 415  | zustandsändernde Anfrage mit Body, der kein JSON ist     |
| `RATE_LIMITED`           | 429  | zu viele Anfragen; `Retry-After` beachten                |
| `INTERNAL_ERROR`         | 500  | unerwarteter Fehler; Request-ID für die Untersuchung     |
| `SERVICE_UNAVAILABLE`    | 503  | vorübergehend nicht verfügbar; `Retry-After` beachten    |

### Anmeldung

| Code                     | HTTP | Bedeutung                                                                  |
| ------------------------ | ---- | -------------------------------------------------------------------------- |
| `INVALID_CREDENTIALS`    | 401  | E-Mail oder Passwort falsch oder Konto in Wartezeit; verrät nicht, welches |
| `LOGIN_THROTTLED`        | 429  | reserviert, derzeit nicht ausgegeben (ADR 0009, Nachtrag 2026-11-02)       |
| `INVITATION_INVALID`     | 400  | Einladung unbekannt, abgelaufen oder bereits benutzt                       |
| `PASSWORD_RESET_INVALID` | 400  | Reset-Link unbekannt, abgelaufen oder bereits benutzt                      |

### Firmen und Mitglieder

| Code             | HTTP | Bedeutung                                              |
| ---------------- | ---- | ------------------------------------------------------ |
| `ALREADY_MEMBER` | 409  | die eingeladene Adresse ist bereits Mitglied der Firma |

### Fahrten und Suche

| Code                  | HTTP | Bedeutung                                                          |
| --------------------- | ---- | ------------------------------------------------------------------ |
| `TRIP_NOT_FOUND`      | 404  | Fahrt unbekannt                                                    |
| `TRIP_NOT_BOOKABLE`   | 409  | Fahrt nicht im Verkauf (Entwurf, abgefahren, gestrichen)           |
| `SALES_CLOSED`        | 409  | Verkauf beendet (online zum Verkaufsschluss, Schalter zur Abfahrt) |
| `INVALID_SEGMENT`     | 400  | Einstieg liegt nicht vor dem Ausstieg oder nicht auf der Fahrt     |
| `NO_FARE_FOR_SEGMENT` | 409  | für dieses Haltestellenpaar gibt es keinen gültigen Tarif          |

### Buchung

| Code                       | HTTP | Bedeutung                                                                               |
| -------------------------- | ---- | --------------------------------------------------------------------------------------- |
| `SEAT_UNKNOWN`             | 400  | Sitz gehört nicht zum Sitzplan der Fahrt                                                |
| `SEAT_TAKEN`               | 409  | Sitz auf einem überlappenden Segment belegt; `params.seats`                             |
| `SEAT_NOT_ONLINE`          | 409  | Sitz ist nicht im Online-Kontingent                                                     |
| `SEAT_BLOCKED`             | 409  | Sitz ist von der Firma gesperrt                                                         |
| `GENDER_REQUIRED`          | 400  | Fahrt nutzt die Geschlechtsregel, Angabe fehlt                                          |
| `GENDER_RULE_CONFLICT`     | 409  | Sitz ist für diesen Fahrgast nicht wählbar; `params.seats`                              |
| `NATIONAL_ID_REQUIRED`     | 400  | Firma verlangt eine Ausweisnummer                                                       |
| `TOO_MANY_SEATS`           | 400  | mehr Sitze als erlaubt in einer Buchung                                                 |
| `TOO_MANY_OPEN_HOLDS`      | 409  | zu viele offene Reservierungen für diese Telefonnummer                                  |
| `HOLD_EXPIRED`             | 409  | die befristete Reservierung ist abgelaufen                                              |
| `BOOKING_NOT_FOUND`        | 404  | Code und Telefon oder Token passen zu keiner Buchung (gleiche Antwort)                  |
| `BOOKING_NOT_CANCELLABLE`  | 409  | Storno nach Frist, nach Check-in oder durch Firmenregel ausgeschlossen                  |
| `INVALID_STATE_TRANSITION` | 409  | Aktion passt nicht zum aktuellen Status                                                 |
| `CASH_DEADLINE_PASSED`     | 409  | Barreservierung nicht mehr möglich, die Barfrist der Fahrt ist vorbei                   |
| `IDEMPOTENCY_KEY_REUSED`   | 409  | `Idempotency-Key` gehört zu einer anderen Anfrage (Fahrt, Strecke, Sitze, Kanal, Firma) |
| `BOOKING_SEARCH_INVALID`   | 400  | Suchtext ist weder Anfang eines Buchungscodes noch Ende einer Telefonnummer             |

### Flotte

| Code                     | HTTP | Bedeutung                                                                  |
| ------------------------ | ---- | -------------------------------------------------------------------------- |
| `SEAT_LAYOUT_NOT_FOUND`  | 404  | Sitzplan unbekannt oder gehört zu einer anderen Firma                      |
| `SEAT_LAYOUT_NAME_TAKEN` | 409  | die Firma hat schon einen Sitzplan mit diesem Namen                        |
| `SEAT_LAYOUT_IN_USE`     | 409  | Sitzplan wird von einer Fahrt genutzt und ist unveränderlich; neue Version |
| `SEAT_LAYOUT_RETIRED`    | 409  | Sitzplan ist archiviert: nicht mehr änderbar, keine neuen Busse            |
| `BUS_NOT_FOUND`          | 404  | Bus unbekannt oder gehört zu einer anderen Firma                           |
| `BUS_PLATE_TAKEN`        | 409  | die Firma hat schon einen Bus mit diesem Kennzeichen                       |
| `BUS_IN_USE`             | 409  | Sitzplan des Busses nicht änderbar, weil Fahrten den Bus nutzen            |

### Strecken und Tarife

| Code                            | HTTP | Bedeutung                                                                              |
| ------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| `ROUTE_NOT_FOUND`               | 404  | Strecke unbekannt oder gehört zu einer anderen Firma                                   |
| `ROUTE_IN_USE`                  | 409  | Fahrten nutzen die Strecke; Halte und Stornoregel sind eingefroren                     |
| `ROUTE_ARCHIVED`                | 409  | Strecke ist archiviert und nicht mehr änderbar                                         |
| `ROUTE_STOP_DUPLICATE`          | 400  | eine Haltestelle steht mehrfach auf der Strecke                                        |
| `STATION_NOT_FOUND`             | 404  | Haltestelle unbekannt oder eigene Haltestelle einer anderen Firma                      |
| `CITY_NOT_FOUND`                | 404  | Stadt unbekannt                                                                        |
| `CANCELLATION_POLICY_NOT_FOUND` | 404  | Stornoregel unbekannt oder gehört zu einer anderen Firma                               |
| `CANCELLATION_RULES_INVALID`    | 400  | Schwelle doppelt oder Gebühr sinkt, je näher die Abfahrt                               |
| `FARE_MATRIX_INCOMPLETE`        | 400  | Preis für mindestens eine Teilstrecke fehlt; `params.missing`                          |
| `FARE_MATRIX_INVALID`           | 400  | Paar gegen die Fahrtrichtung, außerhalb der Strecke oder doppelt; `params.pairs`       |
| `FARE_NOT_MONOTONIC`            | 400  | Preis kleiner als der einer enthaltenen Teilstrecke; `params.pair`, `params.contained` |
| `FARE_VALID_FROM_PAST`          | 400  | neuer Tarifstand beginnt vor heute (Damaskus)                                          |

### Fahrtplanung

| Code                        | HTTP | Bedeutung                                                                      |
| --------------------------- | ---- | ------------------------------------------------------------------------------ |
| `TRIP_SCHEDULE_IN_PAST`     | 400  | Wochenplan beginnt vor heute (Damaskus) oder eine Abfahrt ist schon vorbei     |
| `TRIP_STOP_OFFSETS_INVALID` | 400  | Zeiten der Zwischenhalte passen nicht zur Strecke oder zur Fahrzeit            |
| `TRIP_QUOTA_INVALID`        | 400  | mehr Online-Sitze als verkaufbare Sitze; `params.max`                          |
| `FARE_MISSING_FOR_DATE`     | 409  | für einen Fahrtag fehlt ein Tarif mindestens einer Teilstrecke; `params.dates` |
| `BUS_INACTIVE`              | 409  | der Bus ist deaktiviert und nimmt keine neuen Fahrten an                       |
| `BUS_DOUBLE_BOOKED`         | 409  | der Bus ist zu dieser Zeit schon unterwegs; `params.departures`                |
| `TRIP_SEAT_OCCUPIED`        | 409  | ein belegter Sitz wechselt nicht zwischen online und Schalter; `params.seats`  |

### Lizenz

| Code                         | HTTP | Bedeutung                                                                                      |
| ---------------------------- | ---- | ---------------------------------------------------------------------------------------------- |
| `LICENSE_EXPIRED`            | 403  | Lizenz samt Kulanz abgelaufen: keine neuen Fahrten; `params.validUntil`, `params.graceEndsOn`  |
| `LICENSE_BUS_LIMIT_EXCEEDED` | 403  | der gewählte Bus liegt über den gebuchten Paketen; `params.allowedBuses`, `params.activeBuses` |
| `LICENSE_NOT_FOUND`          | 404  | die Firma hat keinen Lizenzzeitraum, der sich ändern ließe                                     |
| `LICENSE_PERIOD_OVERLAP`     | 409  | der Zeitraum überschneidet sich mit einem anderen Lizenzzeitraum der Firma                     |

### Geplant

Zahlungen (Phase 3): `PAYMENT_PROVIDER_UNAVAILABLE` (503), `WALLET_REFERENCE_ALREADY_USED` (409),
`WEBHOOK_SIGNATURE_INVALID` (401). Sie werden mit der Umsetzung in die Liste oben übernommen.
