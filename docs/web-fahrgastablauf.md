# Fahrgast-Ablauf in der Web-App

Stand: 2026-11-02, Schritt 1.5 Teil 1 (Suche und Sitzwahl). Code in `apps/web`, Endpunkte in den
[API-Konventionen](api-konventionen.md#suche-und-sitzplan). Die Produkt- und Gestaltungsentscheidungen
hat die Projektleitung an den umsetzenden Coding-Agenten übertragen; sie stehen hier knapp mit Grund.

## Seiten

| Pfad                                                       | Inhalt                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `/{ar,en}`                                                 | Startseite mit Suchformular (Von, Nach, Tag, Anzahl Fahrgäste 1–9)  |
| `/{ar,en}/search?from&to&date&passengers[&cursor]`         | Ergebnisse eines Tages, Vor- und Folgetag, „Suche ändern", Blättern |
| `/{ar,en}/trips/{tripId}?from={tripStopId}&to=&passengers` | Fahrtkopf, „Ich buche für", Sitzgitter, Auswahl, Zusammenfassung    |

`from`/`to` sind in der Suche Stadt-IDs, auf der Sitzplan-Seite Fahrthalt-IDs. Keine URL enthält
Personendaten oder das Geschlecht.

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
  Zeitanzeige, Sitzgitter (2+2, 2+1, Hinterbank), Auswahl.
- Ende zu Ende (`e2e/tests/passenger-flow.web.spec.ts`, Pixel 7): Ablauf auf Arabisch für zwei
  Frauen und auf Englisch für einen Mann, Leerzustand, Fehlertext aus dem Code, Sprachwechsel mit
  Suchparametern, CSP-Nonce. Der Test prüft, dass keine Browser-URL das Geschlecht enthält (ADR
  0019, Folgearbeit), und dass keine ostarabischen Ziffern erscheinen. Die Fahrten legt das
  Demo-Seed in der Testdatenbank an.
