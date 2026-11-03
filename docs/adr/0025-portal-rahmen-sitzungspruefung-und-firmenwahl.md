# ADR 0025: Portal-Rahmen mit Sitzungsprüfung auf dem Server und Firmenwahl im Cookie

Status: Angenommen · Datum: 2026-11-04 · Entschieden von: umsetzender Coding-Agent (Auftrag der Projektleitung: Entscheidungen für Phase 2 im selben Zug)

## Kontext

Schritt 2.1 der Roadmap verlangt einen angemeldeten Bereich im Portal: Kopfzeile, Navigation,
Firmenkontext aus der Sitzung und einen Schutz, der ohne Sitzung zum Login führt. Bis dahin prüfte
nur die Startseite im Browser über `GET /auth/me` und leitete danach im Client um; der Server
lieferte die Seite ohne Prüfung aus.

Eine Person kann mehreren Firmen angehören (`company_member`), jede mit eigener Rolle. Die
Firmen-Endpunkte der API tragen die Firma im Pfad (`/companies/:companyId/...`) und prüfen die
Mitgliedschaft selbst (`CompanyRoleGuard`, ADR 0009). Das Portal muss also wissen, in welcher Firma
die Person gerade arbeitet. Parallel entstehen weitere Bereiche (Flotte in 2.2), die sich in
denselben Rahmen einfügen.

Laut Next-Doku (16.4, `authentication.md`) rendern Layouts bei Navigation im Client nicht neu; eine
Prüfung nur im Layout greift also nur beim ersten Aufruf. Der Proxy läuft bei jeder Anfrage, auch
beim Vorabladen, und soll deshalb nur optimistisch prüfen (Cookie vorhanden), ohne Datenbank.

## Entscheidung

Der angemeldete Bereich liegt in der Routengruppe `src/app/[locale]/(app)/`. Die Sitzung prüfen
Proxy und Layout gemeinsam, die Firmenwahl lebt in einem eigenen Cookie.

- **Proxy (optimistisch):** Jede Seite mit Sprachpräfix außer `/{locale}/auth/...` verlangt das
  Sitzungs-Cookie der API (`__Host-masar_session` oder in der Entwicklung `masar_session`). Fehlt
  es, leitet `src/proxy.ts` zu `/{locale}/auth/login`. Kein API-Aufruf im Proxy.
- **Layout (verbindlich):** `(app)/layout.tsx` ruft auf dem Server `GET /api/v1/auth/me` mit dem
  Cookie-Header des Browsers (`getPortalSession()` in `src/lib/session.ts`, je Anfrage einmal über
  React `cache`). 401 führt zum Login, andere Fehler zur Fehlerseite.
- **Daten:** Jede Seite und jeder API-Aufruf bleibt selbst geschützt. Die API lehnt ohne gültige
  Sitzung ab (`UNAUTHENTICATED`), und Seiten zeigen den Fehler über `ProblemMessage`.
- **Firmenwahl:** Cookie `masar_portal_company` mit der Firmen-ID, `HttpOnly`, `SameSite=Lax`, in
  Produktion `Secure`, ein Jahr. Gesetzt nur von der Server Action `selectCompany`, und nur mit
  einer ID aus den eigenen Mitgliedschaften. Das Layout nimmt die Firma aus dem Cookie, wenn die
  Person dort aktives Mitglied ist, sonst die erste Mitgliedschaft (`resolveCompany`).
- **Kontext für Seiten:** Das Layout gibt Person und Firma an `PortalProvider`; Client-Seiten lesen
  sie mit `usePortal()` und `useCompany()`, Server-Seiten mit `getPortalSession()`. Die Firmen-ID
  geht nur in den Pfad der API.
- **Navigation:** feste Liste in `src/lib/nav.ts`. Ziele ohne Seite stehen deaktiviert mit „bald",
  Ziele ohne Berechtigung (Buchungen für Fahrer) mit „kein Zugriff".
- **Buchungen am Schalter:** Suche, Barbestätigung und Storno rufen die API aus dem Browser über
  das Same-Origin-Rewrite auf, wie Login und Passwort-Reset. Der Buchungscode steht nur im
  POST-Body. Ein Storno braucht zwei Schritte mit einem Grund aus `COMPANY_CANCEL_REASONS`.

## Begründung

- Der Proxy hält Seiten des Bereichs bei jeder Navigation von Personen ohne Cookie fern, ohne die
  API zu belasten. Das Layout macht die echte Prüfung. Die API bleibt die Grenze für Daten.
- Die Firma im Cookie statt im Pfad hält die URLs kurz und lässt neue Bereiche ohne eigenes
  Pfadsegment entstehen (`(app)/fleet/`). Das Cookie ist keine Berechtigung: Eine fremde ID wählt
  das Layout nicht aus, und die API prüft jede Anfrage selbst.
- Die meisten Personen haben genau eine Firma. Ein Pfadsegment `/c/{companyId}` wäre bei allen
  sichtbar, nützt aber nur wenigen.

## Konsequenzen

- **Positiv:** Ohne Sitzung rendert der Server keine Seite des Bereichs; der Login-Umweg im Client
  entfällt.
- **Positiv:** Neue Bereiche legen nur Seiten in `(app)/` ab und erben Rahmen, Schutz und Firma.
- **Negativ:** Eine Sitzung, die während der Arbeit abläuft, merkt das Layout erst beim nächsten
  vollständigen Laden. Bis dahin melden die API-Aufrufe der Seite `UNAUTHENTICATED`.
- **Negativ:** Zwei Browser-Tabs teilen sich die Firmenwahl. Wechselt ein Tab die Firma, arbeitet
  der andere nach dem nächsten Laden in der neuen Firma.
- **Negativ:** Jede volle Seite des Bereichs kostet einen Aufruf von `GET /auth/me`.
- **Folgearbeit:** Liste der Buchungen (2.5) braucht eine Listen-API. Kennzahlen der Startseite
  brauchen eigene Endpunkte. Der Firmenwechsel hat noch keinen Ende-zu-Ende-Test, weil das
  Seed-Konto nur einer Firma angehört.

## Verworfene Alternativen

- **Firma im Pfad (`/{locale}/c/{companyId}/...`):** eindeutig je Tab und teilbar, aber längere
  URLs und ein Segment für alle Bereiche, obwohl fast alle Personen nur eine Firma haben.
- **Prüfung nur im Client (bisheriger Stand):** Der Server lieferte Seiten ohne Sitzung aus, und
  die Seite flackerte vor der Umleitung.
- **API-Aufruf im Proxy:** prüft bei jeder Navigation verbindlich, kostet aber bei jedem
  Vorabladen einen Datenbankzugriff; die Next-Doku rät davon ab.

## Annahmen und Revisionsauslöser

- Annahme (unbestätigt): Die meisten Firmenkonten gehören zu einer Firma.
- Neu bewerten, wenn Personal regelmäßig in mehreren Firmen gleichzeitig arbeitet (dann Firma im
  Pfad) oder wenn die native App denselben Kontext braucht.

## Verweise

- ADR 0009 (Sessions, Rollen, CSRF), ADR 0015 (Fehlerformat), ADR 0016 (keine Personendaten in URLs)
- `apps/portal/README.md`, `docs/roadmap.md` (Schritte 2.1 und 2.5)
- Next.js 16.4, mitgelieferte Doku `docs/01-app/02-guides/authentication.md`, gelesen 2026-11-04
