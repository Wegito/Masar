# ADR 0002: Monorepo mit pnpm und Turborepo, drei Apps

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Masar besteht aus einem Backend, einer Fahrgast-Web-App und einem Portal für Busfirmen und Plattform-Admins. Alle teilen Validierungsschemas, Fehlercodes und Enums. Das Team hat zwei bis drei Personen und arbeitet stark mit KI-Werkzeugen. Am 2026-10-12 lokal vorhanden: Node 26.0.0, pnpm 11.3.0, Docker 29.5.

## Entscheidung

Ein Repository mit pnpm Workspaces und Turborepo:

```
apps/api         NestJS, /api/v1
apps/web         Next.js, Fahrgäste, mobile-first, PWA
apps/portal      Next.js, Firmenportal (/company/…) und Plattform-Admin (/admin/…)
packages/shared  Zod-Schemas, Fehlercodes, Enums, Telefon-, Geld- und Zeit-Helfer
packages/config  ESLint- und Prettier-Konfiguration
```

- `packages/ui` entsteht erst, wenn eine Komponente zum dritten Mal dupliziert würde.
- **pnpm 11** (`packageManager: pnpm@11.3.0`). Projekteinstellungen stehen in `pnpm-workspace.yaml`:
  - `minimumReleaseAge: 1440`: Versionen werden erst installiert, wenn sie 24 Stunden veröffentlicht sind. Weil der Wert explizit gesetzt ist, bricht pnpm bei einem Verstoß ab, statt still auszuweichen.
  - `allowBuilds`: Build-Skripte von Abhängigkeiten laufen nur nach Freigabe. Nicht gelistete Pakete mit Build-Skripten lassen die Installation scheitern (`strictDepBuilds` ist Standard).
- **Turborepo** minimal: Tasks `build`, `lint`, `typecheck`, `test`, `dev`. `agentGuidance: false`.
- **TypeScript `~6.0`** im ganzen Repo. `tsconfig.base.json` mit `strict`, `noUncheckedIndexedAccess`, `module`/`moduleResolution` `nodenext`, `types: []`. Kein `baseUrl`.
- **Node:** `.nvmrc` = 26, `engines.node` = `>=24`, `@types/node` 24.
- **ESLint 10** mit einer `eslint.config.js` je Workspace, die die Basis aus `@masar/config` nutzt. Prettier zentral.
- Git-Hooks über `simple-git-hooks`: `lint-staged` vor dem Commit, `commitlint` (Conventional Commits, deutsche Betreffzeilen) für die Commit-Nachricht.

## Begründung

- **Ein Repo:** Schemas und Fehlercodes ändern sich zusammen mit API und Oberfläche. Ein Pull Request kann alle drei Seiten konsistent ändern.
- **Portal getrennt von der Fahrgast-App:** Staff-Sitzungen und die öffentliche App haben andere Sicherheitsannahmen. Das Fahrgast-Bundle bleibt klein, was bei schwachen Mobilnetzen in Syrien zählt. Der Admin-Bereich ist klein und nutzt dieselben Formulare wie das Firmenportal.
- **pnpm statt npm:** Das strikte `node_modules` deckt fehlende Abhängigkeitsdeklarationen auf. Die Lieferketten-Einstellungen gibt es in dieser Form nur in pnpm.
- **Lieferketten-Schutz:** Kompromittierte npm-Releases werden meist innerhalb von Stunden entdeckt. 24 Stunden Wartezeit kosten im Alltag fast nichts.
- **`agentGuidance: false`:** turbo 2.11 legt bei erkanntem KI-Agenten selbst eine `AGENTS.md` an und pflegt dort einen englischen Block. Das ist am 2026-10-12 beim ersten `turbo run` passiert. Agenten-Anweisungen pflegt das Team selbst und auf Deutsch in einer eigenen `AGENTS.md` (Codex liest sie direkt, Claude Code über `CLAUDE.md`, die sie importiert); der nützliche Kern (bei Turborepo-Fragen die mitgelieferte Doku unter `node_modules/turbo/docs` lesen) wird dort übernommen.
- **TypeScript 6.0 statt 7.0:** `@nestjs/cli` 12.0.8 verlangt `typescript ~6.0.2`, `typescript-eslint` 8.71 unterstützt `<6.1.0`. TypeScript 7.0.2 ist der neue native Compiler; NestJS braucht Decorator-Metadaten, deren Unterstützung im neuen Compiler unbestätigt ist.
- **`types: []` explizit:** TypeScript 6 lädt `@types/*` nicht mehr automatisch. Jedes Paket nennt seine Typpakete selbst.
- **Node 26, aber `engines >=24` und `@types/node` 24:** Node 26 ist am 2026-10-12 noch nicht LTS (erwartet Ende Oktober 2026, Annahme). Die Typen der kleinsten unterstützten Version verhindern, dass Code versehentlich Node-26-APIs nutzt und auf 24 bricht.
- **Eine ESLint-Config je Workspace:** ESLint 10 sucht die Konfiguration ab dem Verzeichnis jeder Datei. Next.js und NestJS brauchen unterschiedliche Regeln auf gemeinsamer Basis.

