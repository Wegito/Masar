# Masar (مسار)

Online-Buchung für Fernbusse in Syrien. Fahrgäste suchen Fahrten zwischen Städten,
wählen ihren Sitz und reservieren oder bezahlen online, statt zum Schalter in der
Garage zu fahren. Busfirmen pflegen Routen, Fahrten und Sitzpläne in einem eigenen
Portal.

## Status

Fundament im Aufbau (Oktober 2026). Der Mock-Prototyp vom August 2025 ist unter dem
Git-Tag `prototype-2025-08` archiviert. Die Schrittfolge steht in `docs/roadmap.md`,
die Architekturentscheidungen in `docs/adr/`.

## Stack

- Backend: Node.js, NestJS, PostgreSQL, Prisma
- Web: Next.js (Fahrgast-App als PWA, Firmenportal), Arabisch und Englisch
- Monorepo mit pnpm Workspaces und Turborepo
- Betrieb: Docker Compose auf einem EU-VPS

## Sprachen

Dokumentation, Commits und Kommentare auf Deutsch. Code-Bezeichner auf Englisch.
Oberfläche auf Arabisch und Englisch.

## Dokumentation

Einstieg über `docs/README.md`.

## Lizenz

Proprietär, alle Rechte vorbehalten. Siehe `LICENSE`.
