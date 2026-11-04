# ADR 0034: Fahrgastdaten vor der Sitzwahl, Sitzplan je Fahrgast per POST

Status: Angenommen · Datum: 2026-11-04 · Entschieden von: Projektleitung (Wunsch), Umsetzung und Einzelheiten Coding-Agent im Auftrag

## Kontext

Bis hierher fragte die Fahrgast-App vor dem Sitzplan „Ich buche für: Frau / Mann / gemischte
Gruppe" (ADR 0006, 0019) und danach im Fahrgastformular noch einmal das Geschlecht je Person. Die
gemischte Gruppe bekam den Plan ohne Regel; ob jeder passend saß, zeigte erst der Hold.

Wunsch der Projektleitung (2026-11-04):

- Keine eigene Frage nach Frau oder Mann mehr. Das Geschlecht kommt aus den Angaben, die der Gast
  für das Ticket hinterlegt.
- Gezeigte Sitze sind für Männer gesperrt, wenn daneben eine fremde Frau sitzt, und umgekehrt
  (Regel aus ADR 0006 unverändert, dieselbe Buchung ausgenommen).
- Die Regel wird in der Oberfläche weder beworben noch erklärt. Ein gesperrter Sitz ist einfach
  nicht wählbar. Die Startseite hat den Hinweis schon verloren (Commit 4dd8bedd).

Fakten zum Ist-Zustand: Die Sitzplan-Abfrage war `GET /trips/:tripId/seat-map?…&gender=` mit einem
Geschlecht je Anfrage (ADR 0019, Ausnahme von „keine Personendaten in URLs"). Der Hold prüft die
Regel je Fahrgast unter der Trip-Sperre (ADR 0005, 0006). Der Schalter im Portal fragt das
Geschlecht schon nur einmal je Fahrgast ab (ADR 0030, eigener Endpunkt `counter-seat-map`).

## Entscheidung

Die Fahrt-Seite fragt zuerst die Fahrgastdaten ab, danach zeigt sie den Sitzplan für genau diese
Fahrgäste, und jeder Fahrgast bekommt einen Sitz. Der Sitzplan wird `POST` mit Body; die
Query-Ausnahme aus ADR 0019 entfällt.

**Ablauf in der Web-App**

1. Fahrt wählen (Suche, unverändert).
2. Fahrgastdaten, Schritt 1 von 2: je Fahrgast vollständiger Name, Geschlecht (nur bei aktiver
   Regel; Pflicht, zwei Optionen, keine vorbelegt, kein Überspringen) und Ausweisnummer (nur bei
   Pflicht der Firma), dazu einmal Kontakt (Mobilnummer Pflicht, E-Mail und Kontaktname optional,
   Sprache der Nachrichten). Der Web-Server prüft alles, bevor der Sitzplan kommt.
3. Sitzplan, Schritt 2 von 2: Die Seite lädt den Plan mit den Geschlechtern der Buchung. Sitze
   werden Fahrgästen zugeordnet: Ein Fahrgast ist gewählt, ein Sitz geht an ihn, danach springt
   die Auswahl zum nächsten Fahrgast ohne Sitz. Für den gewählten Fahrgast sind die Sitze gesperrt,
   die für sein Geschlecht nicht wählbar sind. Sitze neben Fahrgästen derselben Buchung sind
   erlaubt. „Fahrgastdaten ändern" geht zurück und behält Eingaben und passende Sitze.
4. „Sitze reservieren" (Hold, `POST /bookings`) mit Fahrgast i auf dem i-ten Sitz, danach
   „Zahlweg wählen" wie bisher (ADR 0023).

**Sitzplan der API**

- `POST /api/v1/trips/:tripId/seat-map` mit Body `{ fromStopId, toStopId, genders? }`. `genders`
  sind die Geschlechter der Buchung ohne Doppelte (0 bis 2 Einträge), ohne Bezug zu Personen.
  Unbekannte Felder (auch das alte `gender`) ergeben `VALIDATION_FAILED`. Antwort 200, weiter
  öffentlich und 60 je Minute und IP. `GET` gibt es nicht mehr.
- Je Sitz `state` ohne Regel (`FREE`, `TAKEN`, `NOT_ONLINE`, `BLOCKED`, nie `NOT_FOR_YOU`) und
  `notFor`: die angefragten Geschlechter, für die der freie Sitz nach der Regel gesperrt ist.
  `genderRule` meldet `enabled` und `appliedFor` (angefragte Geschlechter bei aktiver Regel).
- Reine Funktion `computePassengerSeatMap` in `modules/trips/domain/seat-map.ts`, gebaut auf
  `computeSeatStates`. Die Oberfläche rechnet je Fahrgast mit `seatStateFor`
  (`apps/web/src/lib/seat-assignment.ts`).

**Oberfläche ohne Regelerklärung**

- Ein für den gewählten Fahrgast gesperrter Sitz sieht aus wie ein gesperrter Sitz und heißt
  „nicht verfügbar". Es gibt keinen eigenen Status „nicht für dich", keine Legende dafür und
  keinen Hinweis auf die Regel. Der Hinweis zum Geschlechtsfeld sagt nur „Pflicht für jeden
  Fahrgast, steht nicht auf dem Ticket".
- Scheitert der Hold an `GENDER_RULE_CONFLICT` (etwa nach einer gleichzeitigen Buchung), heißt
  es „Diese Sitze sind nicht mehr verfügbar", und der Plan lädt neu.

**Speicherort des Geschlechts im Browser**

- Nur im Zustand der Seite (React-Zustand der Komponente `BookingFlow`), nicht in `sessionStorage`
  oder `localStorage`, nicht in der Seiten-URL, nicht im Verlauf. Der Weg: Formular → Server Action
  im POST-Body → Web-Server → API im Body. Nach dem Hold lädt „Zahlweg wählen" vollständig neu;
  damit ist der Zustand verworfen, eine Bereinigung ist nicht nötig.

**Unverändert**

- Der Hold prüft die Regel serverseitig unter der Trip-Sperre wie bisher; die Oberfläche ist nur
  Komfort. Hold-Dauer, Limits, `Idempotency-Key`, Zahlungsablauf und die Seite „Zahlweg wählen"
  ändern sich nicht. Der Schlüssel gilt jetzt je Zuordnung und Eingaben statt je Sitzauswahl.
- Schalter im Portal: unverändert (ADR 0030). Das Personal wählt Sitze und gibt das Geschlecht je
  Fahrgast einmal ein; eine zweite Abfrage gibt es dort nicht.

## Begründung

- Wer die Fahrgastdaten zuerst angibt, hat das Geschlecht damit schon angegeben. Eine eigene Frage
  davor wäre doppelt, und die gemischte Gruppe bekäme endlich je Person den richtigen Plan statt
  einer Überraschung beim Hold.
- Ein Aufruf mit allen Geschlechtern der Buchung ist billiger als ein Aufruf je Geschlecht und
  verrät nicht mehr: Wer beide Geschlechter angibt, könnte auch zwei Pläne abfragen (Restrisiko
  aus ADR 0006).
- Mit dem Wegfall der Query hält die Sitzplan-Abfrage die Regel „keine Personendaten in URLs"
  ohne Ausnahme ein. Damit entfallen die Folgearbeiten aus ADR 0019 (Caddy ohne Query loggen als
  Schutz dieses Werts, Hinweis im Review).
- Nur Zustand der Seite: Die Daten werden nur auf dieser Seite gebraucht; ein Speicher im Browser
  hätte eine Bereinigung verlangt, die bei abgebrochenen Abläufen nie läuft.

## Konsequenzen

- **Positiv:** Eine Frage weniger, kein Doppel, der Plan stimmt je Fahrgast, auch für gemischte
  Gruppen. Keine Ausnahme mehr von der URL-Regel.
- **Positiv:** Die Regel wirkt still, wie gewünscht.
- **Negativ:** Ein Lesezugriff ist jetzt `POST`: kein HTTP-Cache, und der CSRF-Guard prüft ihn wie
  jede zustandsändernde Anfrage (JSON-Body, Origin). Für diesen Endpunkt war Caching nie geplant.
- **Negativ:** Neuladen der Seite verliert Eingaben und Zuordnung (wie bisher die Sitzwahl).
- **Negativ:** Wer still blockiert wird, erfährt den Grund nicht. Paare, die getrennt buchen, sehen
  nur „nicht verfügbar" (ADR 0006 nannte als Hinweis „gemeinsam buchen"; dieser Hinweis entfällt).
