# ADR 0019: Sitzplan-Abfrage mit dem gewählten Geschlecht als Query-Parameter

Status: Abgelöst durch ADR 0034 · Datum: 2026-11-02 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 1.2, Entscheidungen übertragen)

## Kontext

Der Sitzplan zeigt je Sitz `FREE`, `TAKEN`, `NOT_ONLINE`, `BLOCKED` oder `NOT_FOR_YOU` (ADR 0006).
`NOT_FOR_YOU` hängt davon ab, für wen gebucht wird. Die Oberfläche fragt deshalb vor dem Sitzplan
„Ich buche für: Frau / Mann" und schickt die Antwort mit.

Dem steht eine Regel entgegen: „Personenbezogene Daten erscheinen nie in URLs"
(`docs/datenschutz.md`, `docs/api-konventionen.md`). Ein Lesezugriff gehört nach REST-Konvention auf
`GET`, und `GET` hat keinen Body. Der Auftrag für Schritt 1.2 nannte
`GET /trips/:tripId/seat-map?…&gender=` ausdrücklich.

Fakten zum Ist-Zustand (2026-11-02):

- Die Anfrage ist anonym. Die Fahrgast-App kennt in Phase 1 kein Fahrgastkonto; Name, Telefon oder
  Buchung sind mit dem Aufruf nicht verbunden.
- Der HTTP-Logger der API schreibt nur Methode und Pfad, nie die Query
  (`apps/api/src/common/logging.ts`, geprüft in `apps/api/test/trips-logging.e2e.test.ts`).
- Der Reverse-Proxy (Caddy, ADR 0014) ist noch nicht konfiguriert.

## Entscheidung

Die Sitzplan-Abfrage bleibt ein `GET`, das gewählte Geschlecht ist der optionale Query-Parameter
`gender` (`FEMALE` oder `MALE`). Es ist ein Filter dieser einen Anfrage und wird nie gespeichert.

- Die API speichert und loggt den Wert nicht. Der Test der Log-Ausgabe prüft das.
- Der Reverse-Proxy loggt Pfade ohne Query (Pflicht beim Einrichten von Caddy, ADR 0014).
- Das Frontend hängt `gender` nicht an Seiten-URLs, sondern nur an den API-Aufruf; die Wahl lebt im
  Zustand der Seite. So landet sie weder in der Browser-Historie noch in geteilten Links.
- Diese Ausnahme gilt nur für das selbst gewählte Geschlecht des Suchenden auf diesem Endpunkt.
  Andere Personendaten (Telefon, Name, Buchungscode) bleiben aus URLs verbannt.

## Begründung

- Ohne Bezug zu Name, Telefon oder Konto identifiziert der Wert niemanden; er sagt nur, für welche
  Personengruppe der Sitzplan berechnet werden soll.
- `GET` bleibt idempotent, ohne CSRF-Sonderfall und später zwischenspeicherbar. Ein `POST` für einen
  reinen Lesezugriff wäre nur dieser Regel wegen entstanden.
- Das Restrisiko (Proxy- oder Browser-Logs) ist durch zwei konkrete Maßnahmen beherrschbar, die
  beide überprüfbar sind.

## Konsequenzen

- **Positiv:** Einfache, cachebare Leseschnittstelle; Web-App (1.5) und spätere native App nutzen
  denselben Aufruf.
- **Negativ:** Eine Ausnahme von einer sonst ausnahmslosen Regel. Sie muss im Review bekannt sein.
- **Negativ:** Ein falsch konfigurierter Proxy oder ein Monitoring-Werkzeug, das volle URLs
  speichert, würde den Wert mit der IP-Adresse protokollieren.
- **Folgearbeit:**
  - Caddy-Konfiguration (ADR 0014): Access-Log ohne Query; Test oder Checkliste beim Einrichten.
  - Schritt 1.5: Wahl nicht in die Seiten-URL schreiben; Ende-zu-Ende-Test prüft die Adresse.

## Verworfene Alternativen

- **`POST /trips/:tripId/seat-map` mit Body:** hält die Regel ein, macht aber einen Lesezugriff zur
  zustandsändernden Anfrage im Sinne des CSRF-Guards und verhindert Caching.
- **Eigener Header (z. B. `X-Passenger-Gender`):** taucht nicht in Access-Logs auf, ist aber
  unüblich, schwerer zu testen und für Caches unsichtbar, ohne zusätzlich `Vary` zu setzen.
- **Sitzplan ohne Geschlecht, Konflikt erst beim Reservieren:** bereits in ADR 0006 verworfen.

## Annahmen und Revisionsauslöser

- Annahme (bestätigt am 2026-11-02): Der API-Logger schreibt keine Query-Parameter.
- Annahme (unbestätigt): Caddy wird ohne Query geloggt.
- Neu bewerten, sobald Fahrgastkonten existieren und der Aufruf mit einer Sitzung verbunden ist; dann
  wäre der Wert einer Person zuordenbar.
- Neu bewerten, wenn ein Drittanbieter-Werkzeug (CDN, Monitoring) volle URLs sieht.

## Verweise

- ADR 0006 (Geschlechtsregel), ADR 0009 (Gastbuchung), ADR 0014 (Betrieb), ADR 0016 (Datenminimierung)
- `docs/datenschutz.md`, `docs/api-konventionen.md` (Abschnitt „Suche und Sitzplan")

## Nachtrag 2026-11-04: abgelöst durch ADR 0034

- Die Fahrgast-App fragt die Fahrgastdaten mit Geschlecht je Person jetzt vor dem Sitzplan ab;
  die Frage „Ich buche für" entfällt. Der Sitzplan braucht damit die Geschlechter der ganzen
  Buchung, nicht ein selbst gewähltes Geschlecht.
- Die Sitzplan-Abfrage ist jetzt `POST /trips/:tripId/seat-map` mit `genders` im JSON-Body. Die
  Query-Ausnahme dieses ADR **entfällt**; `GET` und der Parameter `gender` gibt es nicht mehr.
  Die Regel „keine Personendaten in URLs" gilt für den Sitzplan ohne Ausnahme.
- Die hier verworfene Alternative „POST mit Body" ist damit gewählt. Ihr Nachteil (CSRF-Guard,
  kein Cache) wiegt weniger als eine dauerhafte Ausnahme, seit mehrere Geschlechter je Anfrage
  gebraucht werden. Die Folgearbeit „Caddy ohne Query loggen" bleibt als allgemeine Regel
  sinnvoll, schützt diesen Wert aber nicht mehr.
