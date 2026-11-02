# ADR 0020: Gastzugriff auf Buchungen über ein Verwaltungstoken

Status: Angenommen · Datum: 2026-11-02 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 1.3, Entscheidungen übertragen)

## Kontext

Fahrgäste buchen ohne Konto (ADR 0009). Nach dem Hold muss derselbe Browser die Buchung weiterführen
können: Barzahlung wählen, stornieren, den Stand abrufen. ADR 0009 nennt zwei Zugänge: Buchungscode
plus Telefonnummer (ergibt ein kurzlebiges Token) oder einen Verwaltungslink mit 128-Bit-Geheimnis,
von dem nur der Hash gespeichert wird. Das Schema hat dafür `booking.manage_token_hash` (Schritt 1.1).

Fakten zum Ist-Zustand (2026-11-02):

- Die Suche nach Code und Telefon (`POST /bookings/lookup`) gehört zur Ticketseite (Schritt 1.4).
- Buchungscodes und Tokens dürfen nie in URLs oder Logs stehen (AGENTS.md, ADR 0016). Der HTTP-Logger
  schreibt nur Methode und Pfad (`apps/api/src/common/logging.ts`).
- `POST /bookings` verlangt einen `Idempotency-Key` (API-Konventionen). Eine Wiederholung soll
  dieselbe Antwort liefern; das Token selbst ist aber nur als Hash gespeichert.
- Das QR-Token eines Tickets (ADR 0013, Version 1) ist ebenfalls nur als Hash gespeichert.

## Entscheidung

Der Gastzugriff in Schritt 1.3 läuft über das Verwaltungstoken aus ADR 0009. Es geht genau einmal
in der Antwort von `POST /bookings` hinaus und wird bei jedem weiteren Aufruf im Header
`X-Manage-Token` mitgeschickt.

- **Token:** 16 Bytes aus `crypto.randomBytes` als base64url (22 Zeichen), gespeichert als SHA-256
  in `manage_token_hash`. Vergleich in konstanter Zeit.
- **Adressierung:** Die Buchung steht als UUID im Pfad (`/bookings/:bookingId/...`). Die ID ist
  technisch und kein Geheimnis. Ohne passendes Token ergibt sie dieselbe 404 `BOOKING_NOT_FOUND`
  wie eine unbekannte ID; auch ein fehlendes oder kaputtes Token. Der Buchungscode steht nie im Pfad.
- **Endpunkte mit Token:** `GET /bookings/:id`, `POST /bookings/:id/reserve-cash`,
  `POST /bookings/:id/cancel`. Alle sind `@Public()` und je IP begrenzt.
- **Wiederholung mit demselben `Idempotency-Key`:** liefert die bestehende Buchung mit HTTP 200 und
  einem **neuen** Token; das alte wird damit ungültig. Der Schlüssel muss 16 bis 128 Zeichen
  base64url haben (eine UUID passt). Gehört der Schlüssel zu einer anderen Fahrt, Teilstrecke oder
  Sitzauswahl, antwortet die API mit 409 `IDEMPOTENCY_KEY_REUSED`.
- **QR-Token:** Beim Übergang nach `CONFIRMED` entsteht je Fahrgast ein Ticket mit 256 Bit Zufall,
  gespeichert wird nur der SHA-256 (`ticket.qr_token_hash`). Das Token selbst verlässt die
  Transaktion nicht, auch nicht an das Personal. Die Ticketseite (1.4) gibt es nach geprüftem
  Zugriff neu aus und ersetzt dabei den Hash (Spalte `ticket.version` zählt mit).
- **Später:** Code plus Telefon (1.4) und ein Fahrgastkonto (nach OTP-Kanal) ergänzen diesen Weg;
  sie ersetzen ihn nicht.

## Begründung

- Das Token ist das Minimum, das 1.4 und 1.5 brauchen: Der Ablauf Sitzwahl → Barzahlung → Storno
  funktioniert im selben Browser ohne Konto und ohne SMS.
