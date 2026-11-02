# ADR 0022: QR-Token per HMAC, Lesetoken nach Code und Telefon, Ticket offline im Browser

Status: Angenommen · Datum: 2026-11-02 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 1.4, Entscheidungen übertragen)

## Kontext

Schritt 1.4 baut die Ticketseite mit QR-Code und den Zugriff über Buchungscode und Telefon.

Fakten zum Ist-Zustand (2026-11-02):

- ADR 0020 legt fest: Beim Übergang nach `CONFIRMED` entsteht je Fahrgast ein QR-Token aus 256 Bit
  Zufall, gespeichert wird nur der SHA-256. Die Ticketseite soll es „nach geprüftem Zugriff neu
  ausgeben und dabei den Hash ersetzen“.
- ADR 0009 verlangt für Code und Telefon „ein kurzlebiges, auf diese Buchung begrenztes Token“ und
  Grenzen je IP und je Code. Gast-Endpunkte nehmen Tokens nur im Header `X-Manage-Token` an.
- Die Ticketseite soll offline lesbar bleiben und gedruckt werden können
  (`docs/architektur.md`, Datenfluss Schritt 7). Ein Service Worker fehlte bisher.

Ein bei jedem Abruf neu ausgegebenes QR-Token macht jeden früheren QR-Code ungültig: den Ausdruck,
die gespeicherte Seite auf dem Telefon, die Seite auf einem zweiten Gerät. Genau diese Kopien
braucht ein Fahrgast mit schwachem Netz am Busbahnhof.

## Entscheidung

Das QR-Token wird aus Ticket-ID und Version mit einem serverseitigen Schlüssel abgeleitet; der Zugriff
über Code und Telefon ergibt ein zustandsloses, signiertes Lesetoken; die Web-App hält die zuletzt
geladene Ticketseite im Browser vor. Das ersetzt den Satz zum QR-Token in ADR 0020; der Rest von
ADR 0020 gilt weiter.

**QR-Token (Version 1, ersetzt „zufällig“ aus ADR 0013 und 0020)**

- Token = HMAC-SHA-256(`TICKET_QR_KEY`, `masar-ticket-qr:v1:<ticketId>:<version>`) als base64url
  (43 Zeichen, 256 Bit). In `ticket.qr_token_hash` steht weiter nur der SHA-256 des Tokens.
- Die Ticket-ID entsteht vor dem Einfügen (`uuidv7()` in der Datenbank), damit der Hash schon bei
  der Bestätigung passt. `ticket.version` erhöhen entwertet einen einzelnen QR-Code.
- Die Ticketseite leitet das Token bei jedem Abruf neu ab. Passt der gespeicherte Hash nicht (Ticket
  aus 1.3 oder neuer Schlüssel), ersetzt sie ihn für ausgestellte Tickets. Tokens gibt es nur für
  bestätigte Buchungen und Tickets im Status `ISSUED`.

**Lesetoken nach Code und Telefon**

- `POST /bookings/lookup` mit `{ bookingCode, phone }` im Body. Unbekannter Code und falsches
  Telefon ergeben dieselbe 404 `BOOKING_NOT_FOUND` nach derselben Arbeit (eine Abfrage über den
  eindeutigen Code, ein Vergleich in konstanter Zeit).
- Grenzen: 5 Anfragen je Minute und IP; 10 Versuche je Code und Stunde über alle IPs, im Speicher
  der API, gemerkt als SHA-256 des Codes; gezählt wird jeder Versuch, auch für unbekannte Codes.
- Token = 4 Bytes Ablauf (Sekunden) ‖ 20 Bytes HMAC-SHA-256(`BOOKING_ACCESS_KEY`,
  `masar-booking-access:v1:<bookingId>:<ablauf>`), base64url (32 Zeichen). Laufzeit 12 Stunden.
  Nichts davon steht in der Datenbank.
- Das Lesetoken geht wie das Verwaltungstoken im Header `X-Manage-Token`. Die Länge unterscheidet
  beide (Verwaltungstoken 22 Zeichen). Es öffnet nur `GET /bookings/:id` und
  `GET /bookings/:id/ticket`; Barzahlung wählen und Storno bleiben beim Verwaltungstoken. Ein
  Lesetoken an einer ändernden Route ergibt dieselbe 404 wie ein falsches Token.
- Die Ticketseite (`GET /bookings/:id/ticket`) zeigt Buchung, Fahrt, Halte der Teilstrecke,
  Fahrgäste mit Sitz und Namen und Tickets mit Status und QR-Token; keine Telefonnummer, keine
  E-Mail, kein Geschlecht, keine Ausweisnummer.

**Ticket offline im Browser**

- Das Token steht nur im Fragment der Seiten-URL (`/{ar,en}/bookings/<id>#token=…`). Der Browser lädt
  die Daten per Server Action (Token im POST-Body), der Web-Server erzeugt die QR-Codes als SVG.
- Die zuletzt geladene Ticketseite liegt im `localStorage` des Geräts (Buchungscode, Fahrt, Sitze,
  Namen, QR-Codes; nie das Token). Ein Service Worker (`/sw.js`) hält die Seite selbst und ihre
  statischen Dateien im Cache. Offline zeigt die Seite die gespeicherte Kopie mit Hinweis und Zeit.
