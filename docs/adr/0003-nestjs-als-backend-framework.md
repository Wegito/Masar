# ADR 0003: NestJS als Backend-Framework

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Das Backend soll in Node.js laufen. Es braucht klare Grenzen für Authentifizierung, Mandantentrennung zwischen Busfirmen, Validierung und eine dokumentierte API für Web, Portal und eine spätere native App. Das Team ist klein und nutzt KI-Werkzeuge stark; Struktur, die Grenzen erzwingt, ist deshalb wertvoll.

Versionsstand am 2026-10-12: `@nestjs/core` 12.1.2, `@nestjs/cli` 12.0.8. `nestjs-zod` 5.5.0 deklariert als Peer nur `@nestjs/common` ^10 oder ^11.

## Entscheidung

- Backend in **NestJS 12** unter `apps/api`, API-Präfix `/api/v1`.
- Module: `auth`, `users`, `companies`, `catalog`, `fleet`, `trips`, `bookings`, `payments`, `tickets`, `notifications`, `reports`, `admin`, `health`; Querschnitt `common`, `prisma`, `jobs`.
- Schichten: Controller (HTTP, Validierung, Guards) → Service (Anwendungsfall und **Transaktionsgrenze**) → Repository (Datenzugriff) → Datenbank.
- Entscheidungsregeln sind **reine Funktionen ohne Ein-/Ausgabe** in `modules/<modul>/domain/`: Geschlechtsregel, Segmentauflösung, Zustandsübergänge, Gebühren, Fristen.
- Autorisierung über eine Guard-Kette (Session → Rolle → Firmen-Scope). Zusätzlich verlangt jede Service- und Repository-Methode für Firmendaten die `companyId` als Pflichtparameter aus der geprüften Sitzung.
- Validierung mit **Zod**: Schemas in `packages/shared`, im Backend über eine eigene `ZodValidationPipe` (etwa 30 Zeilen), im Frontend für Formulare.
- OpenAPI über `@nestjs/swagger` mit aus Zod erzeugten JSON-Schemas, nur außerhalb der Produktion unter `/api/docs`.
- Konfiguration über `@nestjs/config` mit Zod-Schema; fehlende oder ungültige Werte brechen den Start ab.
- Testrunner: Vitest, wenn ein Spike in Schritt 0.5 zeigt, dass Decorator-Metadaten damit zuverlässig funktionieren; sonst Jest für die API.

## Begründung

- NestJS gibt Modulgrenzen, Dependency Injection und Guards vor. Das senkt das Risiko, dass Autorisierung an einer Stelle vergessen wird, und ist für KI-Werkzeuge und neue Teammitglieder gut bekannt.
- Reine Domänenfunktionen sind ohne Datenbank vollständig testbar. Die riskanten Regeln (Sitzvergabe, Zustände) lassen sich so mit vielen kleinen Tests absichern.
- Zod-Schemas einmal in `packages/shared` definiert, gelten in Backend und Formularen gleich.
- Eine eigene Pipe ist kleiner als das Risiko einer Bibliothek, die NestJS 12 nicht offiziell unterstützt.

## Konsequenzen

- **Positiv:** Einheitlicher Aufbau aller Module; Guards und Pipes sind zentral prüfbar.
- **Negativ:** Decorators und Dependency Injection sind „Magie" für Einsteiger. Fehler bei Decorator-Metadaten zeigen sich erst zur Laufzeit.
- **Negativ:** Eigene Pipe und eigene OpenAPI-Anbindung sind Code, den das Team pflegt.
- **Folgearbeit:** Spike Vitest mit NestJS-12-Decorators (Zeitbudget eine Stunde). Prüfen, welche Version von `@nestjs/swagger` zu NestJS 12 passt. Prüfen, ob NestJS 12 als CommonJS oder ESM betrieben wird.

## Verworfene Alternativen

- **Fastify mit einfachen TypeScript-Modulen:** leichter und expliziter, aber jede Grenze muss selbst entworfen und durchgehalten werden. In einem kleinen Team rutscht das leicht.
- **Nur Next.js-Route-Handler, kein eigenes Backend:** schnellster Start, aber Geschäftslogik landet in der Web-App. Eine native App oder Firmen-Integration hätte keine saubere API.
- **NestJS 11 mit `nestjs-zod`:** bleibt Rückfallebene, falls die eigene Pipe oder NestJS 12 Probleme macht (`@nestjs/core` Dist-Tag `legacy` = 11.2.7 am 2026-10-12).

## Annahmen und Revisionsauslöser

- Unbestätigt: Vitest verarbeitet die Decorator-Metadaten von NestJS 12 korrekt (Spike in Schritt 0.5).
- Unbestätigt: `@nestjs/swagger` für NestJS 12 akzeptiert die aus Zod 4 erzeugten JSON-Schemas ohne Nacharbeit.
- Neu bewerten, wenn `nestjs-zod` NestJS 12 offiziell unterstützt (eigene Pipe dann ersetzen).
- Neu bewerten, wenn der Spike scheitert oder NestJS beim Umstieg auf TypeScript 7 nicht mitzieht.

## Verweise

- ADR 0002 (Monorepo, TypeScript-Pin), ADR 0004 (Datenzugriff), ADR 0009 (Sessions und Guards), ADR 0015 (Fehlerformat)
- `docs/architektur.md`, `docs/api-konventionen.md`
- npm-Registry `@nestjs/core`, `@nestjs/cli`, `nestjs-zod` (abgefragt 2026-10-12)
