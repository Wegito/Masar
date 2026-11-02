# ADR 0021: Hintergrundjobs im API-Prozess: Ablauf von Buchungen und Outbox

Status: Angenommen · Datum: 2026-11-02 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 1.3, Entscheidungen übertragen)

## Kontext

Schritt 1.3 braucht zwei wiederkehrende Aufgaben:

- Ein Job prüft minütlich abgelaufene Holds, Barreservierungen und Wallet-Prüfungen und setzt sie
  auf `EXPIRED` (Domänenmodell, „Zustandsautomaten"). Zusätzlich gibt jede neue Reservierung
  abgelaufene Holds ihrer Fahrt unter der Sperre frei, damit kein Sitz hängt, wenn der Job ausfällt.
- Die Outbox-Tabelle (Schritt 1.1) nimmt Ereignisse in der Fachtransaktion auf; jemand muss sie
  zustellen, mit Wiederholung.

Fakten zum Ist-Zustand (2026-11-02): eine API-Instanz auf einem VPS mit Docker Compose (ADR 0014),
kein Redis, keine Queue. `@nestjs/schedule` ist nicht installiert. AGENTS.md: Pakete nur bei Bedarf.

## Entscheidung

Beide Jobs laufen im API-Prozess mit einem einfachen Takt (`setInterval`, `common/interval-job.ts`),
ohne neues Paket. Korrektheit bei mehreren Instanzen sichern Datenbanksperren, nicht der Takt.

- **Takt:** Ablauf alle 60 s, Outbox alle 10 s. Ein Durchgang beginnt erst, wenn der vorige fertig
  ist; ein Fehler beendet nur den Durchgang. `BOOKING_JOBS_ENABLED=false` schaltet beide ab (Tests).
- **Ablauf:** Fahrten mit abgelaufenen Buchungen suchen, dann je Fahrt eine Transaktion:
  `SELECT … FROM trip … FOR UPDATE SKIP LOCKED`, abgelaufene Buchungen auf `EXPIRED`, Belegungen
  löschen, Audit (`SYSTEM`) und Outbox. Ist die Fahrt gesperrt, gibt die laufende Buchung die Holds
  selbst frei; der Job versucht es im nächsten Durchgang. Gleiche SQL-Regel wie beim Reservieren.
- **Outbox:** Einträge in einer kurzen Anweisung abholen (`UPDATE … WHERE id IN (SELECT … FOR UPDATE
SKIP LOCKED)`), dabei `attempts` erhöhen und `next_attempt_at` als Sperrfrist um 5 Minuten
  verschieben. Erst danach zustellen, außerhalb jeder Transaktion. Erfolg: `DONE`. Fehler:
  Wartezeit 30 s, verdoppelt, höchstens 1 Stunde; nach 8 Versuchen `FAILED`.
- **Zustellung:** „mindestens einmal". Für die Ereignisse `BOOKING_RESERVED`, `BOOKING_CONFIRMED` und
  `BOOKING_CANCELLED` geht eine E-Mail an `booking.contact_email`, falls vorhanden, über die
  vorhandene `Mailer`-Abstraktion. Ohne Adresse, nach der Pseudonymisierung oder für `BOOKING_HELD`
  und `BOOKING_EXPIRED` ist der Eintrag ohne Versand erledigt. Eine überholte Zahlungsaufforderung
  (Buchung nicht mehr `RESERVED`) wird nicht verschickt.
- **Daten:** Die Outbox enthält nur `bookingId`, Status und Vorstatus. Der Worker liest Adresse und
  Inhalt erst beim Versand. `last_error` und Logs tragen nur Fehlerklasse und Code.

## Begründung

- Ein Prozess, eine Datenbank: Für eine Instanz und einige hundert Buchungen am Tag ist eine
  Queue-Infrastruktur unverhältnismäßig.
- `SKIP LOCKED` macht die Jobs ohne Absprache mehrinstanzfähig: Zwei Durchgänge bearbeiten dieselbe
  Fahrt oder denselben Eintrag nie gleichzeitig (Test mit zwei gleichzeitigen Jobs).
- Den Versuch vor dem Versand festzuschreiben folgt der Regel für nicht umkehrbare externe Aufrufe
  (AGENTS.md); ein Absturz hinterlässt einen gezählten Versuch statt eines stillen Verlusts.
- Ein eigener Takt mit zwanzig Zeilen ist leichter zu prüfen als ein Scheduler-Paket mit Cron-Syntax
  und Abhängigkeiten.

## Konsequenzen

- **Positiv:** Keine neuen Dienste und Pakete; Tests rufen `runOnce()` direkt auf und steuern die
  Zeit über `Clock`.
- **Negativ:** Jobs teilen CPU und Verbindungspool mit Anfragen. Bei einem Ausfall der API stehen
  auch die Jobs; die Freigabe beim Reservieren mildert das für das Inventar.
- **Negativ:** Doppelte E-Mails sind möglich, wenn der Prozess zwischen Versand und Quittung endet.
- **Negativ:** `FAILED` braucht einen Menschen; es gibt noch keine Überwachung (Phase 4).
- **Folgearbeit:** Überwachung von `FAILED` und Rückstand (`/api/health/deep`, Phase 4); Ersatz des
  sofortigen Versands von Einladungs- und Reset-Mails durch die Outbox (ADR 0009, Nachtrag); weitere
  Kanäle (SMS, WhatsApp) als zusätzliche Handler.

## Verworfene Alternativen

- **`@nestjs/schedule`:** Cron-Ausdrücke und Dekoratoren bringen hier nichts gegenüber einem
  Intervall; ein zusätzliches Paket ohne Not.
- **Eigener Worker-Container:** saubere Trennung, aber zweites Deployment und zweite Konfiguration
  für zwei kleine Jobs. Neu bewerten mit wachsender Last.
- **pg-boss oder eine Queue (Redis, BullMQ):** robuster bei großer Last, aber neue Infrastruktur.
- **`LISTEN/NOTIFY` statt Abfrage im Takt:** schnellere Zustellung, aber eine dauerhafte Verbindung
  und Wiederaufnahme nach Abbrüchen; zehn Sekunden Verzögerung genügen für E-Mails.

## Annahmen und Revisionsauslöser

- Annahme: eine API-Instanz, weniger als einige tausend Ereignisse am Tag.
- Neu bewerten mit mehreren Instanzen (die Sperren genügen, aber jede Instanz taktet), bei
  Zahlungs-Webhooks mit harten Zeitvorgaben oder wenn Jobs die Antwortzeiten messbar verschlechtern.

## Verweise

- ADR 0004 (SQL in kritischen Pfaden), ADR 0005 (Trip-Sperre), ADR 0014 (Betrieb), ADR 0016 (Logs)
- `docs/domaenenmodell.md` („Umsetzung 1.3")
- `apps/api/src/modules/bookings/booking-expiry.job.ts`, `apps/api/src/modules/outbox/outbox.worker.ts`