- In Produktion fehlen ohne beide Schlüssel nicht nur QR-Codes, die API startet nicht. In
  Entwicklung und Tests entsteht je Prozess ein Zufallsschlüssel.

## Begründung

- Ein abgeleitetes Token ist stabil: Ausdruck, Telefon und zweites Gerät zeigen denselben gültigen
  Code. Ein Datenbank-Abzug allein öffnet trotzdem kein Ticket, weil der Schlüssel fehlt.
- Ein zustandsloses Lesetoken braucht keine Tabelle und keine Migration; die kurze Laufzeit ersetzt
  den Widerruf. Neu ausgegebene Verwaltungstokens hätten das Token des ersten Geräts entwertet.
- Nur lesen: Code und Telefon sind ein schwacher Nachweis (ADR 0009, „geteilter Screenshot“). Wer
  sie kennt, soll die Buchung sehen, aber nicht stornieren.
- Eine Grenze je Code verhindert das Durchprobieren der Telefonnummer über viele IPs; die Grenze je
  IP das Raten von Codes. 2⁴⁰ Codes bei 5 Versuchen je Minute sind nicht durchsuchbar.
- Die gespeicherte Kopie im Browser ist die einzige Möglichkeit, das Ticket ohne Netz zu zeigen;
  das Gerät gehört dem Fahrgast, und dieselben Daten stehen ohnehin auf dem Ausdruck.

## Konsequenzen

- **Positiv:** Ein gedrucktes oder gespeichertes Ticket bleibt gültig, solange Schlüssel und Version
  gleich sind.
- **Positiv:** Ein zweites Gerät sieht die Buchung mit Code und Telefon, ohne das erste zu stören.
- **Negativ:** Wer `TICKET_QR_KEY` und einen Datenbank-Abzug hat, kann jeden QR-Code erzeugen. Der
  Schlüssel liegt wie `NATIONAL_ID_KEYS` getrennt von den Backups.
- **Negativ:** Ein Schlüsselwechsel entwertet alte QR-Codes erst, wenn die Ticketseite neu abgerufen
  wird; bis dahin gilt der alte Hash. Für einen sofortigen Wechsel braucht es einen Job, der alle
  Hashes neu ableitet (Folgearbeit, bisher nicht nötig).
- **Negativ:** Ein Lesetoken lässt sich vor Ablauf nicht einzeln widerrufen; nur ein neuer
  `BOOKING_ACCESS_KEY` beendet alle.
- **Negativ:** Der Zähler je Code liegt im Prozess. Ein Neustart setzt ihn zurück; eine zweite
  API-Instanz bräuchte einen gemeinsamen Speicher (wie ADR 0009).
- **Negativ:** Auf einem geteilten Gerät sieht die nächste Person die gespeicherte Ticketseite. Die
  Seite bietet „Von diesem Gerät entfernen“.
- **Folgearbeit:** Phase 4: signierter QR-Inhalt für die Offline-Prüfung durch Fahrer (ADR 0013,
  Version 2); Job zum Neuableiten nach Schlüsselwechsel; Grenzwerte vor dem Pilot kalibrieren.

## Verworfene Alternativen

- **Bei jedem Abruf neues Zufallstoken, Hash ersetzen (ADR 0020):** entwertet Ausdruck und
  gespeicherte Kopie; die Seite wäre offline nutzlos.
- **QR-Token im Klartext oder verschlüsselt speichern:** Klartext öffnet jedes Ticket aus einem
  Abzug; verschlüsselt braucht ebenfalls einen Schlüssel und zusätzlich eine Spalte.
- **Neues Verwaltungstoken nach Code und Telefon:** entwertet das Token des buchenden Geräts und gäbe
  dem schwachen Nachweis volle Rechte.
- **Lesetoken in einer Tabelle:** einzeln widerrufbar, aber eine Migration und ein Aufräumjob für
  Tokens mit zwölf Stunden Laufzeit.
- **QR-Code im Browser erzeugen:** zusätzliches JavaScript auf schwachen Geräten; der Server kann
  das SVG genauso liefern.

## Annahmen und Revisionsauslöser

- Annahme (unbestätigt): 12 Stunden Lesezugriff und 10 Versuche je Code und Stunde passen zum
  Verhalten echter Fahrgäste. Vor dem Pilot mit Daten prüfen.
- Neu bewerten mit Fahrgastkonten, mit einer zweiten API-Instanz oder mit der Offline-Prüfung durch
  Fahrer (Phase 4).

## Verweise

- ADR 0009 (Gastzugriff), ADR 0013 (Codes und Tokens), ADR 0016 (Datenminimierung), ADR 0020
  (Verwaltungstoken)
- `apps/api/src/modules/bookings/domain/secrets.ts`, `apps/api/src/modules/bookings/guest-keys.ts`,
  `apps/api/src/modules/bookings/lookup-limiter.ts`
- `docs/api-konventionen.md` (Abschnitt „Ticketseite“), `docs/web-fahrgastablauf.md`
