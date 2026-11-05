# Fahrgast-Ablauf in der Web-App

Stand: 2026-11-04, Schritt 1.5 (Suche bis Ticket, Reihenfolge nach ADR 0034) und Schritt 1.4 (Ticketseite). Code in `apps/web`, Endpunkte in den
[API-Konventionen](api-konventionen.md#suche-und-sitzplan). Die Produkt- und Gestaltungsentscheidungen
hat die Projektleitung an den umsetzenden Coding-Agenten übertragen; sie stehen hier knapp mit Grund.

## Seiten

| Pfad                                                       | Inhalt                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `/{ar,en}`                                                 | Startseite mit Suchformular (Von, Nach, Tag, Anzahl Fahrgäste 1–9)  |
| `/{ar,en}/search?from&to&date&passengers[&cursor]`         | Ergebnisse eines Tages, Vor- und Folgetag, „Suche ändern", Blättern |
| `/{ar,en}/trips/{tripId}?from={tripStopId}&to=&passengers` | Fahrtkopf, Fahrgastdaten, dann Sitzplan mit Sitz je Fahrgast        |
| `/{ar,en}/bookings/{bookingId}/pay#token=…`                | Zahlweg wählen: Restzeit des Holds, Zusammenfassung, Barzahlung     |
| `/{ar,en}/my-booking`                                      | „Meine Buchung": Buchungscode und Telefon                           |
| `/{ar,en}/bookings/{bookingId}#token=…`                    | Ticketseite: Stand, Fahrt, Halte, Fahrgäste, QR-Codes, Drucken      |

`from`/`to` sind in der Suche Stadt-IDs, auf der Sitzplan-Seite Fahrthalt-IDs. Keine URL enthält
Personendaten oder das Geschlecht. Das Token der Ticketseite steht nur im Fragment, das der
Browser nie an einen Server schickt.

## Entscheidungen

- **Server Components, wenig Client-JS.** Suche, Ergebnisse und Fahrtkopf rendert der Server; die
  API ruft nur der Web-Server auf (`src/lib/api.ts`, Basis-URL `API_INTERNAL_URL`, Standard
  `http://localhost:3001`). Client-Code gibt es nur für Sprachwechsel, Fehlerberichte und die
  Sitzwahl. Ergebnis-Links laden nichts im Voraus (`prefetch={false}`), weil Vorabladen auf
  schwachen Netzen Datenvolumen kostet, das der Fahrgast vielleicht nie braucht.
- **Suchformular als GET.** Ohne JavaScript schickt der Browser das Formular selbst ab; mit
  JavaScript navigiert `next/form` im Client. Ergebnisse sind dadurch teil- und speicherbar.
- **Datum als Liste statt `<input type="date">`.** 30 Tage ab heute (Damaskus), „Heute" und „Morgen"
  vorn. Der native Datumswähler folgt der Gerätesprache und kann ostarabische Ziffern oder einen
  anderen Kalender zeigen; die Liste formatiert über `@masar/shared` (`ar-SY`, `latn`).
- **Ergebnisse.** Abfahrt und Ankunft in `Asia/Damascus`, 24 Stunden; kommt die Fahrt am
  Folgetag an, steht „+1 Tag" daneben. Preis je Person über `formatMoney` aus Minor-Units. Freie
  Plätze wie von der API gekappt („9+"); Zahlen mit Zeichen stehen in `<bdi dir="ltr">`, damit
  „9+" und „+1" auch im arabischen Satz richtig herum erscheinen. Blättern ersetzt die Seite über
  den Cursor im Link („Weitere Fahrten"), ohne Client-Zustand.
- **Fahrgastdaten zuerst, keine Frage „Ich buche für" (ADR 0034).** Die Fahrt-Seite zeigt erst
  die Fahrgastdaten (Schritt 1 von 2), dann den Sitzplan (Schritt 2 von 2). Das Geschlecht kommt
  aus den Angaben je Fahrgast; eine eigene Frage davor gibt es nicht. Ohne Geschlechtsregel fehlt
  das Feld, der Ablauf bleibt gleich.
- **Geschlecht nur im POST-Body, nur im Zustand der Seite.** Die Fahrgastdaten gehen per Server
  Action (`trips/[tripId]/actions.ts`, `prepareSeats`) an den Web-Server. Er prüft sie und fragt
  den Sitzplan mit den Geschlechtern der Buchung ohne Doppelte im Body ab
  (`POST /trips/:id/seat-map`). Nichts davon steht in der Seiten-URL, im Verlauf, in
  `sessionStorage` oder `localStorage` oder in einem Log; beim Neuladen oder Sprachwechsel ist es
  weg. Nach dem Hold lädt „Zahlweg wählen" vollständig neu, damit ist der Zustand verworfen.
- **Die Regel wirkt still.** Für den gerade gewählten Fahrgast sind Sitze, die für sein Geschlecht
  gesperrt sind (`notFor` der API, `seatStateFor` in `src/lib/seat-assignment.ts`), wie gesperrte
  Sitze dargestellt und heißen „nicht verfügbar". Es gibt keinen eigenen Status, keine Legende und
  keinen Text, der die Regel erklärt oder bewirbt; das prüfen die Ende-zu-Ende-Tests.
- **Sitzgitter als Grundriss.** Front oben, physisch links bleibt links, auch auf Arabisch
  (`dir="ltr"` nur am Grundriss). Zwischen `LEFT` und `RIGHT` liegt eine Gangspur mit der
  Reihennummer; die Hinterbank (`BENCH`) ist eine durchgehende Reihe auf grauem Grund über die
  ganze Breite. Spalten und Spuren rechnet `src/lib/seat-layout.ts`; die Klassen stammen aus festen
  Tabellen, nicht aus Inline-Styles (CSP).
- **Zustände nicht nur über Farbe.** Frei: blauer Rahmen; Sitz des gewählten Fahrgasts: blau
  gefüllt; Sitz eines anderen Fahrgasts derselben Buchung: hell mit Ring und Nummer des Fahrgasts;
  belegt: grau und durchgestrichen; Schalter: gestrichelt; gesperrt (auch nach der Regel): blass.
  Eine Legende erklärt alle; „anderer Fahrgast" nur ab zwei Personen.
- **Barrierearm mit nativen Elementen.** Jeder Sitz ist eine Checkbox mit Namen „Sitz 3A, frei"
  in einer Gruppe „Reihe 3"; Tab und Leertaste reichen, Screenreader hören den Status. Nicht
  wählbare Sitze sind `disabled`. Pfeiltasten-Navigation im Gitter gibt es bewusst nicht: mehr JS,
  und native Checkboxen verhalten sich auf allen Geräten gleich.
- **Sitz je Fahrgast.** Ab zwei Personen wählt der Fahrgast oben, für wen er gerade wählt (Name
  und Sitz je Person). Ein Sitz geht an den gewählten Fahrgast und ersetzt dessen bisherigen; danach
  springt die Auswahl zum nächsten Fahrgast ohne Sitz. Nochmals antippen gibt den Sitz ab. Sitze
  anderer Fahrgäste derselben Buchung sind für ihn nicht wählbar, ihre Nachbarsitze aber erlaubt
  (dieselbe Buchung, ADR 0006). Lädt der Plan neu oder ändern sich die Fahrgastdaten, behält jeder
  nur einen Sitz, der für sein Geschlecht noch frei ist (`keepValidAssignment`).
- **„Sitze reservieren" erst mit allen Sitzen.** Die Zusammenfassung zeigt Sitz je Fahrgast und
  Summe; der Knopf ist aktiv, sobald jeder Fahrgast einen Sitz hat, und sagt sonst, wie viele noch
  fehlen. „Fahrgastdaten ändern" führt zurück und behält Eingaben und Sitze.
- **Fehler aus dem Code.** `ProblemNotice` übersetzt `code` aus der API in einen Text
  (`messages/*.json`, `errors.*`); unbekannte Codes zeigen einen allgemeinen Text. Ist die API nicht
  erreichbar, entsteht `NETWORK_ERROR` im Web-Server. Ungültige Seitenparameter prüft die Seite
  selbst, bevor sie die API fragt.
- **Lade- und Leerzustände.** `loading.tsx` je Seite zeigt sofort einen schlichten Platzhalter mit
  Text (ohne Animation). Ohne Treffer: Hinweis plus Vor- und Folgetag.
- **CSP mit Nonce.** Weil Suche und Sitzplan an der Anfrage hängen, rendert die App ohnehin jede
  Seite dynamisch. Deshalb setzt `src/proxy.ts` jetzt dieselbe Nonce-CSP wie das Portal; die offene
  Entscheidung „CSP der Web-App" ist damit erledigt. Die Startseite ist dadurch nicht mehr statisch;
  die Städteliste liegt fünf Minuten im Datencache von Next.
- **Städteliste bleibt fünf Minuten im Cache.** Der Datencache liegt auf der Platte
  (`.next/cache/fetch-cache`) und überlebt einen Neustart. Nach einem frischen Seed zeigt die Suche
  deshalb bis zu fünf Minuten Städte, deren IDs es nicht mehr gibt. Das betrifft nur Test- und
  Demo-Datenbanken, die neu aufgesetzt werden; in Produktion ändern sich Städte selten, und ein
  Deploy bringt einen leeren Cache mit. `no-store` hätte je Aufruf der Start- und Ergebnisseite eine
  Abfrage mehr gekostet, ohne Nutzen für Fahrgäste. Stattdessen leert die Playwright-Konfiguration
  den Cache vor dem Start der Server, und die [Demo-Anleitung](demo.md#7-zurücksetzen) nennt den
  Schritt nach einem Zurücksetzen.
  Der Abruf geht ohne `X-Forwarded-For` an die API, weil Next die Request-Header in den Schlüssel
  des Datencaches aufnimmt; mit der Client-IP gäbe es hinter Caddy je Fahrgast einen eigenen
  Eintrag (ADR 0033, Nachtrag 2026-11-04).

## Buchung (Schritt 1.5)

Entscheidungen in ADR 0023; Endpunkte in den [API-Konventionen](api-konventionen.md#buchung).

- **Fahrgastdaten vor dem Sitzplan.** Je Fahrgast: vollständiger Name (wie im Ausweis, das
  Personal vergleicht ihn beim Einsteigen), Geschlecht nur bei Geschlechtsregel (Pflicht, „Frau"
  oder „Mann", nichts vorbelegt, Hinweis nur „Pflicht für jeden Fahrgast, steht nicht auf dem
  Ticket") und die Ausweisnummer nur, wenn die Firma sie verlangt (`nationalIdRequired` aus dem
  ersten Abruf des Sitzplans). Dazu einmal Kontakt: Mobilnummer (Pflicht), E-Mail (optional, für die
  Bestätigung per Mail), ein eigener Kontaktname (optional; leer heißt Fahrgast 1) und die Sprache
  der Nachrichten (Standard: Sprache der Seite). Fehler erscheinen hier, bevor ein Sitzplan lädt.
- **Prüfen auf dem Web-Server.** Das Formular schickt alles per Server Action
  (`trips/[tripId]/actions.ts`, `prepareSeats` vor dem Plan, `holdSeats` beim Hold).
  `src/lib/booking-request.ts` (`validatePassengerDetails`) prüft Namen (2 bis 100
  Zeichen nach Normalisierung wie in der API), Geschlecht, Ausweisnummer und Telefon mit
  `normalizePhone` aus `@masar/shared` (ostarabische Ziffern, `00963`, `+963` und `09…` gehen) und
  sendet E.164. Feldfehler stehen am Feld (`aria-invalid`, `aria-describedby`), dazu ein Hinweis
  oben, der den Fokus bekommt. `noValidate`, damit keine Browser-Meldung in Gerätesprache erscheint.
- **Hold mit `Idempotency-Key`.** Ein Schlüssel je Zuordnung und Eingaben (16 Zufallsbytes, base64url). Nach
  einem Netzfehler wiederholt der Knopf mit demselben Schlüssel und bekommt dieselbe Buchung mit
  neuem Token. Meldet die API `IDEMPOTENCY_KEY_REUSED`, entsteht ein neuer Schlüssel.
- **Fehler beim Hold.** `SEAT_TAKEN`, `SEAT_BLOCKED`, `SEAT_NOT_ONLINE`, `SEAT_UNKNOWN` und
  `GENDER_RULE_CONFLICT` nennen die betroffenen Sitze (`params.seats`) direkt über dem Plan; der
  Plan lädt neu, und diese Sitze fallen aus der Zuordnung. `GENDER_RULE_CONFLICT` heißt nur „nicht
  mehr verfügbar". Feldfehler, `GENDER_REQUIRED` und `NATIONAL_ID_REQUIRED` führen zurück zu den
  Fahrgastdaten mit Hinweis am Feld; `TOO_MANY_SEATS` und `TOO_MANY_OPEN_HOLDS` haben eigene Texte;
  alles andere zeigt `ProblemNotice`.
- **Zahlweg auf eigener Seite.** Nach dem Hold öffnet die Seite
  `/{locale}/bookings/{id}/pay#token=<Verwaltungstoken>` (volle Navigation, Token nur im Fragment).
  Sie lädt die Buchung per Server Action (`bookings/[bookingId]/pay/actions.ts`) und zeigt die
  Restzeit als `m:ss` mit dem Hold-Ende in Damaskus. Die Restzeit rechnet mit der Uhr des
  Web-Servers (`serverNow`), nicht mit der des Telefons; unter einer Minute kommt ein Hinweis für
  Screenreader. Ist sie abgelaufen, führt „Sitze neu wählen" zur Sitzplan-Seite derselben Fahrt.
  Neuladen behält das Token; eine schon reservierte Buchung führt direkt zur Ticketseite.
- **Nur Barzahlung.** Eine Option „Bar am Schalter" mit Betrag und Firma; die genaue Barfrist
  kennt die API erst nach `reserve-cash`, sie steht auf der Ticketseite. Online-Zahlung (Phase 3)
  erscheint nicht, auch nicht deaktiviert; die Startseite nennt sie als „kommt bald".
- **Weiter zur Ticketseite.** Nach `reserve-cash` öffnet die Seite
  `/{locale}/bookings/{id}#token=<Verwaltungstoken>`: Status „Reserviert, bar zahlen", Betrag,
  Firma und Barfrist. Nach der Barbestätigung durch das Personal zeigt dieselbe Seite die QR-Codes.
- **JavaScript ab der Sitzwahl.** Die Sitzwahl ist interaktiv; ohne JavaScript zeigt die Seite einen
  Hinweis. Die Formulare sind trotzdem echte Formulare mit Server Action, damit Eingaben nur im
  POST-Body reisen.
- **Leichtes JS.** Die Telefonprüfung (`libphonenumber-js`) läuft nur auf dem Server; im Browser
  liegen nur die Komponenten für Formular und Zahlweg.

## Ticketseite (Schritt 1.4)

Entscheidungen in ADR 0022; Endpunkte in den [API-Konventionen](api-konventionen.md#ticketseite).

- **Zugang.** „Meine Buchung" in der Kopfzeile jeder Seite. Code und Telefon gehen per Server Action
  (`my-booking/actions.ts`) im POST-Body an den Web-Server und im Body an die API
  (`POST /bookings/lookup`). Bei Erfolg öffnet die Seite `/{locale}/bookings/{id}#token=<Lesetoken>`
  mit voller Navigation. Falsches Telefon und unbekannter Code ergeben denselben Text. Die Eingaben
  bleiben nach einem Fehler stehen. Der Code wird in Großbuchstaben und links-nach-rechts
  eingegeben; Bindestrich, Kleinbuchstaben und ostarabische Ziffern im Telefon normalisiert die API.
- **Token nur im Fragment.** Die Ticketseite liest `#token=` im Browser und schickt es per Server
  Action (`bookings/[bookingId]/actions.ts`) im POST-Body an den Web-Server, der es im Header
  `X-Manage-Token` an die API gibt. Es gilt das Verwaltungstoken aus der Buchung (1.5) und das
  Lesetoken aus „Meine Buchung" (12 Stunden). Der Sprachwechsel behält das Fragment; Fehlerberichte
  senden nur den Pfad. Der Server rendert nur den Rahmen; ohne JavaScript erscheint ein Hinweis.
- **QR-Code serverseitig.** Der Web-Server kodiert das QR-Token mit `uqr` (ohne Abhängigkeiten) und
  schickt nur die Geometrie (Kantenlänge und ein SVG-Pfad) an den Browser; das Token selbst nicht.
  Der Browser zeichnet ein `<svg>` mit `<path>`, schwarz auf weiß, vier Module Ruhezone,
  Fehlerkorrektur M, ohne Inline-Styles (CSP). Kein Drittanbieter-Dienst.
- **Stand mit klarem Hinweis.** `HELD`: Hold-Ende mit Datum und Uhrzeit. `RESERVED`: Betrag, Firma
  und Barfrist („vor 18:00 am …"). `CONFIRMED`: QR-Code je Fahrgast zum Vorzeigen.
  `PENDING_CONFIRMATION`, `CANCELLED`, `EXPIRED` und eine gestrichene Fahrt haben eigene Texte. Der
  Status steht als Text in einem Abzeichen, nicht nur als Farbe. Ohne bestätigte Zahlung sagt ein
  Hinweis je Fahrgast, dass das Ticket mit QR-Code nach der Bestätigung erscheint.
- **Zeiten.** Abfahrt am Einstiegshalt, Ankunft am Ausstiegshalt und alle Halte dazwischen in
  `Asia/Damascus`, 24 Stunden, westliche Ziffern (`@masar/shared`).
- **Offline.** Nach dem Laden speichert die Seite ihre Daten (ohne Token, ohne Telefon) im
  `localStorage` und legt die Seite samt statischer Dateien in den Cache des Service Workers
  (`public/sw.js`, registriert nur von der Ticketseite; `worker-src 'self'` in der CSP). Ohne Netz
  zeigt sie die Kopie mit dem Hinweis „offline, gespeichert am … um …"; ist das Token abgelaufen,
  dieselbe Kopie mit Verweis auf „Meine Buchung". „Von diesem Gerät entfernen" löscht Kopie und
  Cache-Eintrag.
- **Drucken.** Kopfzeile, Knöpfe und Hinweise sind im Druck ausgeblendet; je Fahrgast ein Block mit
  Name, Sitz und QR-Code, der nicht über eine Seitengrenze bricht.
- **Leichtes JS.** Ein Client-Baustein für die Ticketseite, einer für das Formular; die
  QR-Kodierung läuft nicht im Browser. Ladezeit auf schwachen Netzen ist nicht gemessen.

## Offene Punkte

- **Ratenbegrenzung hinter dem Web-Server.** Die API begrenzt Suche und Sitzplan auf 60 je Minute
  und IP. Damit sie bei Server-Aufrufen den Fahrgast sieht und nicht den Web-Server, reicht
  `src/lib/api.ts` genau eine geprüfte Client-IP weiter (`forwardedClientIp` aus `@masar/shared`:
  letzter Eintrag von `X-Forwarded-For`, nur gültige IPv4 oder IPv6, sonst kein Header), nie den
  rohen Header. Betriebsentwurf nach ADR 0033: Nur Caddy ist von außen erreichbar und überschreibt
  `X-Forwarded-For` mit der echten IP; `/api/*` geht direkt an die API; die API läuft mit
  `TRUST_PROXY=1` (ein Hop für beide Wege, auch für Caddy → Web → API, weil Web ersetzt statt
  anzuhängen). Belegt durch `apps/api/test/client-ip.e2e.test.ts` (welche IP `req.ip` mit
  `TRUST_PROXY=0` und `1` liefert). Offen: Lauf hinter echtem Caddy (Prüfliste im Runbook).
- **Ladezeit auf schwachen Netzen** ist nicht gemessen (weder mit noch ohne CSP).
- **Stille Regel.** Wer still blockiert wird, erfährt keinen Grund (gewollt, ADR 0034). Ob das
  Fahrgäste verwirrt, ist nicht mit echten Nutzern geprüft.
- **Hold abbrechen.** Die Seite „Zahlweg wählen" bietet noch kein Storno; ein Hold verfällt nach
  `hold_minutes`. Der Endpunkt dafür existiert (`POST /bookings/:id/cancel`).
- **Screenreader.** Rollen, Namen und Fokus der neuen Formulare prüfen die Ende-zu-Ende-Tests; mit
  einem echten Screenreader (TalkBack, VoiceOver) ist der Ablauf nicht getestet.

## Tests

- Unit (Vitest, `apps/web/src/lib/*.test.ts`): Suchparameter, Kalendertage, Pfade, Geld- und
  Zeitanzeige, Sitzgitter (2+2, 2+1, Hinterbank), Sitz je Fahrgast mit Sperre je Geschlecht und
  gemischten Gruppen (`seat-assignment.test.ts`); Token im Fragment, Hinweis je Status,
  gespeicherte Kopie, QR-Geometrie gegen die Kodierung; Formular zu Buchungsbody (E.164, Feldfehler,
  Ausweisnummer nur bei Pflicht), Fahrgastdaten zur Sitzplan-Anfrage (nur Geschlechter ohne
  Doppelte, Geschlecht Pflicht ohne Vorbelegung), Fehlerpfade der API, `Idempotency-Key`, Countdown mit Serveruhr.
- Ende zu Ende (`e2e/tests/booking-flow.web.spec.ts`): auf Arabisch zwei Frauen von der Suche bis
  zur Ticketseite mit Barfrist (Fahrgastdaten zuerst, Geschlecht nicht vorbelegt, Fokus auf dem
  Sitzplan, Sprung zum nächsten Fahrgast, Countdown, Token
  nur im Fragment, keine ostarabischen Ziffern, weder Token noch Telefon, Name oder Geschlecht in
  einer angefragten URL); auf Englisch ein Mann mit ungültigem Telefon (Fehler vor dem Sitzplan) und
  dann internationalem Telefon, Neuladen von „Zahlweg wählen" nach der Reservierung; „Sitz
  inzwischen vergeben" mit neu geladenem Sitzplan, Hinweis darüber und behaltenen Eingaben über
  „Fahrgastdaten ändern".
- Ende zu Ende (`e2e/tests/seat-rule.web.spec.ts`): auf Arabisch hält eine fremde Frau einen Sitz,
  ein Mann sieht den Nachbarsitz „nicht verfügbar" und kann ihn nicht wählen, nach Änderung auf
  „Frau" ist er frei; auf Englisch eine gemischte Buchung, in der derselbe Sitz für die Frau frei
  und für den Mann gesperrt ist, und ein Paar, das nebeneinander bis zum Hold kommt. Beide prüfen,
  dass kein Text die Regel erklärt und kein Geschlecht in einer angefragten URL steht.
- Ende zu Ende (`e2e/tests/demo.web.spec.ts`): Demo-Ablauf aus der [Demo-Anleitung](demo.md) mit
  Barbestätigung durch das Personal über die API und QR-Code danach.
- Ende zu Ende (`e2e/tests/passenger-flow.web.spec.ts`, Pixel 7): Ablauf auf Arabisch für zwei
  Frauen (Sitz je Fahrgast, Tausch, Abgabe) und auf Englisch für einen Mann, Leerzustand, Fehlertext aus dem Code, Sprachwechsel mit
  Suchparametern, CSP-Nonce. Der Test prüft, dass keine Browser-URL das Geschlecht enthält (ADR
  0034), und dass keine ostarabischen Ziffern erscheinen. Die Fahrten legt das
  Demo-Seed in der Testdatenbank an.
- Ende zu Ende (`e2e/tests/ticket.web.spec.ts`): „Meine Buchung" auf Arabisch mit Code in
  Kleinbuchstaben und lokaler Telefonnummer, Ticketseite mit zwei QR-Codes, Uhrzeit in Damaskus,
  keine ostarabischen Ziffern, kein Token, Code oder Telefon in einer angefragten URL, Anzeige nach
  Neuladen ohne Netz, Sprachwechsel mit Token im Fragment; falsches Telefon und unbekannter Code mit
  demselben Hinweis; auf Englisch bestätigtes Ticket über das Verwaltungstoken, Druckansicht,
  Entfernen vom Gerät, Barreservierung mit Frist ohne QR-Code, Link ohne Token. Die Buchungen
  entstehen über die API (Hold, Barreservierung, Bestätigung mit dem Demo-Konto des Seeds) auf der
  letzten Fahrt in drei Tagen und werden am Ende storniert.
