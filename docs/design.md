# Design: Bestandsaufnahme und Designsystem

Stand: 2026-11-04, Branch `william-design`. Zuständig: Raspberry Pi (UI/UX). Regeln und Grenzen stehen
in [Übergabe](uebergabe.md#rolle-des-raspberry-pi-uiux). Verhalten, API und Sicherheitsregeln bleiben
unverändert.

## Bestandsaufnahme (Ist-Zustand)

Screenshots: 32 Bilder (Portal und Fahrgast-App, `ar` und `en`, 360 px und 1280 px), erzeugt mit
Playwright gegen den lokalen Stack mit Demo-Daten. Sie liegen auf dem Pi unter `~/design-shots/before/`
und gehören nicht ins Repo. Geprüft ist bisher nur, was auf den Bildern zu sehen ist; Kontrast und
Tastaturbedienung sind noch nicht gemessen.

### Portal

| Nr  | Schwäche                                                                                                                                                                                                                   | Seite   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| P1  | Die Fahrtenliste besteht aus 21 gleich aussehenden Karten, die Hauptzeile mischt Abfahrt und Ankunft mit Datum in einem langen Satz. Wichtiges (Zeit, Strecke, Belegung) hebt sich nicht ab.                               | Fahrten |
| P2  | Die Planungsmaske ("Wochenplan") liegt unter der Liste und ist dadurch erst nach langem Scrollen erreichbar. Die Felder wirken ungeordnet (zwei Zeitzonen-Hinweise, Datumsfelder im Format `YYYY-MM-DD` als Beschriftung). | Fahrten |
| P3  | Die Startseite zeigt vier gestrichelte Karten mit "–" und "Die Zahlen erscheinen bald". Für die Vorführung wirkt das leer.                                                                                                 | Start   |
| P4  | Der Kopf bricht auf dem Smartphone auf drei Zeilen um (Firma, Konto und Sprache, Abmelden). Die Navigation ist eine waagerechte Reihe aus Knöpfen.                                                                         | Rahmen  |
| P5  | Statusmarken (z. B. "geplant") und Knöpfe haben keine einheitliche Gewichtung; Hauptaktion und Nebenaktion sehen ähnlich aus.                                                                                              | alle    |
| P6  | Auf dem Desktop ist die Seitenleiste schmal, der Inhalt nutzt die Breite schlecht.                                                                                                                                         | Rahmen  |

### Fahrgast-App

| Nr  | Schwäche                                                                                                                                            | Seite |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| W1  | Die Startseite ist klar, aber ohne Bild oder Wiedererkennung; die drei Hinweiskarten haben dasselbe Gewicht wie die Suche.                          | Start |
| W2  | Die Auswahlfelder (Städte, Datum, Anzahl) sind native `select`-Felder ohne eigene Gestaltung. Das ist zuverlässig und schnell, wirkt aber schlicht. | Start |

Nicht beanstandet: Der "N"-Kreis unten links ist die Entwicklungsanzeige von Next.js und kommt im Build
nicht vor.

## Ziele

1. Ein einheitlicher Look in Portal und Fahrgast-App (gemeinsame Tokens).
2. Das Portal wirkt bei der Vorführung wie ein fertiges Produkt: klare Hierarchie, ruhige Flächen,
   deutliche Hauptaktion, brauchbare Leer- und Ladezustände.
3. Auf 360 px gut bedienbar: Listen als Karten, Touch-Ziele mindestens 44 px, Aktionen erreichbar.
4. Kontrast mindestens WCAG AA, sichtbarer Fokus, Tastatur vollständig.
5. Leicht: Systemschrift, keine nachgeladenen Bilder oder Schriften.

## Designsystem (Entwurf, noch nicht umgesetzt)

Die Paletten-Entscheidung steht aus und wird mit WEGITO getroffen (nicht das frühere Gold auf Schwarz).
Bis dahin gilt dieser Rahmen:

- **Tokens:** Farbe (Fläche, Text, Rand, Primär, Erfolg, Warnung, Fehler), Abstand (4er-Raster), Schrift
  (Systemschrift, 5 Stufen), Radius (klein, mittel), Schatten (nur wenige, flach).
- **Basiskomponenten:** Knopf (primär, sekundär, gefährlich), Eingabe und Auswahl, Karte, Tabelle mit
  Kartenansicht auf dem Smartphone, Statusmarke, Hinweis, Leerzustand, Ladezustand, Fehlerzustand,
  Seitenkopf mit Aktion.
- **Umsetzung:** über Tailwind-Klassen und CSS-Variablen in einer gemeinsamen Datei; nur logische
  Klassen, keine Inline-Styles.

## Vorschläge, die Verhalten ändern (nicht umgesetzt)

- P2: Die Planungsmaske in einen eigenen Bereich oder Dialog verlegen, mit "Neuer Wochenplan" als Knopf im
  Seitenkopf. Das ändert den Ablauf, nicht die Funktion.
- P1: Fahrtenliste nach Tagen gruppieren und filtern. Braucht Gruppierung auf dem Client, kein neuer
  Endpunkt, aber ein Eingriff in die Seitenlogik.
- P3: Echte Zahlen für die Startseite ("Fahrten heute", "offene Barzahlungen") brauchen eine
  Zusammenfassungs-Schnittstelle der API (Aufgabe für den Haupt-PC).

## Nächste Schritte

1. Palette mit WEGITO wählen, Tokens und Basiskomponenten anlegen.
2. Portal: Rahmen und Startseite, dann Fahrten, Strecken, Flotte, Buchungen.
3. Fahrgast-App: Suche bis Ticket.
4. Kontrast, Tastatur, 360 px prüfen; Vorher-Nachher-Bilder sammeln.
