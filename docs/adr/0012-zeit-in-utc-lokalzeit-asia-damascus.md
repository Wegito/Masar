# ADR 0012: Zeit in UTC, Lokalzeit über Asia/Damascus

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Fahrten haben Abfahrts- und Ankunftszeiten je Halt. Nachtfahrten überqueren Mitternacht. Fahrgäste suchen nach einem Kalendertag in syrischer Ortszeit. Syrien hat die Sommerzeit 2022 abgeschafft und gilt seitdem dauerhaft als UTC+3. Fristen (Hold-Ablauf, Barzahlungsfrist, Verkaufsschluss) entscheiden über Sitzvergabe und dürfen nicht von Geräteuhren abhängen.

## Entscheidung

- Alle Zeitpunkte in der Datenbank sind `timestamptz` und werden in UTC verarbeitet.
- Die API gibt Zeitpunkte als ISO-8601 mit `Z` aus.
- Ortszeit entsteht nur durch Umrechnung mit der IANA-Zone `Asia/Damascus`, nie mit einem festen Offset.
- `trip.service_date` ist der Abfahrtstag am Starthalt in Ortszeit. Er bestimmt die Tarifgültigkeit und den Abrechnungsmonat (ADR 0017).
- **Suche:** Ein Suchtag wird in `Asia/Damascus` als halboffenes Intervall interpretiert. Gefiltert wird nach der **Abfahrt am Einstiegshalt** (`trip_stop.departure_at`), nicht nach `service_date`.
  - Beispiel: Eine Fahrt verlässt Damaskus um 23:00 und erreicht Homs um 01:00. Für die Suche Homs → Aleppo erscheint sie am Folgetag.
- Fristen werden serverseitig berechnet und als Spalten gespeichert (`hold_expires_at`, `deadline_at`, `online_sales_close_at`). Die Uhr des Clients zählt nie.
- Eine injizierbare Uhr (`Clock`) macht Fristen testbar.
- Server synchronisieren die Zeit per NTP.

## Begründung

- UTC in der Datenbank vermeidet Mehrdeutigkeit bei Vergleichen und Sortierung.
- Die IANA-Zone statt eines festen Offsets bleibt korrekt, falls Syrien die Zeitregel wieder ändert; dann genügt ein tzdata-Update.
- Die Abfahrt am Einstiegshalt ist das, was Fahrgäste meinen, wenn sie einen Tag wählen.

## Konsequenzen

- **Positiv:** Ein Datumsfehler bei Nachtfahrten ist durch Konstruktion ausgeschlossen, wenn die Suche dieser Regel folgt.
- **Negativ:** Jede Anzeige und jeder Suchparameter braucht die Umrechnung; Fehler entstehen, wenn jemand `new Date()` ohne Zone formatiert.
- **Folgearbeit:** Zeit-Helfer in `packages/shared`; Tests für die Datumsgrenze 23:30 und die Nachtfahrt über Mitternacht; tzdata in Docker-Images aktuell halten.

## Verworfene Alternativen

Keine besprochen; Standardlösung für zeitkritische Systeme.

## Annahmen und Revisionsauslöser

- Annahme: Alle Linien liegen innerhalb Syriens.
- Neu bewerten bei grenzüberschreitenden Linien (zum Beispiel Amman oder Beirut). Dann braucht jede Haltestelle eine eigene Zone.
- Neu bewerten, wenn Syrien wieder eine Sommerzeit einführt (tzdata prüfen, Fristen testen).

## Verweise

- ADR 0005 (Teilstrecken), ADR 0010 (Formatierung), ADR 0017 (Abrechnungsmonat)
- `docs/domaenenmodell.md`
