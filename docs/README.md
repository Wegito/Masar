# Dokumentation

Einstieg für alle, die an Masar arbeiten. Die Doku ist auf Deutsch, Code-Bezeichner sind Englisch.

## Lesereihenfolge

1. [Glossar](glossar.md): Begriffe auf Arabisch, Englisch und Deutsch
2. [Architektur](architektur.md): Bausteine, Datenflüsse, Modulschnitt
3. [Domänenmodell](domaenenmodell.md): Tabellen, Zustandsautomaten, Invarianten
4. [Architekturentscheidungen](adr/README.md): was entschieden wurde und warum
5. [API-Konventionen](api-konventionen.md): Fehlerformat, Fehlercodes, Zeit, Geld, Versionierung
6. [Setup](setup.md): lokale Entwicklung

## Weitere Dokumente

- [Bedrohungsmodell](sicherheit/bedrohungsmodell.md): Akteure, Vertrauensgrenzen, Kontrollen
- [Datenschutz](datenschutz.md): welche Daten, wozu, wie lange
- [Runbook](betrieb/runbook.md): Betrieb, Vorfälle, Wiederherstellung
- [Roadmap](roadmap.md): Phasen und Schritte mit Stand
- [Offene Entscheidungen](offene-entscheidungen.md): was noch jemand entscheiden muss

## Kennzeichnung von Aussagen

Die Doku trennt, wie sicher eine Aussage ist:

| Kennzeichnung | Bedeutung                                                      |
| ------------- | -------------------------------------------------------------- |
| beobachtet    | direkt aus Code, Konfiguration oder einer Quelle gelesen       |
| verifiziert   | durch einen Befehl, Test oder eine Prüfung bestätigt           |
| angenommen    | plausibel, aber noch nicht bestätigt (meist mit einem Partner) |
| empfohlen     | Vorschlag, noch nicht umgesetzt                                |

Externe Angaben (Anbieter, Gesetze, Marktlage) tragen Quelle und Abrufdatum.
