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
- Die Regel „nicht pushen, solange das GitHub-Repo öffentlich ist" in `AGENTS.md` gilt weiter.
  Ein Agent pusht erst, wenn das Repo privat ist oder die Projektleitung es für diesen Push
  ausdrücklich freigibt.
