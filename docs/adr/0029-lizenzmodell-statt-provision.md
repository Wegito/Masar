# ADR 0029: Lizenzmodell statt Provision in der Gründungsphase

Status: Vorschlag · Datum: 2026-11-04 · Entschieden von: Projektleitung (Gespräch vom 2026-11-04), Ausgestaltung offen

## Kontext

ADR 0017 sieht eine Provision je bestätigter Buchung vor. Die Projektleitung will zuerst Ruf aufbauen
und Firmen gewinnen. Eine Provision kommt besser an, wenn viele Firmen und Fahrgäste auf der Plattform
sind. Stattdessen soll eine Lizenz verkauft werden. Masar fasst kein Geld der Fahrgäste an (ADR 0008):
Die Firma kassiert direkt.

## Entscheidung

- **Gründungsphase:** Jede Vertragsfirma erhält eine kostenlose Lizenz für **6 Monate**.
- **Danach:** eine **Jahreslizenz**.
- **Laufzeit "2 Jahre":** Die Projektleitung nannte zwei Jahre. Gelesen als Mindestvertragslaufzeit mit
  jährlich abgerechneter Lizenz. Das ist **nicht bestätigt**; siehe offene Punkte.
- **Provision:** ruht (ADR 0017, Nachtrag). Satz 0 bps.
- **Datenmodell (Vorschlag):** Je Firma ein Lizenzstand mit `license_plan` (z. B. `FOUNDING`,
  `ANNUAL`), `license_valid_from` und `license_valid_until` (Kalendertage in `Asia/Damascus`).
  Den Stand setzt in der ersten Version der Plattform-Admin von Hand. Rechnungen entstehen außerhalb
  des Systems.
- **Wirkung eines Ablaufs:** Eine Firma ohne gültige Lizenz kann **keine neuen Fahrten planen**.
  Bestehende Fahrten und Buchungen laufen weiter (Bezahlen, Bestätigen, Stornieren, Reisen). Fahrgäste
  dürfen wegen der Lizenz einer Firma nicht stranden.
- Vor Ablauf warnt das Portal (30 und 7 Tage), mit Hinweis für die Firma.

## Begründung

- Eine feste Lizenz ist für Firmen berechenbar und braucht keine Abrechnung je Buchung.
- Der Ablauf trifft nur die Planung neuer Fahrten, also den Teil, den Masar ohne Schaden für Fahrgäste
  sperren kann.
- Kein Provisionsbericht, keine Prüfung der No-Show-Quote und keine Umgehungsdebatte am Barweg.

## Konsequenzen

- **Positiv:** Weniger Aufwand bis zum Pilot; kein Geldfluss über Masar.
- **Negativ:** Einnahmen hängen an der Zahl der Firmen, nicht an der Nutzung. Skalierung braucht später
  ein zweites Modell (Provision oder gestaffelte Lizenz).
- **Negativ:** Manuelle Rechnungen und Lizenzpflege, bis sich Automatisierung lohnt.
- **Folgearbeit:** Schritt 2.7 der Roadmap: Lizenzfelder, Prüfung beim Veröffentlichen eines Wochenplans
  (neuer Fehlercode), Hinweis im Portal, Pflege im Admin-Bereich.

## Offene Punkte

- Preis und Zuschnitt: pauschal je Firma oder je Bus.
- Bedeutung von "2 Jahre": Mindestlaufzeit, Preisbindung oder Laufzeit der Gründungsphase.
- Was nach den 6 Monaten passiert, wenn eine Firma noch nicht verlängert hat (Kulanzfrist?).
- Rechtliche und steuerliche Prüfung des Lizenzvertrags für die Betreiberfirma.

## Verweise

- ADR 0008 (Zahlwege, Geldfluss), ADR 0017 (Provision, ruht)
