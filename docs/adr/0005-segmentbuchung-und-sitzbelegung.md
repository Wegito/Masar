# ADR 0005: Segmentbuchung und Sitzbelegung als eigene Tabelle

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Eine Fahrt Damaskus → Aleppo hält in Homs und Hama. Fahrgäste sollen Teilstrecken buchen können, zum Beispiel Homs → Aleppo. Derselbe Sitz kann dann nacheinander an mehrere Fahrgäste gehen: Damaskus → Homs und danach Homs → Aleppo. Die Verfügbarkeit hängt also von Sitz **und** Teilstrecke ab. In der Fragerunde wurde „Segmentbuchung ab Tag 1" gewählt, nicht „nur Start bis Ziel".

Gleichzeitige Buchungen desselben Sitzes müssen sicher scheitern, auch wenn ein künftiger Code-Pfad (Schaltermodus, Admin-Skript, Datenreparatur) die Sperrlogik nicht kennt.

## Entscheidung

**Haltestellen und Teilstrecken**

- Eine Route hat eine feste Richtung (Rückfahrt = eigene Route) und geordnete Halte `route_stop.seq`.
- Eine Fahrt übernimmt die Halte bei ihrer Anlage als Schnappschuss in `trip_stop` (`seq` lückenlos ab 0, Ankunfts- und Abfahrtszeit je Halt).
- Eine Buchung speichert Einstiegs- und Ausstiegshalt und deren Positionen `from_seq` < `to_seq`. Alle Fahrgäste einer Buchung fahren dieselbe Teilstrecke.
- Tarife gelten je Haltestellenpaar (`fare`) mit Gültigkeitszeitraum. Ohne gültigen Tarif wird das Paar nicht angeboten; eine Buchung scheitert mit `NO_FARE_FOR_SEGMENT`.

**Inventar als eigene Tabelle**

- Buchung (`booking`, `booking_passenger`) und Sitzbelegung (`seat_occupation`) sind getrennt.
- `seat_occupation(trip_id, seat_id, from_seq, to_seq, booking_id, booking_passenger_id, gender)` enthält genau dann Zeilen, wenn die Buchung aktiv ist: `HELD`, `RESERVED`, `PENDING_CONFIRMATION` oder `CONFIRMED`.
- Jeder Übergang in einen Endzustand (`CANCELLED`, `EXPIRED`) löscht die Belegungszeilen in derselben Transaktion. Die Buchung bleibt als Historie erhalten.
- Die Datenbank erzwingt die Eindeutigkeit (handbearbeitete Migration, ADR 0004):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE seat_occupation
  ADD CONSTRAINT seat_occupation_seq_order CHECK (from_seq < to_seq),
  ADD CONSTRAINT seat_occupation_no_overlap
    EXCLUDE USING gist (
      trip_id WITH =,
      seat_id WITH =,
      int4range(from_seq, to_seq, '[)') WITH &&
    );
