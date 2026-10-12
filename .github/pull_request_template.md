## Ziel

<!-- Welches Problem löst dieser PR, für wen? Link zu Roadmap-Schritt oder Issue. -->

## Verhaltensänderung

- Was tut das System jetzt anders?
- Was bleibt bewusst unverändert?

## Mechanische Änderungen

<!-- Formatierung, Umbenennungen, generierte Dateien, Lockfile. -->

## Risiken

<!-- Was kann schiefgehen? Wie würden wir es bemerken? -->

## Verifikation

<!-- Was genau wurde ausgeführt oder geprüft, mit Ergebnis? -->

## Nicht verifiziert

<!-- Was konnte nicht geprüft werden und warum? -->

## Migration und Rollback

- [ ] keine Datenbankmigration
- [ ] additive Migration (altes Image läuft mit neuem Schema weiter)
- [ ] entfernt etwas (nur nach vorherigem Release, das nicht mehr darauf zugreift)

Rollback:

## Definition of Done

- [ ] Verhalten und Fehlerpfad getestet; kritische Pfade mit Nebenläufigkeitstest
- [ ] Keine personenbezogenen Daten in Logs (Ausgabe geprüft)
- [ ] Neue Texte mit Schlüsseln in `ar` und `en`
- [ ] Neue Fehlercodes in `docs/api-konventionen.md` und `packages/shared`
- [ ] Doku und ADRs aktuell
- [ ] Oberfläche in beiden Sprachen inklusive RTL geprüft (falls betroffen)
