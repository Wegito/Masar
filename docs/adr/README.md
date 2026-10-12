# Architekturentscheidungen (ADRs)

Ein ADR hält eine wichtige Entscheidung fest: den Kontext, die Entscheidung, ihre Gründe und ihre Folgen. So lässt sich später nachvollziehen, warum das System so gebaut ist, auch wenn niemand aus der damaligen Runde mehr dabei ist. ADRs ersetzen keine Fachdoku; sie erklären das „Warum" hinter ihr. Jedes ADR nennt außerdem, wann es neu bewertet werden muss.

## Wann braucht es ein neues ADR?

- Architektur und Systemgrenzen (neuer Dienst, neues Framework, neue App)
- Invarianten im Datenmodell (was die Datenbank erzwingt, Zustandsautomaten)
- Externe Anbieter (Zahlung, SMS, Hosting)
- Sicherheitsgrenzen (Authentifizierung, Autorisierung, Verschlüsselung, Datenschutz)
- Alles, was sich schwer rückgängig machen lässt

Kleine, leicht umkehrbare Entscheidungen gehören in den Pull Request, nicht in ein ADR.

## Ablauf

1. Vorlage `0000-vorlage.md` kopieren, nächste freie Nummer vergeben, Status „Vorgeschlagen".
2. Im Pull Request diskutieren; die Entscheidung trifft die Projektleitung.
3. Nach der Freigabe Status „Angenommen" setzen und den Index unten ergänzen.
4. **Ersetzen statt Umschreiben:** Ein angenommenes ADR wird inhaltlich nicht geändert. Ändert sich die Entscheidung, entsteht ein neues ADR; das alte bekommt den Status „Ersetzt durch 00xx". Tippfehler und Verweise dürfen korrigiert werden.

## Index

| Nr   | Titel                                                                                                                        | Status     | Datum      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| 0001 | [Neustart statt Weiterentwicklung des Prototyps, proprietäre Lizenz](0001-neustart-und-lizenz.md)                            | Angenommen | 2026-10-12 |
| 0002 | [Monorepo mit pnpm und Turborepo, drei Apps](0002-monorepo-mit-pnpm-und-turborepo.md)                                        | Angenommen | 2026-10-12 |
| 0003 | [NestJS als Backend-Framework](0003-nestjs-als-backend-framework.md)                                                         | Angenommen | 2026-10-12 |
| 0004 | [PostgreSQL und Prisma, kritische Pfade in explizitem SQL](0004-postgresql-und-prisma-kritische-pfade-in-sql.md)             | Angenommen | 2026-10-12 |
| 0005 | [Segmentbuchung und Sitzbelegung als eigene Tabelle](0005-segmentbuchung-und-sitzbelegung.md)                                | Angenommen | 2026-10-12 |
| 0006 | [Geschlechtssensible Sitzregel, serverseitig durchgesetzt](0006-geschlechtssensible-sitzregel.md)                            | Angenommen | 2026-10-12 |
| 0007 | [Online-Kontingent je Fahrt und akzeptiertes Restrisiko](0007-online-kontingent-je-fahrt.md)                                 | Angenommen | 2026-10-12 |
| 0008 | [Zahlungsabstraktion und Reihenfolge der Zahlwege](0008-zahlungsabstraktion-und-zahlwege.md)                                 | Angenommen | 2026-10-12 |
| 0009 | [Opake Sessions, Gastbuchung, OTP hinter einer Schnittstelle](0009-sessions-gastbuchung-und-otp.md)                          | Angenommen | 2026-10-12 |
| 0010 | [Mehrsprachigkeit Arabisch und Englisch](0010-mehrsprachigkeit-arabisch-englisch.md)                                         | Angenommen | 2026-10-12 |
| 0011 | [Geld als Integer in Minor-Units mit Währungsspalte](0011-geld-als-integer-in-minor-units.md)                                | Angenommen | 2026-10-12 |
| 0012 | [Zeit in UTC, Lokalzeit über Asia/Damascus](0012-zeit-in-utc-lokalzeit-asia-damascus.md)                                     | Angenommen | 2026-10-12 |
| 0013 | [UUIDv7 intern, Buchungscode nach außen](0013-uuidv7-und-buchungscode.md)                                                    | Angenommen | 2026-10-12 |
| 0014 | [Betrieb auf einem EU-VPS mit Docker Compose, Caddy und Backups](0014-betrieb-auf-eu-vps-mit-docker-compose.md)              | Angenommen | 2026-10-12 |
| 0015 | [Fehlerformat nach RFC 9457 mit stabilen Fehlercodes](0015-fehlerformat-rfc-9457.md)                                         | Angenommen | 2026-10-12 |
| 0016 | [Datenminimierung, Verschlüsselung der Ausweisnummer, Löschfristen](0016-datenminimierung-verschluesselung-loeschfristen.md) | Angenommen | 2026-10-12 |
| 0017 | [Provision nach Leistungsmonat](0017-provision-nach-leistungsmonat.md)                                                       | Angenommen | 2026-10-12 |
