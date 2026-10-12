# ADR 0009: Opake Sessions, Gastbuchung, OTP hinter einer Schnittstelle

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

In Syrien ist die Telefonnummer die natürliche Identität. SMS ist als Kanal aber unsicher: Laut einer Sekundärquelle hat Twilio die SMS-Zustellung nach Syrien zum 15. September 2025 eingestellt. Dort ist nur OTP- und Bankverkehr erlaubt, und die Zustellung gilt als unzuverlässig. Ob MTN Syria als Netz für Geschäftsnachrichten verfügbar ist, widerspricht sich in den Quellen. WhatsApp ist verbreitet, aber die Verfügbarkeit der Business-API für eine syrische Firma ist ungeklärt.

Busfirmen-Personal braucht feste Konten mit Rollen. Später soll eine native App dieselbe API nutzen.

In der Fragerunde gewählt: **Gastbuchung mit optionalem Konto**; OTP-Kanal hinter einer Schnittstelle.

## Entscheidung

**Sitzungen**

- Sitzungen sind opake Tokens in PostgreSQL: `session(id, user_id, kind, token_hash, expires_at, revoked_at, ip, user_agent)`.
- Token: 32 Zufallsbytes; gespeichert wird nur der SHA-256-Hash.
- Web: Cookie `__Host-masar_session` mit `Secure`, `HttpOnly`, `SameSite=Lax`.
- Derselbe Guard akzeptiert `Authorization: Bearer` für eine spätere native App.
- Web und Portal rufen die API über ein Same-Origin-Rewrite (`/api/*`) auf; im Browser gibt es kein CORS.

**Personal der Busfirmen und der Plattform**

- E-Mail und Passwort; Passwörter mit Argon2id (`@node-rs/argon2`, 64 MiB, 3 Durchläufe, Parallelität 1).
- Konten entstehen per Einladung, nicht per Selbstregistrierung. Passwort-Reset per E-Mail mit einmaligem, kurzlebigem Token.
- Fehlversuche verzögern progressiv, statt das Konto hart zu sperren.
- Rollen: `is_platform_admin` global; je Firma `company_member.role` = `ADMIN`, `AGENT` oder `DRIVER`.
- Guard-Kette: Session → Rolle → Firmen-Scope. Die `companyId` kommt aus der geprüften Mitgliedschaft, nie aus dem Request-Body.
- TOTP-MFA für Firmen-Admins und Plattform-Admins vor dem Pilotbetrieb.

**Fahrgäste**

- Buchen ohne Konto mit Name und Telefonnummer.
- Zugriff auf eine Buchung über Buchungscode **und** Telefonnummer (ergibt ein kurzlebiges, auf diese Buchung begrenztes Token) oder über einen Verwaltungslink mit 128-Bit-Geheimnis (nur der Hash wird gespeichert).
- Falscher Code und falsche Telefonnummer ergeben dieselbe Antwort (404). Abfragen sind je IP und je Code begrenzt.
- Optionales Konto mit Telefonnummer als Identität, sobald ein OTP-Kanal bestätigt ist.

**OTP-Kanal**

- Schnittstelle `OtpChannel` mit `LogOtpChannel` (Entwicklung) und `NullOtpChannel` (ausgeschaltet).
- Adapter für SMS oder WhatsApp erst nach Bestätigung eines Anbieters, der Syrien zuverlässig erreicht.
- OTP: sechs Ziffern, gehasht gespeichert, kurze Gültigkeit, begrenzte Versuche.

**CSRF und Missbrauch**

- `SameSite=Lax` plus Prüfung von `Origin` und `Sec-Fetch-Site` gegen eine Allowlist; zustandsändernde Requests nur als JSON.
- Rate-Limits mit `@nestjs/throttler` (In-Memory, eine Instanz) und zusätzlich im Reverse Proxy.

## Begründung

- Gastbuchung macht den Start unabhängig von SMS. Die Telefonnummer bleibt Kontaktweg und Zugriffsfaktor.
- Opake Sessions lassen sich sofort serverseitig widerrufen, je Gerät. Bei einem verlorenen Schalter-Tablet zählt das mehr als zustandslose Tokens.
- Gehashte Tokens machen einen Datenbank-Dump als Sitzungsquelle wertlos.
- Einladung statt Selbstregistrierung hält fremde Personen aus den Firmenportalen fern.

## Konsequenzen

- **Positiv:** Kein externer Dienst ist für den Kernfluss nötig.
- **Positiv:** Native App kann später dieselben Endpunkte nutzen.
- **Negativ:** Code und Telefonnummer sind ein schwächerer Nachweis als ein OTP. Wer beides kennt (zum Beispiel aus einem geteilten Screenshot), sieht die Buchung. Rate-Limits und kurzlebige Tokens begrenzen den Schaden.
- **Negativ:** Jede Anfrage liest die Sitzung aus der Datenbank. Bei der erwarteten Last unkritisch (Annahme).
- **Folgearbeit:** Integrationstests für Cookie-Flags, Sperrverhalten, Firmen-Scope und identische 404-Antworten. Anbieter für OTP und Benachrichtigungen recherchieren (Phase 4).

## Verworfene Alternativen

- **Telefon plus SMS-OTP als Pflicht:** wie bei vielen regionalen Apps, aber der Start hinge an einem noch nicht verfügbaren syrienfähigen Gateway.
- **Telefon plus WhatsApp-OTP als Pflicht:** Business-API für eine syrische Firma ungeklärt.
- **E-Mail und Passwort als Pflicht:** viele Fahrgäste haben keine E-Mail und würden sich nicht registrieren.

## Annahmen und Revisionsauslöser

- Unbestätigt: Stand der SMS-Regulierung und der Netzbetreiber in Syrien (Sekundärquellen).
- Neu bewerten, sobald ein OTP-Anbieter für Syrien bestätigt ist.
- Neu bewerten mit einer zweiten API-Instanz (Rate-Limits brauchen dann einen gemeinsamen Speicher).
- Neu bewerten, wenn Fahrgastkonten Pflicht werden sollen.

## Verweise

- ADR 0003 (Guards), ADR 0013 (Buchungscode), ADR 0016 (Datenschutz)
- `docs/sicherheit/bedrohungsmodell.md`, `docs/api-konventionen.md`
- SMS in Syrien: https://www.sent.dm/resources/syria-sms-guide (Sekundärquelle, abgerufen 2026-10-12)
