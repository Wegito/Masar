@AGENTS.md

## Branch-Regeln für Pushes

- Wer pusht, pusht auf einen Branch mit dem eigenen Namen. Direkt auf `main` pusht niemand.
- Pushes von WEGITO (Konto `Wegito`, E-Mail `will.kall97@gmail.com`) gehen auf den Branch `william`.
- Pushes anderer Personen gehen auf einen Branch, der nach ihrem Namen heißt (zum Beispiel
  `haya` für HayaSaid). Hat eine Person noch keinen Branch, legt der Agent ihn mit ihrem Vornamen
  in Kleinbuchstaben an.
- Der Branch `william-design` gehört zu WEGITO und ist für die UI/UX-Arbeit auf dem Raspberry Pi
  (Bestätigung durch WEGITO am 2026-11-04). Er zweigt von `william` ab, Zusammenführung per Pull
  Request nach `william`.
- Der Branch `ultracode-tester` gehört zu WEGITO und ist für die Prüfsitzung in der Cloud
  (Auftrag in `docs/ultracode-tester.md`, Bestätigung durch WEGITO am 2026-11-04). Er zweigt von
  `william` ab, Zusammenführung per Pull Request nach `william`.
- Der Branch `william` ist der Stand von WEGITO. Eine Zusammenführung nach `main` läuft nur über
  einen Pull Request.
- Die Regel „nicht pushen, solange das GitHub-Repo öffentlich ist“ in `AGENTS.md` gilt weiter.
  Ein Agent pusht erst, wenn das Repo privat ist oder die Projektleitung es für diesen Push
  ausdrücklich freigibt.

## Befristeter Hinweis für Hayas nächste Sitzung

Dieser Abschnitt gilt, bis alle Fragen in `docs/entscheidungsblatt.md` beantwortet und eingearbeitet
sind. Dann löscht ein Agent ihn in einem eigenen Commit.

- **Wann:** Arbeitet die Person als Haya (Git-Name oder GitHub-Konto `HayaSaid`, Branch `haya`), sagt
  der Agent es gleich in der ersten Antwort der Sitzung, einmal, in wenigen Sätzen. Fragt Haya
  nach etwas anderem, kommt der Hinweis trotzdem zuerst, die Antwort danach. Ist die Sitzung nicht
  von Haya, bleibt der Abschnitt unbeachtet.
- **Inhalt des Hinweises (auf Deutsch):**
  1. WEGITO hat 16 offene Entscheidungsfragen aus den Prüfberichten gesammelt, jede mit Optionen und
     Empfehlung: `docs/entscheidungsblatt.md`. Dieselben Fragen gibt es als Artifact:
     <https://claude.ai/artifact/No41ec5s5fVPfSXvijE3ae> (nur mit Freigabe von WEGITO).
  2. Haya und WEGITO gehen sie gemeinsam durch. Haya kann die Fragen vorher lesen.
  3. `main` ist der aktuelle Stand. Vor der Arbeit `git pull` auf `main`, der Stand auf Hayas altem
     Branch ist älter.
- **Grenze:** Der Agent entscheidet die Fragen nicht und setzt keine Option um, die nicht in der
  Zeile „Antwort“ der Datei steht oder von Haya und WEGITO ausdrücklich bestätigt wurde.
