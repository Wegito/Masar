# Demo: vom Suchen bis zum bestätigten Ticket

Stand: 2026-11-02, Schritt 1.6. Diese Anleitung startet die ganze Umgebung lokal und spielt den
Ablauf einmal durch: Ein Fahrgast bucht in der Web-App und reserviert bar, das Personal der
Demo-Firma bestätigt die Barzahlung, die Ticketseite zeigt danach den QR-Code. Denselben Ablauf
prüft der Ende-zu-Ende-Test `e2e/tests/demo.web.spec.ts`.

Alle Daten sind erfunden (Firma „Masar Demo Pullman", Haltestellen „Demo Terminal"). Die
Zugangsdaten unten sind Beispielwerte **nur für die lokale Demo**. Nie auf einem erreichbaren
Server verwenden.

## 1. Voraussetzungen

Node.js 26, pnpm 11.3, Docker mit Compose und Git, wie in [Setup](setup.md#voraussetzungen).
Die Ports 3000 bis 3002 (Apps), 5432 (PostgreSQL), 1025 und 8025 (Mailpit) müssen frei sein.

```sh
git clone <repo-url> masar
cd masar
pnpm install
```

## 2. Datenbank und Mailpit

```sh
docker compose up -d --wait
cp apps/api/.env.example apps/api/.env
pnpm --filter @masar/shared build
pnpm --filter @masar/api db:deploy
```

## 3. Demo-Daten mit Konto für das Personal

Der Seed legt die Demo-Firma, die Strecke Damaskus–Homs–Hama–Aleppo, einen 45-Sitzer und Fahrten
für die nächsten sieben Tage an (07:00, 15:00, 23:00). Mit `SEED_STAFF_EMAIL` und
`SEED_STAFF_PASSWORD` entsteht dazu ein Konto mit der Rolle Admin in der Demo-Firma. Die Werte nur
für diesen einen Aufruf setzen, nicht in eine Datei schreiben:

```sh
# Git Bash, macOS, Linux
SEED_STAFF_EMAIL=demo-admin@masar.invalid SEED_STAFF_PASSWORD=nur-lokale-demo-2026 \
  pnpm --filter @masar/api db:seed
```

```powershell
# Windows PowerShell
$env:SEED_STAFF_EMAIL = 'demo-admin@masar.invalid'
$env:SEED_STAFF_PASSWORD = 'nur-lokale-demo-2026'
pnpm --filter @masar/api db:seed
Remove-Item Env:SEED_STAFF_EMAIL, Env:SEED_STAFF_PASSWORD
```

Der Seed ist idempotent. An einem späteren Tag erneut ausführen, damit wieder Fahrten für sieben
Tage da sind.

Lizenz (Schritt 2.7): Die Demo-Firma hat 6 Monate Gründungsphase ab ihrer Anlage (ein Paket, 5 Busse);
ist sie abgelaufen, beginnt der Seed eine neue. Die Provision steht auf 0 bps. Für die Lizenzpflege im
Portal (`/ar/admin/companies`) legt der Seed mit `SEED_PLATFORM_ADMIN_EMAIL` und
`SEED_PLATFORM_ADMIN_PASSWORD` (mindestens 12 Zeichen) zusätzlich ein Plattform-Admin-Konto ohne
Firma an, z. B. `demo-plattform@masar.invalid` mit `nur-lokale-plattform-2026` (nur lokal, wie oben
nur für den einen Aufruf setzen).

## 4. API, Web und Portal starten

Je ein Terminal (die Reihenfolge zählt: zuerst seeden, dann die Web-App starten, siehe unten):

```sh
pnpm --filter @masar/api dev       # API auf http://localhost:3001 (OpenAPI: /api/docs)
pnpm --filter @masar/web dev       # Fahrgast-App auf http://localhost:3000
pnpm --filter @masar/portal dev    # Portal auf http://localhost:3002
```

Bereit, wenn `curl http://localhost:3001/api/health/ready` mit `{"status":"ok"}` antwortet.

## 5. Ablauf als Fahrgast

Am besten auf dem Telefon-Format im Browser (Entwicklerwerkzeuge, Gerätesymbolleiste).

1. http://localhost:3000/ar öffnen. Von „دمشق" nach „حلب", Tag „غداً", ein Fahrgast, „ابحث عن
   رحلات". Auf Englisch: http://localhost:3000/en, Damascus to Aleppo.
2. Eine Fahrt wählen. Zuerst die Fahrgastdaten (الخطوة 1 من 2 / Step 1 of 2): je Fahrgast den
   Namen und das Geschlecht (امرأة / رجل, Pflicht, nichts vorbelegt), dazu die Mobilnummer wie
   `0933 123 456`, optional eine E-Mail-Adresse. „متابعة إلى اختيار المقاعد" (Continue to seat
   selection).