## Konsequenzen

- **Positiv:** Ein Befehl prüft alles (`pnpm lint`, `pnpm typecheck`, `pnpm test`). Gemeinsame Typen ohne Veröffentlichung von Paketen.
- **Positiv:** Neue Abhängigkeiten mit Install-Skripten fallen beim Hinzufügen auf und müssen bewusst freigegeben werden.
- **Negativ:** Sehr frische Versionen sind erst nach 24 Stunden installierbar. Notfall-Patches brauchen einen Eintrag in `minimumReleaseAgeExclude`.
- **Negativ:** Ein fehlschlagendes `prepare`-Skript lässt pnpm die gesamte Änderung zurückrollen. Beobachtet beim ersten Einrichten: Das Hinzufügen von Abhängigkeiten scheiterte, solange `simple-git-hooks` selbst noch nicht installiert war.
- **Folgearbeit:** Renovate mit eigener Mindestwartezeit einrichten. `packages/shared` wird mit `tsc` nach `dist` gebaut (ESM mit Typdeklarationen), damit die NestJS-API es zur Laufzeit laden kann; umgesetzt in Schritt 0.4.

## Verworfene Alternativen

- **npm Workspaces** (wie im Prototyp): kein strikter Abhängigkeitsbaum, keine vergleichbaren Lieferketten-Einstellungen.
- **Portal und Fahrgast-App in einer Next.js-App:** gemeinsames Bundle und gemeinsame Sitzungslogik für zwei Sicherheitszonen.
- **Admin als dritte Next.js-App:** zu klein für eigenen Betrieb.
- **TypeScript 7.0:** siehe Begründung; erneut prüfen, sobald NestJS-CLI und `typescript-eslint` es unterstützen.

## Annahmen und Revisionsauslöser

- Annahme: Node 26 wird Ende Oktober 2026 LTS. Danach Docker-Images und `engines` anheben.
- Neu bewerten, wenn NestJS und `typescript-eslint` TypeScript 7 offiziell unterstützen.
- Neu bewerten bei pnpm 12 (am 2026-10-12 als 12.11.2 verfügbar): Upgrade bewusst über einen eigenen Pull Request.
- Neu bewerten, wenn Build-Zeiten in CI über zehn Minuten steigen (Remote-Cache für Turborepo).

## Verweise

- `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `packages/config/`
- ADR 0001, ADR 0003
- pnpm-Einstellungen: https://pnpm.io/settings/build und https://pnpm.io/settings/dependency-resolution (abgerufen 2026-10-12)
- TypeScript 6.0 Release Notes: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html (abgerufen 2026-10-12)
- ESLint 10 Migration: https://eslint.org/docs/latest/use/migrate-to-10.0.0 (abgerufen 2026-10-12)
- turbo 2.11.7, mitgelieferte Doku `docs/guides/ai.mdx` und `docs/reference/configuration.mdx`
