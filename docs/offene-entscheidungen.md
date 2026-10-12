# Offene Entscheidungen

Was noch jemand entscheiden oder klären muss. Erledigte Punkte wandern in ein ADR oder werden mit
Datum gestrichen.

## Blockierend vor dem ersten Push

| Thema             | Frage                                                                                                                                                                                                                    | Empfehlung                                                                                         | Wer                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------- |
| Sichtbarkeit Repo | `github.com/Wegito/Masar` ist öffentlich (beobachtet 2026-10-12). Entschieden: privat stellen                                                                                                                            | Vor dem ersten Push umstellen. Bis dahin gilt in `AGENTS.md`: nicht pushen                         | Admin des Kontos `Wegito` |
| Git-Historie      | Der erste Commit enthält `node_modules` (24.314 Dateien, Historie rund 100 MB). Der Prototyp-Commit enthält außerdem einen Next.js-Build-Schlüssel (siehe `.gitleaksignore`); klären, ob dieser Build je betrieben wurde | Optional mit `git filter-repo` bereinigen, nur bevor weitere Personen klonen; erfordert Force-Push | Admin des Kontos `Wegito` |

## Vor Phase 1 oder während Phase 0

| Thema                     | Frage                                                                                                                                                                                 | Empfehlung                                                                                                       | Wer            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------- |
| Team und Reviews          | GitHub-Konten der Teammitglieder für CODEOWNERS; Branch-Schutz auf `main`                                                                                                             | Zwei Personen für `bookings`, `payments`, `auth`, `prisma`; PR-Pflicht, ein Review, CI grün                      | Projektleitung |
| Renovate                  | Renovate-App auf dem Repo installieren                                                                                                                                                | Installieren, sobald das Repo privat ist                                                                         | Admin `Wegito` |
| pnpm 12                   | pnpm 12.11 ist erschienen (beobachtet 2026-10-12), gepinnt ist 11.3                                                                                                                   | Nach Phase 0 per Renovate-PR prüfen, Änderungen der Einstellungen lesen                                          | Team           |
| Abhängigkeits-Vorgaben    | `overrides` für `mysql2` und `deepmerge-ts` schließen Lücken aus `pnpm audit` (nur über die Prisma-CLI)                                                                               | Entfernen, sobald Prisma gepatchte Versionen mitbringt; Renovate-PRs zu Prisma darauf prüfen                     | Team           |
| Ignorierte Audit-Meldung  | `pnpm audit` meldet GHSA-vfj7-8cjw-p6xm (braces, hoch). Es gibt keine gepatchte Version; braces kommt nur über das ESLint-Plugin von Next.js, also nur beim Linten                    | Bewusst ignoriert über `auditConfig.ignoreGhsas` (2026-10-12). Entfernen, sobald braces einen Fix veröffentlicht | Team           |
| Aufräumen von Sitzungen   | Abgelaufene Sitzungen, Reset-Links und Einladungen bleiben mit IP und User-Agent liegen                                                                                               | Job mit pg-boss in Schritt 1.3: 30 Tage nach Ablauf löschen                                                      | Team           |
| Zweitfaktor               | TOTP für Firmen- und Plattform-Admins (Bedrohungsmodell, vor Pilot)                                                                                                                   | Portal-Login steht seit Schritt 0.8; Konzept zusammen mit der Staff-Verwaltung in Phase 2                        | Projektleitung |
| Uhrzeitformat             | 24 Stunden oder 12 Stunden mit ص/م                                                                                                                                                    | Annahme 24 Stunden (eindeutig bei Nachtfahrten); mit erster Firma prüfen                                         | Produkt        |
| Node 26 LTS               | Node 26 wird voraussichtlich Ende Oktober 2026 LTS                                                                                                                                    | Danach `engines` auf `>= 26` anheben, wenn nichts dagegen spricht                                                | Team           |
| Rundung Provision         | Wie wird die Provision je Buchung gerundet?                                                                                                                                           | Vorschlag: je Zeile kaufmännisch auf ganze Minor-Units, Summe aus gerundeten Zeilen (ADR 0011, 0017)             | Projektleitung |
| Standard-Kontingent       | Welche Sitze sind bei einer neuen Fahrt online verkäuflich?                                                                                                                           | Im Portal-Entwurf entscheiden (Phase 2); bis dahin setzt der Seed das Kontingent ausdrücklich                    | Produkt        |
| Aufbewahrung Audit        | Wie lange bleiben Audit-Einträge?                                                                                                                                                     | Vorschlag 24 Monate; mit Partner und Recht festlegen                                                             | Projektleitung |
| CSP der Web-App           | Die Seiten sind statisch vorgerendert; ein Nonce je Anfrage verlangt dynamisches Rendern. Die Next.js-Doku nennt Subresource Integrity als experimentellen Weg ohne Nonce (ungeprüft) | Vor Schritt 1.5 entscheiden, wenn Formulare mit Fahrgastdaten kommen; Ladezeit auf schwachen Netzen mitmessen    | Team           |
| E2E in jedem Pull Request | Playwright läuft nach Push auf `main`, nachts und mit Label `e2e`, nicht in jedem PR (Laufzeit, Actions-Minuten im privaten Repo)                                                     | Beibehalten; neu bewerten, wenn Regressionen erst nach dem Merge auffallen                                       | Team           |