- **Folgearbeit:** Native App und andere Aufrufer nutzen `POST`. Datenschutzhinweis zum Zweck der
  Geschlechtsangabe (ADR 0006) gehört in die Datenschutzerklärung, nicht in den Buchungsablauf.

## Verworfene Alternativen

- **Frage „Ich buche für" behalten und im Formular vorbelegen:** doppelte Abfrage, ausdrücklich
  nicht gewünscht.
- **Geschlecht in `sessionStorage` mit Bereinigung nach der Buchung:** übersteht Neuladen, aber
  jedes Skript der Origin liest es, und abgebrochene Abläufe hinterlassen es.
- **`GET` mit Query behalten, je Geschlecht ein Aufruf:** zwei Aufrufe für gemischte Gruppen und
  die Ausnahme von der URL-Regel bliebe.
- **Eigener Header für das Geschlecht:** in ADR 0019 verworfen, der Grund gilt weiter.
- **Status je Fahrgast in der Antwort (`states[]` je Sitz):** mehr Daten, gleiche Information; die
  Liste `notFor` reicht.

## Annahmen und Revisionsauslöser

- Annahme (unbestätigt): Eine still gesperrte Option ohne Grund verwirrt Fahrgäste nicht stärker
  als die frühere Erklärung. Neu bewerten bei Beschwerden.
- Neu bewerten, wenn eine Firma die Regel ausdrücklich bewerben will oder Fahrgastkonten kommen.

## Verweise

- ADR 0005, ADR 0006 (Nachtrag 2026-11-04), ADR 0019 (Nachtrag 2026-11-04), ADR 0023, ADR 0030
- `docs/web-fahrgastablauf.md`, `docs/api-konventionen.md` (Abschnitt „Suche und Sitzplan"),
  `docs/demo.md`
- `apps/api/src/modules/trips/domain/seat-map.ts`, `apps/web/src/components/booking-flow.tsx`,
  `apps/web/src/lib/seat-assignment.ts`
