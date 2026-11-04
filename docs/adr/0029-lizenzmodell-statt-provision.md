# ADR 0029: Lizenzmodell statt Provision in der Gründungsphase

Status: Angenommen (Preise offen) · Datum: 2026-11-04 · Entschieden von: Projektleitung (Gespräche vom 2026-11-04)

## Kontext

ADR 0017 sieht eine Provision je bestätigter Buchung vor. Die Projektleitung will zuerst Ruf aufbauen
und Firmen gewinnen. Eine Provision kommt besser an, wenn viele Firmen und Fahrgäste auf der Plattform
sind. Stattdessen wird eine Lizenz verkauft. Masar fasst kein Geld der Fahrgäste an (ADR 0008): Die Firma
kassiert direkt.

## Entscheidung

- **Gründungsphase:** Jede Vertragsfirma erhält die Lizenz für die **ersten 6 Monate kostenlos**.
- **Zwei Laufzeiten danach:** **1 Jahr** oder **2 Jahre**. Beide sind Lizenzen mit fester Laufzeit; der Preis
  für 2 Jahre kann günstiger sein als zweimal 1 Jahr (Preis offen).
- **Preisstaffel:** Der Preis richtet sich nach der Zahl der Busse in **Paketen zu 5 Bussen** (1 bis 5,
  6 bis 10, …). Ausgezählt werden aktive Busse (`bus.status = ACTIVE`).
- **Kulanz:** Nach Ablauf gilt eine Frist von **14 Tagen**. In dieser Zeit darf die Firma weiter Fahrten
  planen, und das Portal warnt deutlich. Danach kann sie keine neuen Fahrten mehr planen. Bestehende Fahrten
  und Buchungen laufen weiter (Bezahlen, Bestätigen, Stornieren, Reisen). Fahrgäste dürfen wegen der Lizenz
  einer Firma nicht stranden.
- **Provision:** ruht (ADR 0017, Nachtrag). Satz 0 bps.
- **Datenmodell (Vorschlag für 2.7):** Je Firma ein Lizenzstand mit `license_plan` (`FOUNDING`, `ONE_YEAR`,
  `TWO_YEARS`), `license_valid_from`, `license_valid_until` (Kalendertage in `Asia/Damascus`) und
  `license_bus_packages` (Zahl der gebuchten 5er-Pakete). Das Portal vergleicht aktive Busse mit
  `5 × license_bus_packages`: Wer mehr aktive Busse hat, als das Paket deckt, kann keine Fahrten mit den
  überzähligen Bussen planen (Hinweis statt stiller Sperre). Den Stand pflegt in der ersten Version der
  Plattform-Admin von Hand. Rechnungen entstehen außerhalb des Systems.
- **Warnungen:** 30 und 7 Tage vor Ablauf sowie während der Kulanzfrist.

## Begründung

- Eine feste Lizenz ist für Firmen berechenbar und braucht keine Abrechnung je Buchung.
- Pakete zu 5 Bussen sind einfach zu erklären und lassen kleine wie größere Firmen gestaffelt zahlen.
- Der Ablauf trifft nur die Planung neuer Fahrten, also den Teil, den Masar ohne Schaden für Fahrgäste
  sperren kann.
- Kein Provisionsbericht, keine Prüfung der No-Show-Quote und keine Umgehungsdebatte am Barweg.

## Konsequenzen

- **Positiv:** Weniger Aufwand bis zum Pilot; kein Geldfluss über Masar.
- **Negativ:** Einnahmen hängen an der Zahl der Firmen und Busse, nicht an der Nutzung. Skalierung braucht
  später ein zweites Modell (Provision oder zusätzliche Dienste wie Werbeplätze, ADR 0031).
- **Negativ:** Manuelle Rechnungen und Lizenzpflege, bis sich Automatisierung lohnt.
- **Folgearbeit:** Schritt 2.7 der Roadmap: Lizenzfelder, Prüfung beim Veröffentlichen eines Wochenplans
  (neue Fehlercodes für abgelaufene Lizenz und zu viele aktive Busse), Hinweise im Portal, Pflege im
  Admin-Bereich.

## Offene Punkte

- Preise je Paket und Laufzeit (auch der Rabatt für 2 Jahre).
- Was bei Bus-Zuwachs mitten in der Laufzeit gilt (Nachbuchung eines Pakets, anteilig oder voll).
- Rechtliche und steuerliche Prüfung des Lizenzvertrags für die Betreiberfirma.

## Verweise

- ADR 0008 (Zahlwege, Geldfluss), ADR 0017 (Provision, ruht), ADR 0031 (Werbeplätze)
