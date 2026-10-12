# ADR 0010: Mehrsprachigkeit Arabisch und Englisch

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Die Oberfläche muss Arabisch (Hauptsprache der Fahrgäste und des Personals) und Englisch unterstützen. Arabisch läuft von rechts nach links. Fahrgäste nutzen oft günstige Android-Geräte und schwache Netze. Preise, Uhrzeiten, Sitznummern und Buchungscodes werden am Schalter vorgelesen und abgetippt. Dokumentation, Commits und Code-Kommentare des Teams sind Deutsch.

## Entscheidung

- **Bibliothek:** `next-intl` in beiden Next.js-Apps.
- **Routing:** Sprachsegment in der URL, immer mit Präfix (`/ar/…`, `/en/…`). Standard ist `ar`. Erkennung: Cookie vor `Accept-Language`.
- **Leserichtung:** `<html lang dir>` je Sprache. Nur logische Tailwind-Utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`). Eine CI-Prüfung schlägt bei physischen Utilities (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`) an.
- **Schrift:** Noto Sans Arabic und Inter über `next/font`. Die Dateien werden beim Build geladen und selbst ausgeliefert.
- **Ziffern:** westliche Ziffern 0–9 in beiden Sprachen (`numberingSystem: 'latn'`).
- **Datum und Zeit:** `Intl.DateTimeFormat` mit `timeZone: 'Asia/Damascus'`. Für Arabisch gilt die Locale `ar-SY`; sie liefert die levantinischen Monatsnamen (Januar = كانون الثاني). Ein Unit-Test sichert das ab. Ohne Region liefert `ar` die Form يناير (verifiziert mit Node 26, ICU 78). Englisch nutzt `en-GB` (Tag vor Monat, wie in Syrien üblich).
- **Uhrzeit:** 24 Stunden in beiden Sprachen (`hourCycle h23`), weil AM/PM bei Nachtfahrten zu verpassten Bussen führen kann. Annahme; mit der ersten Firma prüfen, ob 12 Stunden mit ص/م erwartet werden.
- **Inhalte in der Datenbank:** zweisprachige Spalten (`name_ar`, `name_en`) für Städte, Haltestellen und Firmen.
- **Fehler:** Das Backend liefert stabile Codes mit Parametern (ADR 0015). Texte entstehen nur im Frontend.
- **Ausnahme Benachrichtigungen:** Vorlagen für E-Mail und spätere Kanäle rendert die API selbst, in ar und en im ICU-MessageFormat. Die Sprache des Fahrgasts wird an der Buchung gespeichert.
- **Deutsch** nur in Dokumentation, ADRs, Commits und Kommentaren. Code-Bezeichner sind Englisch.

## Begründung

- Ein festes Präfix macht jede Seite eindeutig verlinkbar und cachebar. Arabisch als Standard spiegelt die Hauptzielgruppe.
- Logische Utilities spiegeln das Layout automatisch. Physische Abstände wären in einer Sprache immer falsch.
- Selbst ausgelieferte Schriften vermeiden eine Laufzeitabhängigkeit von Google-Diensten, deren Erreichbarkeit aus Syrien nicht gesichert ist.
- Westliche Ziffern vermeiden Tippfehler beim Abgleich am Schalter, wenn Personal und Fahrgast verschiedene Ziffernsysteme gewohnt sind. Sie sind auf syrischen Belegen und Mobiltelefonen verbreitet (Annahme).
- Fehlercodes statt Texten trennen Übersetzung von Logik und halten die API stabil.

## Konsequenzen

- **Positiv:** Eine Codebasis für beide Leserichtungen.
- **Negativ:** Jede neue Oberfläche braucht Schlüssel in beiden Sprachen und eine Sichtprüfung in RTL. Das steht in der Definition of Done.
- **Negativ:** Benachrichtigungstexte liegen an zwei Orten (Frontend und API), mit demselben Format.
- **Folgearbeit:** CI-Prüfung für physische Utilities; Unit-Test für `ar-SY`-Monatsnamen; Glossar mit festen Übersetzungen der Fachbegriffe (`docs/glossar.md`).

## Verworfene Alternativen

- **Ostarabische Ziffern (٠–٩) in der arabischen Oberfläche:** in Druckwerken üblich, erhöht aber das Fehlerrisiko beim Abtippen von Codes und Sitznummern. Später als Einstellung möglich.

## Annahmen und Revisionsauslöser

- Annahme: Westliche Ziffern sind für die Zielgruppe gewohnt. Mit Nutzertests im Pilot prüfen.
- Annahme: Node und Browser liefern vollständige ICU-Daten für `ar-SY`. Edge-Runtimes mit reduzierten Daten meiden.
- Neu bewerten, wenn eine weitere Sprache dazukommt (zum Beispiel Kurdisch oder Türkisch).

## Verweise

- ADR 0012 (Zeit), ADR 0015 (Fehlerformat), ADR 0006 (Sitzplan-Oberfläche)
- `docs/glossar.md`, `docs/architektur.md`
