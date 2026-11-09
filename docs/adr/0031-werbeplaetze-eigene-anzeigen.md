# ADR 0031: Werbeplätze mit eigenen Anzeigen

Status: Vorschlag · Datum: 2026-11-04 · Entschieden von: Projektleitung (Wunsch im Gespräch vom 2026-11-04), Ausgestaltung offen

## Kontext

Die Projektleitung will in der Fahrgast-App später Platz für **lokale Werbung** vorsehen. Die Anzeigen
sollen nicht über einen Werbedienst wie Google laufen, sondern von der Projektleitung selbst
hochgeladen werden. Ein zweiter Einnahmeweg neben der Lizenz (ADR 0029) wird so möglich.

`AGENTS.md` verbietet Drittanbieter-Dienste für Fehlerberichte; die Datenschutzlinie des Projekts ist
streng: keine Personendaten an Dritte, keine fremden Tracker. Werbung darf das nicht aufweichen.

## Entscheidung (Vorschlag)

- **Eigene Anzeigen, kein Werbenetzwerk.** Der Plattform-Admin lädt Anzeigen hoch (Bild, Zielseite oder
  Telefonnummer, Zeitraum, Platz, Sprache) und pflegt sie im Admin-Bereich.
- **Plätze:** ausgewählte, feste Stellen, zum Beispiel auf der Ergebnisliste, der Ticketseite und der
  Startseite. Jeder Platz hat eine feste Größe. Anzeigen sind klar als "Werbung / إعلان" gekennzeichnet.
- **Auslieferung vom eigenen Server:** Bilder kommen von derselben Herkunft wie die App (CSP
  `img-src 'self'`), klein und optimiert (schwaches Netz). Kein Skript von Dritten.
- **Kein Tracking:** keine Cookies und keine Geräte-IDs für Werbung, keine Weitergabe von Buchungsdaten.
  Zielgruppen ergeben sich nur aus dem Kontext (Strecke, Stadt, Sprache), nicht aus Personendaten.
  Zählungen von Einblendungen und Klicks sind aggregiert und ohne Personenbezug.
- **Inhalte:** Prüfung vor der Veröffentlichung durch den Plattform-Admin; keine Werbung auf der
  Zahlungsseite und nie in Bereichen, in denen Fahrgäste Daten eingeben.
- **Zeitpunkt:** nach dem Pilot (Phase 4 oder später), wenn Fahrgäste da sind. Bis dahin nur der
  reservierte Platz im Layout, damit das Design (Raspberry Pi) ihn einplanen kann.

## Begründung

- Eigene Anzeigen halten Datenschutz, CSP und Ladezeit unter Kontrolle.
- Lokale Betriebe (Cafés, Hotels, Autovermieter an den Stationen) sind für Fahrgäste relevant und für
  Masar leichter zu gewinnen als ein Werbenetzwerk.

## Konsequenzen

- **Positiv:** zusätzliche Einnahmen ohne Provision; volle Kontrolle über Inhalte.
- **Negativ:** Vertrieb, Rechnungen und Moderation sind Handarbeit.
- **Negativ:** Ohne Tracking sind Wirkung und Abrechnung grob (Zeiträume, nicht Klicks).
- **Folgearbeit:** Datenmodell `ad` (Platz, Zeitraum, Sprache, Bild, Ziel, Status), Upload im Admin-Bereich
  mit Größen- und Typprüfung, Auslieferung mit Zeitfenster, Datenschutztext ergänzen.

## Offene Punkte

- Welche Plätze genau, welche Größen, welche Preise.
- Rechtliche Vorgaben für Werbung in Syrien und Kennzeichnung.
- Ob Firmen eigene Anzeigen für ihre Strecken buchen dürfen.

## Verweise

- ADR 0029 (Lizenz), `docs/datenschutz.md`