## Erledigt

- 2026-10-12: PostgreSQL-Version entschieden: 18.6 (ADR 0004, Nachtrag).

## Mit der ersten Partnerfirma klären

| Thema                    | Frage                                                                              | Annahme bis dahin                                                 |
| ------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Ausweisnummer            | Verlangen Firmen oder Kontrollpunkte die Ausweisnummer auf dem Ticket?             | optional je Firma (`require_national_id`)                         |
| Löschfristen             | Wie lange müssen Fahrgastdaten aufbewahrt werden?                                  | Ausweisnummer 30 Tage nach Abfahrt, Name und Telefon 12 Monate    |
| Barfrist                 | Bis wann vor Abfahrt muss bar bezahlt sein, oder geht es beim Einsteigen?          | 120 Minuten vor Abfahrt, je Firma einstellbar                     |
| Storno bei Fahrtänderung | Ab welcher Verschiebung darf kostenlos storniert werden?                           | mehr als 60 Minuten                                               |
| Sitzplan-Praxis          | Welche Layouts (2+2, 2+1, Hinterbank) und welche Nummerierung nutzen Firmen?       | 2+2 mit 45 Sitzen und 2+1 VIP                                     |
| Kontingent               | Wie viele Sitze gibt eine Firma online frei, und wie wird der Schalter informiert? | Firma markiert je Fahrt; Restrisiko akzeptiert (ADR 0007)         |
| Provision                | Satz und Abrechnungsweg                                                            | Satz je Firma, monatlicher Bericht nach Leistungsmonat (ADR 0017) |

## Externe Anbieter und Recht

| Thema                     | Frage                                                                                                         | Stand                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ecash                     | Händlerkonto je Busfirma (Masar verwahrt Zugangsdaten verschlüsselt) oder Plattform-Modell mit Unterhändlern? | unbekannt; Sandbox-Zugang nur nach Registrierung (Anbieterseite, abgerufen 2026-10-12) |
| SMS und WhatsApp          | Welcher Anbieter stellt zuverlässig an syrische Nummern zu, und ist das für Nicht-Banken erlaubt?             | unklar; Gastbuchung funktioniert ohne Einmalcode                                       |
| Syrisches Datenrecht      | Welche Vorgaben gelten (u. a. Cybercrime-Gesetz Nr. 20/2022)?                                                 | unverifiziert; Maßstab bis dahin DSGVO-Niveau                                          |
| Erreichbarkeit            | Sind Hetzner, Let's Encrypt und ein Fehler-Tracking-Dienst aus Syrien zuverlässig erreichbar?                 | ungetestet; Messung mit Testperson in Phase 5                                          |
| Zahlungen aus dem Ausland | Welche Rechtsperson und welcher Anbieter für internationale Karten?                                           | Phase 2 der Zahlungen; Datenmodell ist vorbereitet                                     |
