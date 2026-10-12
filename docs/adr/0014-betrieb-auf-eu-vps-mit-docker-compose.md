# ADR 0014: Betrieb auf einem EU-VPS mit Docker Compose, Caddy und Backups

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Masar muss aus Syrien gut erreichbar sein, für ein kleines Team betreibbar bleiben und Fahrgastdaten auf hohem Schutzniveau halten. Die Betreiberfirma wird syrisch sein; Hosting in der EU ist möglich. Große Cloud-Anbieter werfen für syrischen Verkehr und eine syrische Rechtsperson zusätzliche Fragen aus der Sanktionsgeschichte auf.

In der Fragerunde gewählt: **EU-VPS (z. B. Hetzner) mit Docker Compose**.

## Entscheidung

- Ein VPS in der EU. Docker Compose für Entwicklung und Produktion.
- Dienste in Produktion: `caddy` (Reverse Proxy, automatisches TLS), `api`, `web`, `portal`, `postgres`, `backup`. In der Entwicklung zusätzlich `mailpit`.
- Images werden in CI gebaut, mit dem Git-SHA getaggt und in der GitHub Container Registry abgelegt.
- Deploy: Images ziehen → `prisma migrate deploy` als Einmal-Container → Dienste neu starten.
- **Migrationen nur additiv (Expand/Contract):** Das vorherige Image muss mit dem neuen Schema laufen. Spalten werden erst entfernt, wenn kein laufendes Image sie mehr nutzt.
- **Rollback = vorheriges Image.** Es gibt keine Rückwärts-Migrationen.
- **Backups:** `pg_dump -Fc`, verschlüsselt, außerhalb des Servers. Täglich; während des Pilotbetriebs stündlich. Aufbewahrung 30 Tage.
- **Restore-Test:** wöchentlich automatisch in eine Wegwerf-Datenbank mit Plausibilitätsabfragen. Vor dem Pilot ein vollständiger Restore-Drill mit gemessener Dauer.
- **Ziele:** Wiederherstellungszeit (RTO) 4 Stunden, maximaler Datenverlust (RPO) 1 Stunde.
- **Überwachung:** `/api/health/live` und `/api/health/ready` ab Phase 0; `/api/health/deep` (hängende Holds, tote Jobs, Webhook-Fehler, Plattenplatz) und ein selbst gehosteter Uptime-Dienst in Phase 4.
- Keine Laufzeitabhängigkeit von Google-Diensten (Schriften, Captcha, Analyse); Browser-Fehler gehen an einen eigenen Endpunkt.

## Begründung

- Ein VPS mit Compose ist günstig, vollständig verständlich und mit einem Befehl reproduzierbar. Für die erwartete Pilotlast reicht ein Server (Annahme).
- Expand/Contract macht jeden Deploy rückrollbar, ohne Daten anzufassen.
- Bei einem Buchungssystem erzeugt ein alter Restore Tickets, die es nicht mehr gibt. Deshalb im Pilot stündliche Backups und ein geübter Restore mit Abgleich gegen Zahlungsanbieter und Firmenlisten.

## Konsequenzen

- **Positiv:** Kein Herstellerbezug; Wechsel des Anbieters ist ein Umzug von Containern und Backups.
- **Negativ, bewusst akzeptiert:** Keine Hochverfügbarkeit. Fällt der Server aus, ist Masar bis zur Wiederherstellung nicht erreichbar.
- **Negativ, bewusst akzeptiert:** Kurze Unterbrechung beim Deploy; Deploys außerhalb der abendlichen Buchungsspitze.
- **Folgearbeit:** Runbook für Deploy, Rollback, Backup und Restore (`docs/betrieb/runbook.md`); Erreichbarkeitstest aus Syrien vor dem Pilot.

## Verworfene Alternativen

- **Managed Cloud (AWS, GCP, Azure):** mehr Dienste, mehr Kosten, zusätzliche Fragen für syrischen Verkehr und eine syrische Rechtsperson.
- **Hosting in der Golfregion oder in Syrien:** geringste Latenz, aber Anbieterqualität und Zugang für den Betrieb aus Deutschland unbekannt.
- **Hosting offen lassen:** Deploy-Skripte und Backup-Konzept brauchen ein konkretes Ziel.

## Annahmen und Revisionsauslöser

- Unbestätigt: Erreichbarkeit und Latenz eines EU-Rechenzentrums aus syrischen Mobilnetzen.
- Unbestätigt: Ob syrisches Recht eine Datenhaltung im Inland verlangt. Prüfung durch die Betreiberfirma.
- Neu bewerten, wenn eine zweite API-Instanz nötig wird (Rate-Limits, Jobs), wenn Ausfallzeiten vertraglich begrenzt werden, oder wenn Messungen aus Syrien schlecht ausfallen.

## Verweise

- ADR 0004 (Migrationen), ADR 0016 (Backups und Löschung)
- `docs/betrieb/runbook.md`, `docs/sicherheit/bedrohungsmodell.md`
