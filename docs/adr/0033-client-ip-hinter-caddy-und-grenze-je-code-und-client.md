# ADR 0033: Client-IP hinter Caddy und Grenze der Code-Suche je Code und Client

Status: Vorschlag · Datum: 2026-11-04 · Entschieden von: Projektleitung (Befunde H1 und H2 der Gesamtprüfung vom 2026-11-04), Freigabe offen

## Kontext

Die unabhängige Prüfung (`REPORTS/2026-11-04-phase-1-bis-2-5.md`) hat zwei hohe Befunde zur
Ratenbegrenzung gemeldet:

- **H1:** Web und Portal reichten `X-Forwarded-For` unverändert an die API weiter. Mit
  `TRUST_PROXY=0` sah die API für alle Fahrgäste die IP des Web-Servers, alle teilten sich die
  Limits. Ein höherer Wert ohne Proxy, der den Header überschreibt, hätte die IP fälschbar gemacht.
  ADR 0014 legt Caddy fest, beschreibt aber weder Header noch Hop-Zahl.
- **H2:** Der Zähler der Suche nach Code und Telefon (ADR 0022) galt je Code über alle IPs. Wer
  einen Code kennt (Foto des Tickets), konnte den Fahrgast mit zehn Versuchen eine Stunde lang aus
  der eigenen Buchungssuche aussperren.

Express bestimmt `req.ip` aus `trust proxy` (Zahl = Hops, denen geglaubt wird): Bei `1` ist es der
letzte Eintrag von `X-Forwarded-For`, bei `0` der direkte Gegenüber. Der Throttler und
`requestContext` (Sitzung, Audit) lesen `req.ip`. Die API läuft im Pilot als ein Prozess
(ADR 0021).

## Entscheidung

**Betriebsentwurf (H1).** Nur Caddy ist von außen erreichbar; Web, Portal und API lauschen im
internen Compose-Netz (`docker/caddy/Caddyfile`, `compose.prod.example.yaml`).

- Caddy hat keine `trusted_proxies` und setzt `X-Forwarded-For` ausdrücklich auf die IP des
  Gegenübers (`header_up X-Forwarded-For {remote_host}`), dazu `X-Forwarded-Proto` und
  `X-Forwarded-Host`. Werte des Clients übernimmt Caddy nie; `Forwarded`, `X-Real-IP` und ähnliche
  Header entfernt er.
- `/api/*` leitet Caddy direkt an die API, nicht über das Rewrite von Next.js.
- Web und Portal geben bei Server-Aufrufen genau eine geprüfte IP an die API weiter:
  `forwardedClientIp` aus `@masar/shared` nimmt den letzten Eintrag, prüft ihn als IPv4 oder IPv6
  und lässt den Header sonst weg. Den rohen Header reichen sie nie weiter.
- **`TRUST_PROXY=1` in Produktion**, für beide Wege:

  | Weg                                  | Direkter Gegenüber der API | `X-Forwarded-For` an der API | `req.ip`  |
  | ------------------------------------ | -------------------------- | ---------------------------- | --------- |
  | Browser → Caddy → API (`/api/*`)     | Caddy                      | `<client>` (von Caddy)       | Client    |
  | Browser → Caddy → Web/Portal → API   | Web oder Portal            | `<client>` (von Web/Portal)  | Client    |
  | Entwicklung, Tests (`TRUST_PROXY=0`) | Web, Portal oder Test      | wird ignoriert               | Gegenüber |

  Web und Portal hängen nichts an, sie ersetzen. Deshalb bleibt es bei einem Hop, auch wenn die
  Kette Caddy → Web → API zwei Server hat. Würde Web anhängen, bräuchte es `2`.

- Zugriffslog von Caddy: ohne Querystring, ohne Request- und Response-Header, IP gekürzt auf /24
  (IPv4) bzw. /48 (IPv6).

**Grenze der Code-Suche (H2).** Zwei Zähler im Prozess statt einem:

- je Code und Client: 10 Versuche je Stunde. Ein Client ist eine IPv4-Adresse oder ein
  IPv6-Präfix /48.
- je Code über alle Clients: 100 Versuche je Stunde. Ein Versuch, den schon die erste Grenze
  ablehnt, zählt hier nicht; jeder Client trägt also höchstens 10 bei.

Dazu bleibt die Grenze je IP von 5 Anfragen je Minute. Gezählt wird weiter jeder Versuch, auch für
unbekannte Codes. Gemerkt wird nur ein SHA-256 aus Code und Client.

## Begründung

- Caddy als einzige Stelle, die die Client-IP bestimmt, ist einfach zu prüfen: eine Datei, keine
  Liste vertrauenswürdiger Adressen. Ohne `trusted_proxies` ersetzt Caddy fremde Werte ohnehin;
  das ausdrückliche `header_up` hält das fest, auch wenn später jemand `trusted_proxies` setzt.
- Eine einzelne, geprüfte IP von Web und Portal hält die Hop-Zahl auf 1 für beide Wege. Selbst
  wenn Caddy falsch eingerichtet wäre und anhinge, stünde die echte IP am Ende der Kette.