3. Sitzplan (الخطوة 2 من 2): einen freien Sitz antippen; bei mehreren Fahrgästen springt die
   Auswahl danach zum nächsten. Sitze, die für den gewählten Fahrgast nicht in Frage kommen,
   erscheinen als „غير متاح" (not available), ohne Erklärung. „احجز المقاعد مؤقتاً" (Hold seats)
   hält die Sitze für einige Minuten.

   Zum Vorführen der stillen Sitzregel: einmal als Frau einen Sitz bis zur Barreservierung buchen,
   danach dieselbe Fahrt als Mann öffnen. Der Nachbarsitz ist für ihn „غير متاح"; als Frau ist er
   frei. Ein Paar (Frau und Mann in einer Buchung) darf nebeneinander sitzen.

4. Seite „Zahlweg wählen": Restzeit des Holds, Zusammenfassung, nur Barzahlung. „احجز وادفع نقداً"
   (Reserve and pay in cash).
5. Die Ticketseite zeigt „محجوز، الدفع نقداً" (Reserved, pay in cash), den Buchungscode
   (`ABCD-EFGH`) und die Barfrist. Den Code notieren; die URL mit `#token=` offen lassen.

Mit E-Mail-Adresse liegt die Bestätigung der Reservierung nach wenigen Sekunden in Mailpit:
http://localhost:8025.

## 6. Barzahlung bestätigen (Personal der Firma)

