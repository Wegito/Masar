# REPORTS: unabhängige Prüfberichte

Dieser Ordner enthält die Berichte der unabhängigen Prüfinstanz ("großer Boss"). Sie prüft nach dem
Abschluss einer Phase, was gebaut wurde, und liest dafür echten Code, nicht nur Agentenberichte.

## Namensschema

`JJJJ-MM-TT-phase-X.md`, zum Beispiel `2026-11-04-phase-1-bis-2-5.md`. Das Datum ist der Tag der Prüfung,
`X` nennt die geprüfte Phase oder den geprüften Schrittbereich.

## Regeln

- Berichte werden nie überschrieben und nie nachträglich geändert. Je Prüfung entsteht eine neue Datei.
  Spätere Berichte verweisen auf frühere Befunde und nennen, was daraus geworden ist.
- Die Prüfinstanz ändert keinen Code, keine Doku und keine Konfiguration. Sie schreibt nur ihren Bericht.
- Der Anhang jedes Berichts enthält die Prüfliste für den nächsten Durchgang.

## Ablauf

Nach dem Abschluss jeder Phase startet die Projektleitung (oder der Haupt-Agent) einen frischen
Prüf-Subagenten (Modell Fable, Effort medium). Er bekommt den Umfang (Phase, Endcommit, Ausschlüsse), liest
Doku und Code, führt Tests nur gegen eine eigene Testdatenbank aus und schreibt die neue Berichtsdatei.
Die Projektleitung entscheidet danach, welche Befunde in welcher Reihenfolge behoben werden.