- Je Code und Client sperrt ein Angreifer nur sich selbst. Für eine Sperre für alle braucht er
  zehn Clients, die erste Grenze allein hätte jede Sperre aufgehoben. Die zweite Grenze hält das
  Durchprobieren der Telefonnummer über viele IPs bei 100 je Stunde und Code (bisher 10). Bei rund
  10⁸ syrischen Mobilnummern sind das etwa 10⁻⁶ je Stunde.
- /48 statt /64 für IPv6: Ein Anschluss hat oft ein /56 oder /48 und könnte sonst viele Clients
  spielen. Nachbarn im selben Präfix teilen sich die Grenze nur für denselben Code.
- Kein neuer Dienst und keine Migration: Die API läuft als ein Prozess (ADR 0021); die Grenzen
  wirken dort vollständig.

## Konsequenzen

- **Positiv:** Fahrgäste teilen sich die Limits nicht mehr über den Web-Server; die IP lässt sich
  über eigene Header nicht fälschen, solange nur Caddy von außen erreichbar ist.
- **Positiv:** Ein fremder Code lässt sich nicht mehr mit einem Client für den Fahrgast sperren.
- **Negativ:** `TRUST_PROXY=1` heißt: Die API glaubt ihrem direkten Gegenüber. Wer die API direkt
  erreicht (veröffentlichter Port, anderer Container im Netz `app`), kann jede IP vorgeben. Die
  Netze in `compose.prod.example.yaml` sind deshalb Teil der Sicherheitsgrenze.
- **Negativ:** Mit mindestens zehn Clients (IPv4-Adressen oder IPv6-/48) lässt sich ein bekannter
  Code weiter eine Stunde lang für alle sperren. Der Fahrgast behält dann das Verwaltungstoken des
  buchenden Geräts, die gespeicherte Kopie und den Ausdruck.
- **Negativ:** Hinter einem Carrier-NAT teilen sich viele Fahrgäste eine IPv4. Ein Angreifer im
  selben NAT sperrt den Fahrgast für diesen Code wie bisher.
- **Negativ:** Die Zähler liegen im Prozess. Ein Neustart setzt sie zurück. Mit mehreren
  API-Instanzen vervielfachen sich alle Grenzen (Throttler und Code-Suche); dann braucht es einen
  gemeinsamen Speicher (Datenbank oder Redis).
- **Negativ:** Die Obergrenze von 100 000 gemerkten Schlüsseln lässt sich mit sehr vielen Codes und
  Clients fluten; der älteste Eintrag fällt dann heraus. Die Grenze von 5 Anfragen je Minute und IP
  macht das teuer (rund 20 000 IP-Minuten).
- **Folgearbeit:** Caddyfile mit `caddy validate` prüfen und hinter echtem Caddy testen (Prüfliste
  im Runbook); Dockerfiles und Images (Phase 4); bei einem CDN vor Caddy dessen Adressbereiche als
  `trusted_proxies` eintragen und diesen Eintrag ersetzen.

## Verworfene Alternativen

- **`TRUST_PROXY=2` und Web hängt an:** zwei Wege mit unterschiedlicher Kettenlänge, die Zahl
  stimmt nur für einen genau. Hinge Caddy durch einen Fehler an, statt zu ersetzen, könnte der
  Client über `/api/*` den vorletzten Eintrag selbst setzen.
- **Liste vertrauenswürdiger Adressen statt Zahl (`trust proxy` als Subnetz):** genauer, aber die
  Adressen im Compose-Netz sind nicht fest; das Netz selbst ist die einfachere Grenze.
- **Zähler in der Datenbank:** übersteht Neustarts und mehrere Instanzen, kostet aber eine
  Migration, einen Schreibzugriff je Suche und einen Aufräumjob. Bei einer Instanz bringt er nur den
  Schutz über Neustarts; neu bewerten mit der zweiten Instanz.
- **Nur Fehlversuche zählen:** Prüfen vor und Zählen nach der Abfrage lässt parallele Anfragen
  durch und ändert nichts an der Sperre durch Dritte.

## Annahmen und Revisionsauslöser

- Unbestätigt: Caddy verhält sich wie in der Doku beschrieben (Header ersetzen, Log-Filter). Nicht
  hinter echtem Caddy getestet; die Syntax ist nicht mit `caddy validate` geprüft.
- Unbestätigt: 10 und 100 Versuche je Stunde passen zu echten Fahrgästen (wie ADR 0022).
- Neu bewerten mit einer zweiten API-Instanz, einem CDN vor Caddy oder Meldungen über gesperrte
  Fahrgäste.

## Verweise

- ADR 0009 (Gastzugriff), ADR 0014 (Betrieb), ADR 0019 (Geschlecht im Query), ADR 0021 (ein
  Prozess), ADR 0022 (Lesetoken, Grenzen der Code-Suche)
- `docker/caddy/Caddyfile`, `compose.prod.example.yaml`, `packages/shared/src/client-ip.ts`,
  `apps/api/src/modules/bookings/lookup-limiter.ts`, `apps/api/test/client-ip.e2e.test.ts`
- `docs/betrieb/runbook.md` (Reverse Proxy), `docs/web-fahrgastablauf.md`
- Caddy-Doku `reverse_proxy` (Abschnitt „Defaults", Header `X-Forwarded-*`) und `log`
  (`format filter`), caddyserver.com/docs, nicht erneut abgerufen
- Express `trust proxy`, expressjs.com/en/guide/behind-proxies.html, nicht erneut abgerufen
