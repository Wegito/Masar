# ADR 0001: Neustart statt Weiterentwicklung des Prototyps, proprietäre Lizenz

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Im Repo lag ein Prototyp vom August 2025. Beobachtet am 2026-10-12:

- Zwei fast identische Next.js-14-Apps (`apps/booking`, `apps/company`) mit Mock-Daten, ohne Backend, Datenbank und Authentifizierung.
- Ein Import-Alias zeigte auf ein nicht existierendes Verzeichnis; ein Build war damit nicht möglich.
- Eingechecktes Build-Output (`.next`, auch im Root) und IDE-Dateien (`.idea`).
- `node_modules/` war seit dem ersten Commit (`78ec15fc`, 2025-08-24) mit 24.314 Dateien getrackt. Der spätere `.gitignore`-Eintrag hat daran nichts geändert, weil `.gitignore` nur ungetrackte Dateien betrifft.
- Das Git-Verzeichnis ist dadurch rund 100 MB groß.
- `LICENSE` war Apache 2.0, das Repo `github.com/Wegito/Masar` ist öffentlich.

Masar soll ein kommerzielles Produkt mit einer syrischen Betreiberfirma werden.

## Entscheidung

- Der Prototyp wird nicht weiterentwickelt. Sein Stand bleibt unter dem annotierten Git-Tag `prototype-2025-08` erreichbar (zeigt auf `678df42b`).
- Der Arbeitsbaum wurde vollständig geleert, einschließlich `node_modules/`, `.next` und `.idea`. Übernommen werden nur Ideen: der Name „Masar" (مسار), die Trennung in eine Fahrgast-App und ein Firmenportal, die Markenfarben als Ausgangspunkt.
- `LICENSE` ist proprietär („Alle Rechte vorbehalten"). Die Rechte sollen auf die Betreibergesellschaft übergehen, sobald sie gegründet ist.
- Das GitHub-Repo wird privat gestellt. Die Umstellung braucht Admin-Rechte am Konto `Wegito`, dem das Repo gehört.
- **Bis zur Umstellung wird nichts gepusht.** Alle Commits des Neuaufbaus bleiben lokal.

## Begründung

- Der Prototyp enthält keine Logik, die sich zu übernehmen lohnt. Strukturfehler (doppelte Apps, kaputter Alias, eingecheckte Artefakte) würden in jedem späteren Schritt mitgeschleppt.
- Ein öffentliches Repo mit Apache-2.0-Lizenz erlaubt jedem die Nutzung des Codes, auch einem Wettbewerber. Für ein Produkt in einem Markt mit drei bestehenden Anbietern (HajzGo, Safra, Sham Bus) ist das nicht gewollt.
- Ein Tag ist billiger als ein Archiv-Branch und lässt sich nicht versehentlich weiterentwickeln.

## Konsequenzen

- **Positiv:** Sauberer Baum ohne Altlasten. Jede neue Datei ist bewusst angelegt.
- **Negativ:** Die Historie bleibt rund 100 MB groß, weil `node_modules/` in alten Commits steckt. Jeder Klon lädt diese Daten.
- **Negativ:** Code, der bis zur Umstellung öffentlich war, bleibt in fremden Klonen und Caches. Er enthält keine Geheimnisse; geprüft wurde die gesamte Historie außerhalb `node_modules/` auf Env- und Schlüsseldateien (keine gefunden, 2026-10-12).
- **Folgearbeit:** Umstellung auf privat durch einen Admin von `Wegito`. Danach entscheiden, ob die Historie bereinigt wird (siehe Revisionsauslöser).

## Verworfene Alternativen

- **Prototyp weiterentwickeln:** Alias reparieren, Duplikate zusammenführen, Backend daneben stellen. Schneller sichtbarer Start, aber die Struktur wurde nie entworfen.
- **Nur UI-Bausteine übernehmen:** Tailwind-Konfiguration und wenige Komponenten. Der Nutzen ist gering, weil Tailwind 4 und Next 16 ohnehin neue Konfigurationen verlangen.
- **Öffentlich und Open Source bleiben:** Wäre möglich gewesen, setzt aber Regeln voraus, dass nie Partnerdaten oder Vertragsdetails ins Repo gelangen. Später weiterhin möglich.
- **Lizenzfrage vertagen:** Abgelehnt, weil jeder Push bis dahin öffentlich gewesen wäre.

## Annahmen und Revisionsauslöser

- Annahme: Die Betreibergesellschaft übernimmt die Rechte am Code. Rechtsform und Zeitpunkt sind offen.
- Neu bewerten, wenn Open Source bewusst gewollt wird.
- Neu bewerten, wenn die Klon-Größe das Team spürbar behindert. Dann Historie mit `git filter-repo` bereinigen. Das schreibt die Historie um, braucht einen Force-Push und die Abstimmung mit allen, die schon geklont haben.

## Verweise

- `LICENSE`, `README.md`
- Tag `prototype-2025-08`; Commit „chore: Prototyp archivieren und Baum für den Neuaufbau leeren"
- ADR 0002 (neue Repo-Struktur)
