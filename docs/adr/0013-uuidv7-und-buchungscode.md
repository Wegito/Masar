# ADR 0013: UUIDv7 intern, Buchungscode nach außen

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Buchungen sind ohne Konto über einen Code abrufbar (ADR 0009). Codes werden am Schalter vorgelesen, von Hand abgetippt und auf Tickets gedruckt. Fortlaufende IDs würden die Zahl der Buchungen verraten und das Durchprobieren erleichtern.

## Entscheidung

**Interne IDs**

- Primärschlüssel sind UUIDv7, in der Anwendung erzeugt. Fortlaufende Zahlen erscheinen nie nach außen.

**Buchungscode**

- 8 Zeichen aus dem Crockford-Base32-Alphabet (Ziffern und Großbuchstaben ohne `I`, `L`, `O`, `U`), erzeugt aus einem kryptografischen Zufallsgenerator. Das ergibt 32⁸ = 2⁴⁰ ≈ 1,1 Billionen Kombinationen.
- Anzeige in zwei Vierergruppen: `ABCD-EFGH`.
- Eingaben werden normalisiert: Kleinbuchstaben werden groß, Bindestriche und Leerzeichen entfallen, `O` wird `0`, `I` und `L` werden `1`.
- Eindeutiger Index; bei einer Kollision (`23505`) wird neu gewürfelt, höchstens dreimal.
- Ein Abruf braucht Code **und** Telefonnummer. Jede Abweichung ergibt dieselbe 404-Antwort. Abrufe sind je IP und je Code begrenzt.

**Weitere Geheimnisse**

- Verwaltungslink: 128 Bit Zufall, nur der Hash wird gespeichert.
- QR-Token im Ticket, Version 1: zufällig, nur der Hash wird gespeichert. Version 2 (Phase 4) wird signiert, damit Fahrer offline prüfen können.

## Begründung

- UUIDv7 ist zeitlich sortiert und schont dadurch B-Tree-Indizes, verrät aber keine Mengen.
- Crockford-Base32 vermeidet verwechselbare Zeichen. Die Normalisierung verzeiht typische Hör- und Tippfehler.
- 40 Bit allein reichen nicht gegen gezieltes Raten; zusammen mit der Telefonnummer und den Rate-Limits ist ein Durchprobieren praktisch ausgeschlossen.

## Konsequenzen

- **Positiv:** Kurze, vorlesbare Codes ohne Informationsverlust nach außen.
- **Negativ:** UUIDs sind lang in Logs und URLs des Portals. Akzeptiert.
- **Folgearbeit:** Code-Generator und Normalisierung mit Tests in `packages/shared`; Rate-Limit-Werte vor dem Pilot kalibrieren.

## Verworfene Alternativen

- **Fortlaufende IDs nach außen:** verraten Volumen und erleichtern Enumeration.

## Annahmen und Revisionsauslöser

- Prüfen in Schritt 0.6: PostgreSQL 18 bietet `uuidv7()` eingebaut. Bei Wahl von Version 18 können IDs auch in der Datenbank entstehen.
- Neu bewerten, wenn Kollisionen messbar häufig werden oder Rate-Limit-Treffer auf Durchprobieren hindeuten.
- Neu bewerten, wenn Codes per SMS verschickt werden und kürzer sein müssen.

## Verweise

- ADR 0009 (Gastzugriff), ADR 0004 (PostgreSQL-Version)
- Crockford Base32: https://www.crockford.com/base32.html

## Nachtrag 2026-10-12 (Schritt 0.7)

- IDs entstehen in der Datenbank (`DEFAULT uuidv7()`, PostgreSQL 18), nicht in der Anwendung. So bekommen auch Zeilen aus handgeschriebenem SQL (etwa `INSERT … SELECT` für Sitzbelegungen) eine ID, und es gibt genau eine Stelle, die IDs erzeugt.
