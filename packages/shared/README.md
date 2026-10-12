# @masar/shared

Fachliche Bausteine, die API, Fahrgast-App und Portal gemeinsam nutzen. Läuft im Browser und in
Node: Der Quellcode darf keine Node-APIs verwenden (der Build prüft das mit `types: []`).

| Modul              | Inhalt                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `errors.ts`        | Stabile Fehlercodes mit HTTP-Status; synchron mit `docs/api-konventionen.md` (Test prüft das) |
| `enums.ts`         | Status, Rollen, Kanäle, Zahlwege                                                              |
| `locale.ts`        | Sprachen `ar` und `en`, Leserichtung, Intl-Locale (`ar-SY`, `en-GB`, westliche Ziffern, 24 h) |
| `digits.ts`        | Arabisch-indische Ziffern umwandeln, unsichtbare Richtungszeichen entfernen                   |
| `phone.ts`         | Telefonnummern auf E.164 normalisieren; Standardland Syrien                                   |
| `money.ts`         | Beträge als ganze Zahlen in Minor-Units, Formatierung                                         |
| `time.ts`          | Formatierung und Kalendertage in `Asia/Damascus`                                              |
| `booking-code.ts`  | Buchungscodes nach Crockford-Base32: kodieren, normalisieren, anzeigen                        |
| `email.ts`         | E-Mail-Adressen normalisieren (NFC, ohne Leerraum am Rand, klein geschrieben)                 |
| `path.ts`          | Seitenpfade für Logs und Fehlerberichte bereinigen: nur statische Segmente bleiben            |
| `client-errors.ts` | Vertrag für Fehlerberichte aus dem Browser: Felder und Höchstlängen                           |

Gebaut wird mit `tsc` nach `dist/` (ESM mit Typdeklarationen). Abhängige Workspaces brauchen deshalb
vorher `pnpm --filter @masar/shared build`; Turborepo erledigt das über `dependsOn: ["^build"]`.

```sh
pnpm --filter @masar/shared test
pnpm --filter @masar/shared build
```
