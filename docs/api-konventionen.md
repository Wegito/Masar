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
Code und Telefon im Body gesucht, nicht per Query-Parameter. Einzige Ausnahme: das selbst gewählte
Geschlecht in der anonymen Sitzplan-Abfrage (ADR 0019).

## Authentifizierung

- Web und Portal: Cookie `__Host-masar_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`).
- Spätere native App: `Authorization: Bearer <token>`, derselbe Guard.
- Jede Route verlangt eine Sitzung, außer sie ist ausdrücklich öffentlich (Liste unten).
- Routen einer Firma tragen die Firma im Pfad (`/companies/:companyId/...`). Die API prüft die
  Mitgliedschaft und Rolle; eine fremde Firma ergibt `FORBIDDEN`.
- Zustandsändernde Anfragen mit Body müssen JSON sein (sonst `UNSUPPORTED_MEDIA_TYPE`). Schickt der
  Browser einen `Origin`, muss er erlaubt sein (sonst `FORBIDDEN`).

## Endpunkte

Stand Schritt 1.4.

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
  anderen Firma ist `BOOKING_NOT_FOUND`, eine fremde Firma im Pfad `FORBIDDEN`.

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
- Grenzen: 5 Anfragen je Minute und IP, 10 Versuche je Code und Stunde über alle IPs, auch für
  unbekannte Codes. Darüber 429 `RATE_LIMITED` mit `Retry-After`.

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

| Code                  | HTTP | Bedeutung                                                      |
| --------------------- | ---- | -------------------------------------------------------------- |
| `TRIP_NOT_FOUND`      | 404  | Fahrt unbekannt                                                |
| `TRIP_NOT_BOOKABLE`   | 409  | Fahrt nicht im Verkauf (Entwurf, abgefahren, gestrichen)       |
| `SALES_CLOSED`        | 409  | Online-Verkauf für diese Fahrt beendet                         |
| `INVALID_SEGMENT`     | 400  | Einstieg liegt nicht vor dem Ausstieg oder nicht auf der Fahrt |
| `NO_FARE_FOR_SEGMENT` | 409  | für dieses Haltestellenpaar gibt es keinen gültigen Tarif      |

### Buchung

| Code                       | HTTP | Bedeutung                                                                    |
| -------------------------- | ---- | ---------------------------------------------------------------------------- |
| `SEAT_UNKNOWN`             | 400  | Sitz gehört nicht zum Sitzplan der Fahrt                                     |
| `SEAT_TAKEN`               | 409  | Sitz auf einem überlappenden Segment belegt; `params.seats`                  |
| `SEAT_NOT_ONLINE`          | 409  | Sitz ist nicht im Online-Kontingent                                          |
| `SEAT_BLOCKED`             | 409  | Sitz ist von der Firma gesperrt                                              |
| `GENDER_REQUIRED`          | 400  | Fahrt nutzt die Geschlechtsregel, Angabe fehlt                               |
| `GENDER_RULE_CONFLICT`     | 409  | Sitz ist für diesen Fahrgast nicht wählbar; `params.seats`                   |
| `NATIONAL_ID_REQUIRED`     | 400  | Firma verlangt eine Ausweisnummer                                            |
| `TOO_MANY_SEATS`           | 400  | mehr Sitze als erlaubt in einer Buchung                                      |
| `TOO_MANY_OPEN_HOLDS`      | 409  | zu viele offene Reservierungen für diese Telefonnummer                       |
| `HOLD_EXPIRED`             | 409  | die befristete Reservierung ist abgelaufen                                   |
| `BOOKING_NOT_FOUND`        | 404  | Code und Telefon oder Token passen zu keiner Buchung (gleiche Antwort)       |
| `BOOKING_NOT_CANCELLABLE`  | 409  | Storno nach Frist, nach Check-in oder durch Firmenregel ausgeschlossen       |
| `INVALID_STATE_TRANSITION` | 409  | Aktion passt nicht zum aktuellen Status                                      |
| `CASH_DEADLINE_PASSED`     | 409  | Barreservierung nicht mehr möglich, die Barfrist der Fahrt ist vorbei        |
| `IDEMPOTENCY_KEY_REUSED`   | 409  | `Idempotency-Key` gehört zu einer Buchung mit anderer Fahrt, Strecke, Sitzen |

### Geplant

Zahlungen (Phase 3): `PAYMENT_PROVIDER_UNAVAILABLE` (503), `WALLET_REFERENCE_ALREADY_USED` (409),
`WEBHOOK_SIGNATURE_INVALID` (401). Sie werden mit der Umsetzung in die Liste oben übernommen.