```

- Teilstrecken sind **halboffene Intervalle**: `[0,2)` und `[2,4)` überlappen nicht. Ein Sitz wird an dem Halt frei, an dem der vorige Fahrgast aussteigt.
- Ein Verstoß (SQLSTATE `23P01`) wird zu HTTP 409 mit Code `SEAT_TAKEN`.

**Sperre als Serialisierungspunkt**

- Reservieren läuft in einer Transaktion: Fahrt-Zeile per `SELECT … FOR UPDATE` sperren → abgelaufene Holds dieser Fahrt freigeben → Halte, Tarif, Kontingent und Belegung frisch lesen → prüfen → schreiben.
- Jeder Schreibzugriff auf `seat_occupation` geht durch den Buchungsservice und hält die Fahrt-Sperre. Das ist eine Review-Regel.
- Der Sitzplan einer Fahrt ist eingefroren, sobald Belegungen existieren (`trip.seat_layout_id` unveränderlich).

## Begründung

- **Eigene Tabelle statt Status-Filter:** Weil nur aktive Buchungen Zeilen haben, braucht der Constraint keine Bedingung auf einen Status. Er bleibt einfach und prüft genau das, was zählt. Die Geschlechtsprüfung (ADR 0006) sieht nur echte Belegungen. Ein späterer Schaltermodus schreibt in dieselbe Tabelle, ohne eine zweite Wahrheit zu erzeugen.
- **Sperre UND Constraint:**
  - Die Sperre liefert verständliche Fehler (welcher Sitz, warum) und ist die einzige Serialisierung für die Geschlechtsregel, die kein Constraint ausdrücken kann.
  - Der Constraint schützt die Eindeutigkeit gegen jeden Pfad, der die Sperre vergisst.
  - Ein Test, der an der Sperre vorbei direkt einfügt, beweist, dass die handbearbeitete Migration noch existiert.
- **Halboffene Intervalle** entsprechen der Realität am Halt und vermeiden Sonderfälle für Grenzen.

## Konsequenzen

- **Positiv:** Inventar ist je Sitz und Teilstrecke exakt, auch bei gleichzeitigen Buchungen.
- **Positiv:** Historie bleibt vollständig, weil nur die Belegung verschwindet.
- **Negativ:** Buchungen derselben Fahrt laufen nacheinander. Bei rund 45 Sitzen je Fahrt ist das unkritisch (Annahme).
- **Negativ:** Jeder Statusübergang muss die Belegung in derselben Transaktion pflegen. Ein vergessenes Löschen blockiert einen Sitz dauerhaft.
- **Negativ:** Tarife je Paar wachsen quadratisch: vier Halte ergeben sechs Tarife je Route.
- **Folgearbeit:**
  - Konsistenzprüfung „Belegung ohne aktive Buchung" als Test und als Überwachung (`/api/health/deep`, Phase 4).
  - Nebenläufigkeitstest mit zwei echten Datenbankverbindungen auf denselben Sitz.
  - Überlappungsmatrix als Integrationstest: `[0,2)`/`[2,4)` erlaubt, `[0,3)`/`[2,4)` abgelehnt.
  - Portal warnt beim Veröffentlichen einer Fahrt, wenn Tarife für Haltestellenpaare fehlen.

## Verworfene Alternativen

- **Nur Start bis Ziel (Punkt-zu-Punkt):** Verfügbarkeit je Fahrt statt je Teilstrecke, deutlich einfacher. Abgelehnt, weil Zwischenhalte in der Praxis gebucht werden und ein späterer Umbau das Inventarmodell bricht.
- **Mit der ersten Partnerfirma entscheiden:** hätte den Kern des Datenmodells offen gelassen.
- **`EXCLUDE` mit Statusbedingung direkt auf den Fahrgastzeilen:** Der Status liegt auf der Buchung, nicht auf dem Fahrgast; er hätte denormalisiert werden müssen, und jede Abfrage hätte den Status filtern müssen.

## Annahmen und Revisionsauslöser

- Annahme: Syrische Pullman-Firmen verkaufen Plätze ab Zwischenhalten. Mit der ersten Partnerfirma bestätigen.
- Annahme: Die Halte einer Fahrt ändern sich nach Verkaufsstart nicht. Eine Änderung bedeutet Storno und Neubuchung.
- Neu bewerten, wenn Fahrgäste einer Buchung unterschiedliche Teilstrecken brauchen.
- Neu bewerten, wenn ein Bus mit anderem Sitzplan am Fahrtag getauscht werden muss (im MVP gesperrt).
- Neu bewerten, wenn die Fahrt-Sperre messbar zum Engpass wird.

## Verweise

- ADR 0004 (Prisma, handbearbeitete Migrationen), ADR 0006 (Geschlechtsregel), ADR 0007 (Kontingent), ADR 0012 (Zeit und Suche)
- `docs/domaenenmodell.md`
- PostgreSQL-Doku: Exclusion Constraints, Range Types, `btree_gist`
- Lernlog 2026-09-30 „Erst sperren, dann lesen"
