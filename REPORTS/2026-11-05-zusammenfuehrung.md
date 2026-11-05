# Zusammenführung aller Branches in `william` (2026-11-05)

Auftrag der Projektleitung: alle Branches außer `main` unter `william` vereinen, um eine letzte Version zu
bekommen. Dieser Bericht ist kein Prüfbericht einer Phase, sondern das Protokoll der Zusammenführung.

## Geprüfte Branches

Ausgangspunkt `origin/william` = `6e08618b`. Geprüft nach `git fetch origin` mit
`git rev-list --count origin/william..origin/<branch>`:

| Branch                 | Commits nicht in `william` | Ergebnis                                          |
| ---------------------- | -------------------------- | ------------------------------------------------- |
| `william-design`       | 0                          | bereits enthalten                                 |
| `ultracode-tester`     | 0                          | bereits enthalten                                 |
| `fundament/phase-0`    | 0                          | bereits enthalten                                 |
| `phase-1/ende-zu-ende` | 5                          | geprüft, Teile übernommen, historisch eingemischt |

Keine weiteren Remote-Branches. Kein Branch wurde gelöscht, umbenannt oder verändert.

## `phase-1/ende-zu-ende`

Fünf Commits von HayaSaid vom 2026-10-31, abgezweigt von `86e73d88` (Merge von `fundament/phase-0`). Sie sind
eine ältere Fassung der Roadmap-Schritte 1.1 bis 1.3. `william` setzt diese Schritte neu und umfassender um.

Übernommen (als eigene Commits auf `william`, neu angewendet, nicht der alte Baum):

- `a5af46fb` masar.localhost als lokale Origin gegen HTTP 431 → `45024de0`. In `william` nicht gelöst und
  weiter gültig: Der Browser schickt die `localhost`-Cookies aller lokalen Projekte an jeden Port, ab etwa
  16 KB Header lehnt Node mit 431 ab. Die API erlaubt jetzt standardmäßig zusätzlich
  `http://masar.localhost:3000` und `:3002` (CSRF-Prüfung). Web und Portal leiten `/api` über die eigene
  Origin weiter, dort war nichts zu ändern. Test: Anmeldung mit Origin `http://masar.localhost:3002` (200).
  Doku in `docs/setup.md` und `apps/api/.env.example`.
- Aus `113e0af0` der Runbook-Hinweis zu halb angewendeten Migrationen (Prisma nicht atomar, P3009,
  `migrate resolve`) → `015c1fea`. Der Hinweis fehlte in `william`.

Verworfen:

- `a54590c9`, `0c456475`, `d0aa6121` (Katalog/Flotte/Fahrten, Suche, Buchungskern): durch `william` ersetzt.
  Eigene Migrationen und Module würden mit denen in `william` kollidieren.
- `113e0af0` Agent-Konto im Demo-Seed (`--agent-email` mit Einrichtungslink): `william` legt Demo-Konten über
  `SEED_STAFF_*` und `SEED_PLATFORM_ADMIN_*` an, nur für den einen Aufruf gesetzt, ohne Passwort im Repo. Das
  Admin-Konto kann Barzahlungen ebenfalls bestätigen. Die übrigen Doku-Änderungen des Commits beschreiben den
  Stand vom 2026-10-31 und sind überholt.

Danach `git merge --no-ff -s ours origin/phase-1/ende-zu-ende` → `56356017`. Der Baum ist gleich dem von
`015c1fea`, die Historie enthält jetzt alle fünf Commits.

## Prüfergebnisse auf dem Endstand

Windows 11, Node 26, PostgreSQL 18 (portabel, 127.0.0.1:5432), Mailpit lokal. Die Dev-Server der Demo
wurden dafür beendet und danach neu gestartet.

| Prüfung                                | Ergebnis                                    |
| -------------------------------------- | ------------------------------------------- |
| `pnpm install --frozen-lockfile`       | grün                                        |
| `@masar/shared build`, `db:generate`   | grün                                        |
| `pnpm typecheck`                       | grün, 8 von 8 Tasks                         |
| `pnpm lint` (inklusive RTL, lint:root) | grün, 10 von 10 Tasks                       |
| `pnpm format:check`                    | grün                                        |
| `pnpm build`                           | grün, 9 von 9 Tasks                         |
| Unit-Tests `@masar/shared`             | 87 von 87 (11 Dateien)                      |
| Unit-Tests `@masar/web`                | 80 von 80 (8 Dateien)                       |
| Unit-Tests `@masar/portal`             | 73 von 73 (10 Dateien)                      |
| `pnpm --filter @masar/api test`        | 630 von 630 (73 Dateien) gegen `masar_test` |
| `pnpm test:e2e`                        | 40 von 40                                   |

Nach dem Push ergab `git rev-list --count origin/william..origin/<branch>` für alle vier Nicht-main-Branches 0.
Der Endstand von `origin/william` ist der Commit, der diesen Bericht enthält (`git log -1 origin/william`).

## Nicht geprüft

- `masar.localhost` im echten Browser mit vielen fremden Cookies; geprüft sind nur der API-Test und ein
  Abruf der Dev-Server unter diesem Hostnamen.
- Safari und Firefox, Linux und macOS; CI läuft weiterhin nicht auf `william`.
- `pnpm audit`.
