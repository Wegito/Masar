# ADR 0007: Online-Kontingent je Fahrt und akzeptiertes Restrisiko

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Busfirmen verkaufen weiter Tickets am Schalter in der Garage. Verkaufen Schalter und App aus getrennten Listen, ist eine Doppelbuchung sicher. In der Fragerunde standen drei Wege zur Wahl: Masar als einziges Inventar (Schalter verkauft über einen Schaltermodus im Portal), ein Online-Kontingent je Fahrt, oder das Risiko vorerst hinnehmen. Gewählt wurde das **Online-Kontingent**.

## Entscheidung

- Je Fahrt und Sitz gibt es einen Eintrag `trip_seat(trip_id, seat_id, online_sellable, blocked)`.
- Die Firma legt fest, welche Sitze online verkäuflich sind (`online_sellable`). Die übrigen Sitze verkauft der Schalter außerhalb von Masar.
- `blocked` sperrt einen Sitz für alle Kanäle (defekt, Fahrer, Reserve).
- Regeln beim Reservieren (ADR 0005, unter Fahrt-Sperre):
  - Kanal `ONLINE`: nur Sitze mit `online_sellable` und nicht `blocked`, sonst `SEAT_NOT_ONLINE` oder `SEAT_BLOCKED`.
  - Kanäle `COUNTER` und `ADMIN`: ignorieren `online_sellable`, respektieren `blocked`.
- Die Suche zählt freie Plätze nur aus dem Online-Kontingent und zeigt sie gekappt an („9+"), damit die Auslastung nicht ablesbar ist.
- Kanäle `COUNTER` und `ADMIN` existieren im Datenmodell von Anfang an. Der Schaltermodus im Portal folgt in Phase 2 und schreibt in dieselbe Belegungstabelle.

## Begründung

- Das Kontingent verhindert Doppelbuchungen, ohne dass die Firma ihren Schalterbetrieb sofort umstellen muss. Das senkt die Hürde für die erste Partnerfirma.
- Die Kanäle im Modell halten den Weg zum Schaltermodus offen. Dann verkauft der Schalter aus demselben Inventar, und das Restrisiko verschwindet.

## Konsequenzen

- **Positiv:** Kein Konflikt zwischen App und Schalter, solange sich beide an die Aufteilung halten.
- **Negativ, bewusst akzeptiert:** Verkauft der Schalter trotzdem einen online markierten Sitz, sitzen zwei Fahrgäste auf einem Platz. Masar kann das technisch nicht verhindern, weil der Schalterverkauf außerhalb des Systems liegt.
- **Negativ:** Online-Fahrgäste sehen weniger Plätze als vorhanden. Die Firma muss die Aufteilung pflegen.
- **Erkennung:** Meldungen „Ticket beim Einsteigen abgelehnt", Konflikte beim Fahrer-Scan (Phase 4), Beschwerden.
- **Folgearbeit:**
  - Portal (Phase 2): Kontingent je Fahrt bearbeiten, Sitz als „offline verkauft" markieren, Standard-Kontingent als Vorlage je Firma.
  - Schaltermodus nach Phase 2.
  - Bis das Portal existiert, setzt das Seed-Skript das Kontingent ausdrücklich.

## Verworfene Alternativen

- **Masar als einziges Inventar (Schaltermodus sofort):** einzige Variante ohne Doppelbuchung, verlangt aber, dass die Firma ihr Schalterpersonal von Anfang an auf das Portal umstellt.
- **Risiko vorerst hinnehmen:** Firma pflegt Verfügbarkeit von Hand. Die erste Doppelbuchung beschädigt das Vertrauen in das Produkt.

## Annahmen und Revisionsauslöser

- Annahme: Firmen akzeptieren eine feste Aufteilung je Fahrt. Mit der ersten Partnerfirma bestätigen.
- Offen: Standardwert für neue Fahrten (alle Sitze online, keiner, oder eine Vorlage je Firma). Entscheidung im Portal-Entwurf (Phase 2).
- Neu bewerten, sobald Doppelbuchungen gemeldet werden oder eine Firma den Schaltermodus nutzen will.

## Verweise

- ADR 0005 (Belegung und Sperre), ADR 0015 (Fehlercodes)
- `docs/domaenenmodell.md`, `docs/roadmap.md`
