# Fahrgast-Ablauf in der Web-App

Stand: 2026-11-02, Schritt 1.5 Teil 1 (Suche und Sitzwahl) und Schritt 1.4 (Ticketseite). Code in `apps/web`, Endpunkte in den
[API-Konventionen](api-konventionen.md#suche-und-sitzplan). Die Produkt- und Gestaltungsentscheidungen
hat die Projektleitung an den umsetzenden Coding-Agenten übertragen; sie stehen hier knapp mit Grund.

## Seiten

| Pfad                                                       | Inhalt                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `/{ar,en}`                                                 | Startseite mit Suchformular (Von, Nach, Tag, Anzahl Fahrgäste 1–9)  |
| `/{ar,en}/search?from&to&date&passengers[&cursor]`         | Ergebnisse eines Tages, Vor- und Folgetag, „Suche ändern", Blättern |
| `/{ar,en}/trips/{tripId}?from={tripStopId}&to=&passengers` | Fahrtkopf, „Ich buche für", Sitzgitter, Auswahl, Zusammenfassung    |
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
- **„Ich buche für" zuerst.** Hat die Fahrt die Geschlechtsregel, sieht der Fahrgast erst die
  Frage, dann den Sitzplan. Bei einer Person: „Frau" oder „Mann". Ab zwei Personen: „nur Frauen",
  „nur Männer" oder „gemischte Gruppe". Die gemischte Gruppe lädt den Plan ohne Geschlecht; ob jeder
  Fahrgast passend sitzt, prüft erst die Buchung (1.3) mit den Angaben je Person. Ohne
  Geschlechtsregel entfällt die Frage.
- **Geschlecht nur im POST-Body.** Die Wahl geht per Server Action (`trips/[tripId]/actions.ts`)
  an den Web-Server und von dort als Query an die API (ADR 0019). Sie steht weder in der Seiten-URL
  noch in der Historie, wird nicht gespeichert und nicht geloggt; beim Sprachwechsel ist sie weg.
  Ohne JavaScript funktioniert die Server Action als normales Formular. Mit JavaScript löst die
  Seite sie selbst aus, damit React das Formular danach nicht zurücksetzt.
- **Sitzgitter als Grundriss.** Front oben, physisch links bleibt links, auch auf Arabisch
  (`dir="ltr"` nur am Grundriss). Zwischen `LEFT` und `RIGHT` liegt eine Gangspur mit der
  Reihennummer; die Hinterbank (`BENCH`) ist eine durchgehende Reihe auf grauem Grund über die
  ganze Breite. Spalten und Spuren rechnet `src/lib/seat-layout.ts`; die Klassen stammen aus festen
  Tabellen, nicht aus Inline-Styles (CSP).
- **Zustände nicht nur über Farbe.** Frei: blauer Rahmen; gewählt: blau gefüllt; belegt: grau und
  durchgestrichen; Schalter: gestrichelt; gesperrt: blass; „nicht für dich": rosa gepunktet. Eine
  Legende erklärt alle, „nicht für dich" nur, wenn die Regel eingerechnet ist.
- **Barrierearm mit nativen Elementen.** Jeder Sitz ist eine Checkbox mit Namen „Sitz 3A, frei"
  in einer Gruppe „Reihe 3"; Tab und Leertaste reichen, Screenreader hören den Status. Nicht
  wählbare Sitze sind `disabled`. Pfeiltasten-Navigation im Gitter gibt es bewusst nicht: mehr JS,
  und native Checkboxen verhalten sich auf allen Geräten gleich.
- **Auswahl bis zur Anzahl.** Ist die Anzahl erreicht, sind weitere freie Sitze gesperrt, bis einer
  abgewählt wird; ein Live-Status sagt das an. Die Reihenfolge der Auswahl bleibt erhalten. Lädt der
  Plan neu (andere Gruppe), bleiben nur noch freie Sitze gewählt.
- **„Weiter" noch ohne Ziel.** Die Zusammenfassung zeigt Sitze und Summe; der Knopf ist deaktiviert,
  ein Hinweis darunter sagt, dass die Buchung bald kommt (Schritt 1.3 und Rest von 1.5).
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
  und IP. Ruft der Web-Server die API auf, sieht sie ohne weiteres die IP des Web-Servers, und alle
  Fahrgäste teilen sich ein Limit. `src/lib/api.ts` reicht `X-Forwarded-For` unverändert weiter.
  Wirkt nur, wenn in Produktion Caddy vor Web und API steht, Caddy `X-Forwarded-For` setzt und die
  API `TRUST_PROXY=1` hat (eine Proxy-Stufe: Caddy direkt, oder der Web-Server bei
  Server-Aufrufen). Der Web-Server darf dann nur über Caddy erreichbar sein, sonst ist die IP
  fälschbar. Beim Einrichten von Caddy (ADR 0014) prüfen; bis dahin unverifiziert.
- **Ladezeit auf schwachen Netzen** ist nicht gemessen (weder mit noch ohne CSP).
- **`NOT_FOR_YOU` im Browser** ist ungeprüft; Unit-Tests decken nur ab, dass solche Sitze nicht
  wählbar sind. Ein Ende-zu-Ende-Test braucht eine Belegung und folgt mit der Buchung (1.3).

## Tests

- Unit (Vitest, `apps/web/src/lib/*.test.ts`): Suchparameter, Kalendertage, Pfade, Geld- und
  Zeitanzeige, Sitzgitter (2+2, 2+1, Hinterbank), Auswahl; Token im Fragment, Hinweis je Status,
  gespeicherte Kopie, QR-Geometrie gegen die Kodierung.
- Ende zu Ende (`e2e/tests/passenger-flow.web.spec.ts`, Pixel 7): Ablauf auf Arabisch für zwei
  Frauen und auf Englisch für einen Mann, Leerzustand, Fehlertext aus dem Code, Sprachwechsel mit
  Suchparametern, CSP-Nonce. Der Test prüft, dass keine Browser-URL das Geschlecht enthält (ADR
  0019, Folgearbeit), und dass keine ostarabischen Ziffern erscheinen. Die Fahrten legt das
  Demo-Seed in der Testdatenbank an.
- Ende zu Ende (`e2e/tests/ticket.web.spec.ts`): „Meine Buchung" auf Arabisch mit Code in
  Kleinbuchstaben und lokaler Telefonnummer, Ticketseite mit zwei QR-Codes, Uhrzeit in Damaskus,
  keine ostarabischen Ziffern, kein Token, Code oder Telefon in einer angefragten URL, Anzeige nach
  Neuladen ohne Netz, Sprachwechsel mit Token im Fragment; falsches Telefon und unbekannter Code mit
  demselben Hinweis; auf Englisch bestätigtes Ticket über das Verwaltungstoken, Druckansicht,
  Entfernen vom Gerät, Barreservierung mit Frist ohne QR-Code, Link ohne Token. Die Buchungen
  entstehen über die API (Hold, Barreservierung, Bestätigung mit dem Demo-Konto des Seeds) auf der
  letzten Fahrt in drei Tagen und werden am Ende storniert.
