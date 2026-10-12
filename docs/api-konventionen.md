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
Code und Telefon im Body gesucht, nicht per Query-Parameter.

## Authentifizierung

- Web und Portal: Cookie `__Host-masar_session` (`Secure`, `HttpOnly`, `SameSite=Lax`).
- Spätere native App: `Authorization: Bearer <token>`, derselbe Guard.
- Zustandsändernde Aufrufe akzeptieren nur `application/json` und prüfen `Origin` gegen eine
  Allowlist.

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

| Code                  | HTTP | Bedeutung                                                |
| --------------------- | ---- | -------------------------------------------------------- |
| `VALIDATION_FAILED`   | 400  | Eingabe verletzt das Schema; Details in `errors`         |
| `UNAUTHENTICATED`     | 401  | keine oder abgelaufene Sitzung                           |
| `FORBIDDEN`           | 403  | angemeldet, aber ohne Berechtigung                       |
| `NOT_FOUND`           | 404  | Ressource unbekannt oder für diese Person nicht sichtbar |
| `RATE_LIMITED`        | 429  | zu viele Anfragen; `Retry-After` beachten                |
| `INTERNAL_ERROR`      | 500  | unerwarteter Fehler; Request-ID für die Untersuchung     |
| `SERVICE_UNAVAILABLE` | 503  | vorübergehend nicht verfügbar; `Retry-After` beachten    |

### Anmeldung

| Code                     | HTTP | Bedeutung                                             |
| ------------------------ | ---- | ----------------------------------------------------- |
| `INVALID_CREDENTIALS`    | 401  | E-Mail oder Passwort falsch; verrät nicht, welches    |
| `LOGIN_THROTTLED`        | 429  | zu viele Fehlversuche; Wartezeit in `Retry-After`     |
| `INVITATION_INVALID`     | 400  | Einladung unbekannt, abgelaufen oder bereits benutzt  |
| `PASSWORD_RESET_INVALID` | 400  | Reset-Link unbekannt, abgelaufen oder bereits benutzt |

### Fahrten und Suche

| Code                  | HTTP | Bedeutung                                                      |
| --------------------- | ---- | -------------------------------------------------------------- |
| `TRIP_NOT_FOUND`      | 404  | Fahrt unbekannt                                                |
| `TRIP_NOT_BOOKABLE`   | 409  | Fahrt nicht im Verkauf (Entwurf, abgefahren, gestrichen)       |
| `SALES_CLOSED`        | 409  | Online-Verkauf für diese Fahrt beendet                         |
| `INVALID_SEGMENT`     | 400  | Einstieg liegt nicht vor dem Ausstieg oder nicht auf der Fahrt |
| `NO_FARE_FOR_SEGMENT` | 409  | für dieses Haltestellenpaar gibt es keinen gültigen Tarif      |

### Buchung

| Code                       | HTTP | Bedeutung                                                                   |
| -------------------------- | ---- | --------------------------------------------------------------------------- |
| `SEAT_UNKNOWN`             | 400  | Sitz gehört nicht zum Sitzplan der Fahrt                                    |
| `SEAT_TAKEN`               | 409  | Sitz auf einem überlappenden Segment belegt; `params.seats`                 |
| `SEAT_NOT_ONLINE`          | 409  | Sitz ist nicht im Online-Kontingent                                         |
| `SEAT_BLOCKED`             | 409  | Sitz ist von der Firma gesperrt                                             |
| `GENDER_REQUIRED`          | 400  | Fahrt nutzt die Geschlechtsregel, Angabe fehlt                              |
| `GENDER_RULE_CONFLICT`     | 409  | Sitz ist für diesen Fahrgast nicht wählbar; `params.seats`                  |
| `NATIONAL_ID_REQUIRED`     | 400  | Firma verlangt eine Ausweisnummer                                           |
| `TOO_MANY_SEATS`           | 400  | mehr Sitze als erlaubt in einer Buchung                                     |
| `TOO_MANY_OPEN_HOLDS`      | 409  | zu viele offene Reservierungen für diese Telefonnummer                      |
| `HOLD_EXPIRED`             | 409  | die befristete Reservierung ist abgelaufen                                  |
| `BOOKING_NOT_FOUND`        | 404  | Code und Telefon passen zu keiner Buchung (gleiche Antwort für beide Fälle) |
| `BOOKING_NOT_CANCELLABLE`  | 409  | Storno nach Frist, nach Check-in oder durch Firmenregel ausgeschlossen      |
| `INVALID_STATE_TRANSITION` | 409  | Aktion passt nicht zum aktuellen Status                                     |

### Geplant

Zahlungen (Phase 3): `PAYMENT_PROVIDER_UNAVAILABLE` (503), `WALLET_REFERENCE_ALREADY_USED` (409),
`WEBHOOK_SIGNATURE_INVALID` (401). Sie werden mit der Umsetzung in die Liste oben übernommen.