- Ein Header statt Query oder Pfad hält das Geheimnis aus Logs, Browser-Historie und Referer.
- Ein neues Token bei Wiederholung ist die einzige Möglichkeit, eine verlorene Antwort zu ersetzen,
  ohne das Token im Klartext zu speichern. Wer den `Idempotency-Key` kennt, hat die Anfrage selbst
  gestellt; der Schlüssel ist damit ein Geheimnis des Clients wie das Token.
- Das QR-Token an niemanden auszugeben, bis die Ticketseite es braucht, hält die Zahl der Stellen
  klein, an denen ein gültiges Ticket entstehen kann.

## Konsequenzen

- **Positiv:** Kein Klartext-Geheimnis in der Datenbank; ein Datenbank-Abzug öffnet keine Buchung.
- **Positiv:** Die Fehlerantwort verrät nicht, ob eine Buchungs-ID existiert.
- **Negativ:** Ein zweites Gerät desselben Fahrgasts hat ohne Code und Telefon (1.4) keinen Zugriff.
- **Negativ:** Zwei gleichzeitige Wiederholungen derselben Anfrage erhalten zwei Tokens, nur das
  zuletzt geschriebene gilt. Hinnehmbar, weil der Client ohnehin nur eine Antwort auswertet.
- **Negativ:** Ein abgegriffener `Idempotency-Key` erlaubt die Übernahme der Buchung, solange keine
  andere Prüfung greift. Der Schlüssel steht nur im Request-Header und wird nicht geloggt.
- **Folgearbeit:** 1.4: `POST /bookings/lookup` mit Code und Telefon, kurzlebiges Token, Neuausgabe
  des QR-Tokens; 1.5: Token im Zustand der Seite halten, nie in der Seiten-URL.

## Verworfene Alternativen

- **Token im Klartext speichern, um Wiederholungen identisch zu beantworten:** Ein Abzug der
  Datenbank würde jede offene Buchung öffnen.
- **Token aus dem `Idempotency-Key` ableiten (HMAC mit Server-Schlüssel):** stabil bei
  Wiederholungen, aber ein zweites Geheimnis mit Rotation, nur für einen Randfall.
- **Buchungscode im Pfad:** einfach, verstößt aber gegen die URL-Regel und landet im Access-Log.
- **Sitzung für Gäste (Cookie):** würde `session` für Personen ohne Konto öffnen und den
  CSRF-Schutz auf öffentliche Routen ausdehnen.
- **QR-Token in der Antwort von `confirm-cash` an das Personal:** Das Personal braucht es nicht; der
  Fahrgast bekommt es auf der Ticketseite.

## Annahmen und Revisionsauslöser

- Annahme (unbestätigt): Clients wiederholen `POST /bookings` nur nach Netzfehlern, nicht parallel.
- Neu bewerten, sobald Fahrgastkonten existieren oder Code plus Telefon (1.4) eingeführt ist.
- Neu bewerten, wenn Rate-Limit-Treffer auf Durchprobieren von Buchungs-IDs deuten.

## Verweise

- ADR 0009 (Gastbuchung), ADR 0013 (Codes und Tokens), ADR 0016 (Logs, URLs)
- `docs/api-konventionen.md` (Abschnitt „Buchung"), `docs/domaenenmodell.md` („Umsetzung 1.3")
- `apps/api/src/modules/bookings/bookings.controller.ts`, `apps/api/src/modules/bookings/domain/secrets.ts`

## Nachtrag 2026-11-02 (Schritt 1.4)

Der Punkt **QR-Token** ist durch ADR 0022 ersetzt: Das Token wird aus Ticket-ID und Version per
HMAC abgeleitet und bei jedem Abruf gleich ausgegeben, statt neu gewürfelt. Code plus Telefon ergibt
ein Lesetoken für denselben Header; es erlaubt nur Lesen. Alles andere bleibt bestehen.
