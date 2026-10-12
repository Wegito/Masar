# Masar – Anweisungen für Coding-Agenten

Diese Datei gilt für alle KI-Werkzeuge im Projekt. Claude Code liest sie über `CLAUDE.md`,
Codex direkt. Sie enthält Regeln. Begründungen stehen in `docs/adr/`.

## Projekt

Masar ist eine Buchungsplattform für Fernbusse (Pullman) in Syrien. Fahrgäste suchen Fahrten,
wählen Sitze und reservieren oder bezahlen online. Busfirmen pflegen Routen, Fahrten und Sitzpläne
im Portal. Der fachliche Kern sind ein exaktes Sitzinventar je Teilstrecke (Segment) und eine
geschlechtssensible Sitzregel. Einstieg in die Doku: `docs/README.md`.

## Sprache

- Chat, Doku, ADRs, Commit-Nachrichten und Code-Kommentare: Deutsch.
- Code-Bezeichner, API-Felder, Fehlercodes, Dateinamen im Code: Englisch.
- Oberfläche: Arabisch (Standard) und Englisch. Deutsch erscheint nie in der Oberfläche.

## Stack und gepinnte Versionen

| Werkzeug   | Version                        | Warum gepinnt                                      |
| ---------- | ------------------------------ | -------------------------------------------------- |
| Node.js    | 26 (`.nvmrc`), `engines >= 24` | `@types/node` 24 = kleinste unterstützte Laufzeit  |
| pnpm       | 11.3 (`packageManager`)        | Einstellungen leben in `pnpm-workspace.yaml`       |
| TypeScript | `~6.0`                         | NestJS-CLI verlangt 6.0, typescript-eslint `< 6.1` |
| NestJS     | 12 (ab Schritt 0.5)            | `nestjs-zod` unterstützt 12 nicht: eigene Zod-Pipe |
| Prisma     | 7.10 (ab Schritt 0.6)          | 8.0 ist nur Release Candidate                      |
| PostgreSQL | 17                             | EXCLUDE-Constraint mit `btree_gist`                |
| Next.js    | 16 (ab Schritt 0.8)            | App Router, `next-intl` 4                          |
| Vitest     | 5                              | ein Test-Runner im ganzen Repo                     |

Ein Major-Upgrade eines gepinnten Werkzeugs braucht ein ADR.

## Befehle

```sh
pnpm install            # installiert auch die Git-Hooks
pnpm lint               # ESLint in allen Workspaces und im Wurzelverzeichnis
pnpm typecheck
pnpm test
pnpm build
pnpm format             # Prettier schreiben; format:check nur prüfen
pnpm --filter @masar/shared test   # Skript in einem Workspace
```

## Struktur

```
apps/api         NestJS, /api/v1 (ab Schritt 0.5)
apps/web         Next.js, Fahrgäste, PWA (ab Schritt 0.8)
apps/portal      Next.js, Firmenportal und Plattform-Admin (ab Schritt 0.8)
packages/shared  Fehlercodes, Enums, Telefon-, Geld-, Zeit- und Buchungscode-Helfer
packages/config  ESLint- und Prettier-Basis
docs/            Doku auf Deutsch, ADRs unter docs/adr/
```

## Regeln

### Architektur

- API-Schichten: Controller → Service (Transaktionsgrenze) → Repository → Datenbank.
- Entscheidungslogik (Sitzregel, Segmente, Zustandsübergänge, Fristen, Gebühren) als reine
  Funktionen in `modules/<modul>/domain/`, ohne Ein- und Ausgabe, mit Unit-Tests.
- Firmenbezogene Daten: `companyId` kommt immer aus der geprüften Sitzung, nie aus dem Request.

### Kritische Pfade: Sitzinventar, Zahlungen, Auth

- Reihenfolge: Trip-Zeile sperren → frisch lesen → prüfen → schreiben.
- Jeder Schreibzugriff auf `seat_occupation` läuft über den Buchungsservice unter der Trip-Sperre.
- Sperr-Reihenfolge immer Trip → Booking → Payment.
- Jeder neue kritische Pfad braucht einen Nebenläufigkeitstest mit zwei echten DB-Verbindungen.
- Nicht umkehrbare externe Aufrufe: Versuch vorher festschreiben; der Fehlerpfad löscht ihn nie.

### Datenbank

- Angewandte Migrationen nie ändern. Migrationen sind additiv (Expand/Contract).
- Handgeschriebenes SQL in Migrationen (EXCLUDE, Extensions) braucht einen Test, der seine Existenz
  in der Datenbank prüft.
- Geld als Integer in Minor-Units plus Währungsspalte, nie Fließkomma.
- Zeitpunkte als `timestamptz` in UTC. Lokalzeit nur über die Zone `Asia/Damascus`.

### Personenbezogene Daten

- Nie in Logs: Telefonnummer, Name, Ausweisnummer, Geschlecht, Tokens, Buchungscodes. Personen nur
  über IDs referenzieren.
- Ausweisnummern nur verschlüsselt speichern.
- Fehlerantworten nach RFC 9457 mit stabilem `code`. Texte entstehen nur im Frontend.

### Oberfläche

- Nur logische Tailwind-Utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`).
- Ziffern immer westlich (`latn`), Uhrzeit 24 Stunden, Zeitzone `Asia/Damascus`, Arabisch mit
  Region `ar-SY` (nur so erscheinen die levantinischen Monatsnamen).
- Jeder neue Text braucht Schlüssel in `ar` und `en`.

### Abhängigkeiten und Werkzeuge

- Pakete nur mit `pnpm add` hinzufügen. pnpm installiert nur Versionen, die mindestens 24 Stunden
  alt sind (`minimumReleaseAge`); keine jüngeren Versionen von Hand eintragen.
- Pakete mit Build-Skripten in `pnpm-workspace.yaml` unter `allowBuilds` bewusst freigeben oder
  sperren, mit Kommentar.
- TypeScript 6 lädt `@types/*` nicht automatisch: `types` in jeder `tsconfig.json` explizit setzen.
- Turborepo kann sich anders verhalten als in Trainingsdaten. Vor Änderungen die mitgelieferte Doku
  lesen: `node -p "require.resolve('turbo/package.json')"` zeigt das Paket, darin `docs/`.
- `turbo.json` setzt `agentGuidance: false`, damit turbo keine eigene `AGENTS.md` pflegt.

### Git

- Conventional Commits auf Deutsch, Scope = Modul: `feat(bookings): Sitzplatz-Hold mit Ablauf`.
- Erst stagen, die Liste prüfen, dann committen. Werkzeuge legen manchmal unerwartet Dateien an.
- Keine Hooks umgehen (`--no-verify`).
- Architekturänderung: zuerst ein ADR.
- Vorübergehend: nicht pushen, solange das GitHub-Repo öffentlich ist
  (siehe `docs/offene-entscheidungen.md`).

## Definition of Done

- Verhalten und Fehlerpfad sind getestet; kritische Pfade zusätzlich mit Nebenläufigkeitstest.
- Migration ist additiv und reviewt.
- Doku und ADRs sind aktuell; neue Fehlercodes stehen in `docs/api-konventionen.md`.
- Neue Texte haben Schlüssel in `ar` und `en`.
- Die Log-Ausgabe des neuen Pfads enthält keine personenbezogenen Daten.
- Oberfläche: beide Sprachen inklusive RTL manuell geprüft.
- Die PR-Beschreibung trennt Verifiziertes von Nicht-Verifiziertem.
