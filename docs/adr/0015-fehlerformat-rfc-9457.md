# ADR 0015: Fehlerformat nach RFC 9457 mit stabilen Fehlercodes

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Drei Clients (Fahrgast-App, Portal, später eine native App) zeigen Fehler in zwei Sprachen an. Fehler aus der Buchungslogik („Sitz bereits vergeben", „Regel verletzt") müssen eindeutig unterscheidbar sein, damit die Oberfläche passend reagiert. Interne Details dürfen nie nach außen gelangen.

## Entscheidung

- Alle Fehlerantworten der API sind `application/problem+json` nach RFC 9457.
- Felder: `type`, `title`, `status`, `detail`, `instance` (= Request-ID), dazu die Erweiterungen `code` (stabiler Fehlercode), `params` (unkritische Werte für den Nutzertext, z. B. Sitzbeschriftungen) und `errors` (bei Validierung je Verstoß `path` und verletzte Regel `rule`).
- `code` ist der maschinenlesbare Schlüssel. Beispiele aus dem Plan: `SEAT_TAKEN`, `GENDER_RULE_CONFLICT`, `HOLD_EXPIRED`, `SEAT_NOT_ONLINE`, `SALES_CLOSED`, `NO_FARE_FOR_SEGMENT`. Die verbindliche Liste steht in `packages/shared`.
- `title` und `detail` sind technische Hilfen für Entwickler, keine Nutzertexte. Texte für Nutzer erzeugt das Frontend aus `code` und Parametern in ar oder en.
- `type` ist zunächst `about:blank`. Eine öffentliche Fehlerdokumentation mit eigenen URIs folgt, sobald eine Domain feststeht.
- Ein globaler Exception-Filter übersetzt bekannte Fehler: Datenbankfehler `23P01` → 409 `SEAT_TAKEN`; Transaktions-Timeout → 503 mit `Retry-After`; unbekannte Fehler → 500 ohne Details.
- Nie Stacktraces, SQL oder interne Pfade in Antworten.
- Fehlercodes sind ein Vertrag: einmal veröffentlichte Codes werden nicht umbenannt und nicht wiederverwendet.

## Begründung

- Ein Standardformat verstehen Werkzeuge und neue Teammitglieder sofort.
- Stabile Codes trennen Logik und Übersetzung (ADR 0010) und erlauben gezielte Reaktionen, zum Beispiel den Sitzplan nach `SEAT_TAKEN` neu zu laden.
- Die Request-ID in `instance` verbindet eine Fehlermeldung mit dem Log, ohne Details preiszugeben.

## Konsequenzen

- **Positiv:** Einheitliche Fehlerbehandlung in allen Clients.
- **Negativ:** Jeder neue Code braucht Übersetzungen in ar und en und einen Eintrag in der Dokumentation (Definition of Done).
- **Folgearbeit:** Fehlercode-Katalog in `packages/shared`; Test, dass Validierungsfehler das Format einhalten; Dokumentation in `docs/api-konventionen.md`.

## Verworfene Alternativen

- **Fehlertexte aus dem Backend:** Übersetzung gehört in die Oberfläche; die API bliebe sonst an Sprachen gekoppelt.

## Annahmen und Revisionsauslöser

- Neu bewerten, wenn externe Partner (zum Beispiel Firmen-Integrationen) eigene Fehlerverträge brauchen.

## Verweise

- RFC 9457 „Problem Details for HTTP APIs": https://www.rfc-editor.org/rfc/rfc9457
- ADR 0003 (Exception-Filter), ADR 0010 (Übersetzung)
- `docs/api-konventionen.md`