Im Portal: http://localhost:3002 öffnen, mit dem Demo-Konto anmelden, links „Bookings"
(„الحجوزات") wählen, den Code eingeben und „Confirm cash payment" („تأكيد الدفع النقدي") drücken
(Schritt 2.1, ADR 0025). Ohne Oberfläche geht es weiter über die API, mit derselben Sitzung wie
im Portal. `<CODE>` ist der Buchungscode aus Schritt 5, Kleinschreibung und Bindestrich sind
egal.

```sh
# Git Bash, macOS, Linux (curl speichert das Sitzungs-Cookie in demo-cookies.txt)
curl -s -c demo-cookies.txt -H "Content-Type: application/json" \
  -d '{"email":"demo-admin@masar.invalid","password":"nur-lokale-demo-2026"}' \
  http://localhost:3001/api/v1/auth/login
curl -s -b demo-cookies.txt http://localhost:3001/api/v1/auth/me
# companyId aus memberships[0] übernehmen:
COMPANY=<companyId>
curl -s -b demo-cookies.txt -H "Content-Type: application/json" -d '{"bookingCode":"<CODE>"}' \
  http://localhost:3001/api/v1/companies/$COMPANY/bookings/lookup
# id der Buchung aus der Antwort übernehmen:
curl -s -b demo-cookies.txt -X POST \
  http://localhost:3001/api/v1/companies/$COMPANY/bookings/<id>/confirm-cash
rm demo-cookies.txt
```

```powershell
# Windows PowerShell 5.1. Das Cookie ist "Secure"; .NET schickt es nicht über http://localhost
# zurück. Deshalb wird es aus der Antwort gelesen und ohne Secure in die Sitzung $demo gelegt.
$base = 'http://localhost:3001/api/v1'
$login = @{ email = 'demo-admin@masar.invalid'; password = 'nur-lokale-demo-2026' } | ConvertTo-Json
$res = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $login
$name, $value = (($res.Headers['Set-Cookie'] -split ';')[0] -split '=', 2)
$demo = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$demo.Cookies.Add((New-Object System.Net.Cookie($name, $value, '/', 'localhost')))
$company = (Invoke-RestMethod -Uri "$base/auth/me" -WebSession $demo).user.memberships[0].companyId
$booking = Invoke-RestMethod -Method Post -Uri "$base/companies/$company/bookings/lookup" -ContentType 'application/json' -Body '{"bookingCode":"<CODE>"}' -WebSession $demo
Invoke-RestMethod -Method Post -Uri "$base/companies/$company/bookings/$($booking.id)/confirm-cash" -WebSession $demo
```

Die Antwort von `confirm-cash` hat `"status": "CONFIRMED"`. Die Ticketseite aus Schritt 5 neu
laden: Sie zeigt „مؤكد" (Confirmed) und je Fahrgast einen QR-Code. Auch eine zweite Person sieht die
Buchung über „حجزي" (My booking) mit Code und Telefon. Mailpit hat die Bestätigung.

Optional im Portal mit dem Demo-Konto: Flotte, Strecken und Tarife, Fahrten (Woche planen,
Kontingent, Absage), Buchungsliste mit Detail und Fahrgastliste, Verkauf am Schalter mit
Ticketdruck und die Seite „Lizenz" (Schritte 2.2 bis 2.7). Mit dem Plattform-Admin-Konto aus
Schritt 3 pflegt `/ar/admin/companies` den Lizenzstand.

## 7. Zurücksetzen

```sh
docker compose down -v      # löscht alle lokalen Daten; danach ab Schritt 2
```

Danach auch den Datencache der Web-App löschen (`apps/web/.next/cache/fetch-cache`) oder die
Web-App fünf Minuten nach dem neuen Seed starten: Sie hält die Städteliste fünf Minuten, auch über
einen Neustart hinweg, und fände sonst die alten Städte-IDs nicht mehr. Dasselbe gilt, wenn die
Web-App vor dem ersten Seed lief.

## Hinweise für Windows

- **Git Bash oder PowerShell.** Beide Varianten stehen oben. In Windows PowerShell 5.1 ist `curl`
  ein Alias für `Invoke-WebRequest`; wer curl nutzen will, schreibt `curl.exe` und muss die
  Anführungszeichen im JSON anders schützen. Einfacher sind die PowerShell-Befehle mit
  `Invoke-RestMethod`.
- **Ohne Docker.** Ein lokal installiertes PostgreSQL 18 geht ebenso, wenn es die Rollen
  `masar_app` und `masar_migrate` mit den Passwörtern aus `compose.yaml`, die Datenbanken `masar`
  und `masar_shadow` und die Rechte aus `docker/postgres/initdb/01-roles.sh` hat. Mailpit gibt es
  als einzelne `.exe` (Ports 1025 und 8025).
- **Belegter Port.** `netstat -ano | findstr :3000` zeigt die Prozess-ID, `taskkill /PID <id> /F`
  beendet ihn.
- **Zeilenenden.** `.gitattributes` erzwingt LF; `git config core.autocrlf` braucht keine
  Änderung.
- **Ende-zu-Ende-Tests** laufen auch unter Windows: `pnpm test:e2e` (vorher einmalig
  `pnpm --filter @masar/e2e exec playwright install chromium`). Sie nutzen die Testdatenbank
  `masar_test`, nie die Demo-Datenbank.

## Was die Demo noch nicht zeigt

Online-Zahlung (Phase 3), Check-in durch Fahrer (Phase 4), SMS oder WhatsApp (ADR 0009). Stand
des Fahrgast-Ablaufs: [Fahrgast-Ablauf](web-fahrgastablauf.md).
