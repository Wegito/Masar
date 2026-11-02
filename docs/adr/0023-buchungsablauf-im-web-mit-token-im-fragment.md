# ADR 0023: Buchungsablauf im Web: Fahrgastdaten im Seitenzustand, Zahlweg mit Token im Fragment

Status: Angenommen · Datum: 2026-11-02 · Entschieden von: Coding-Agent im Auftrag der Projektleitung (Schritt 1.5, Entscheidungen übertragen)

## Kontext

Schritt 1.5 verbindet Sitzwahl und Ticketseite: Fahrgastdaten erfassen, Sitze halten
(`POST /bookings`), Barzahlung wählen (`reserve-cash`), Ticket zeigen.

Fakten zum Ist-Zustand (2026-11-02):

- Das Verwaltungstoken kommt genau einmal in der Antwort von `POST /bookings` (ADR 0020). ADR 0020
  nennt als Folgearbeit „Token im Zustand der Seite halten, nie in der Seiten-URL".
- Die Ticketseite liest das Token aus dem Fragment (`#token=`, ADR 0022). Der Auftrag für 1.5
  verlangt die Weiterleitung dorthin mit dem Token ausschließlich im Fragment.
- Gewählte Gruppe und Sitze leben im Zustand der Sitzwahl, nie in der URL (ADR 0019). Die Sitzwahl
  braucht JavaScript (Auswahlgrenze, Status je Sitz).
- Ein Hold gilt nur wenige Minuten (`hold_minutes` der Firma). Fahrgäste mit schwachem Netz laden
  Seiten neu oder verlieren eine Antwort.

## Entscheidung

Fahrgastdaten sind ein weiterer Schritt auf der Sitzplan-Seite; nach dem Hold öffnet sich eine
eigene Seite `/{ar,en}/bookings/{id}/pay#token=…` für den Zahlweg. Das ergänzt ADR 0020: Das
Verwaltungstoken steht wie bei der Ticketseite im Fragment, nie in Pfad oder Query.

- **Fahrgastdaten im Seitenzustand.** „Weiter" zeigt auf derselben Seite das Formular. Gruppe,
  Sitze und Eingaben bleiben im Speicher der Seite; „Sitze ändern" behält die Eingaben. Das
  Formular ist ein echtes `<form>` mit Server Action: Alles geht im POST-Body an den Web-Server
  und im Body an die API.
- **Prüfung auf dem Web-Server.** Die Server Action prüft Namen, Geschlecht, Ausweisnummer und
  Telefon (`normalizePhone` aus `@masar/shared`) und schickt die Nummer als E.164. Texte entstehen
  in der Sprache der Seite (`noValidate`, keine Browser-Meldungen in Gerätesprache). Die API prüft
  verbindlich; ihre `errors[].path` werden zu Feldfehlern.
- **Ausweisnummer nur bei Pflicht.** Der Sitzplan meldet `nationalIdRequired` (neues Feld der API);
  ohne Pflicht fragt das Formular nicht danach und schickt nichts.
- **`Idempotency-Key` je Sitzauswahl.** 16 Zufallsbytes aus `crypto.getRandomValues` (geht auch
  ohne HTTPS), base64url. Dieselbe Auswahl behält den Schlüssel, auch nach „Sitze ändern"; eine
  andere bekommt einen neuen. Nach einem Netzfehler liefert die Wiederholung dieselbe Buchung.
- **Zahlweg auf eigener Seite, Token im Fragment.** Die Seite liest `#token=`, lädt die Buchung
  per Server Action (Token im POST-Body, zur API im Header `X-Manage-Token`) und übergibt dem
  Browser nur Fahrt, Sitze, Namen, Betrag und Hold-Ende, keine Kontaktdaten, kein Geschlecht.
  Barzahlung ruft `reserve-cash` und öffnet die Ticketseite mit demselben Token im Fragment.
- **Countdown mit der Uhr des Servers.** Die Server Action liefert `serverNow`; die Restzeit zählt
  vom Laden an weiter. Eine falsch gestellte Geräteuhr verschiebt sie nicht.
- **Nur Barzahlung.** Online-Zahlung (Phase 3) erscheint nicht als deaktivierte Option.

## Begründung

- Ein Schritt auf derselben Seite spart auf schwachem Netz einen Seitenaufruf und hält das gewählte
  Geschlecht aus jeder URL, ohne es zu speichern. Eine eigene Seite für die Fahrgastdaten hätte die
  Sitze und die Gruppe über die URL oder einen Speicher tragen müssen.
- Nach dem Hold zählt die Zeit. Eine Seite mit Token im Fragment übersteht Neuladen und
  Netzabbrüche; ein Token nur im Speicher wäre damit verloren und die Sitze bis zum Ablauf blockiert.
  Das Fragment verlässt den Browser nie (kein Server-Log, kein Referer), wie bei der Ticketseite.
- Prüfen auf dem Server hält `libphonenumber-js` aus dem Client-Bundle und nutzt dieselbe
  Normalisierung wie API und „Meine Buchung".

## Konsequenzen

- **Positiv:** Ein Ablauf ohne Konto, der Neuladen und verlorene Antworten verträgt.
- **Positiv:** Keine Personendaten in URLs, Logs oder im Speicher des Browsers; nur das Ticket wird
  wie bisher offline gespeichert (ohne Token).
- **Negativ:** Das Verwaltungstoken steht in der Browser-Historie des Geräts (Fragment), wie schon
  bei der Ticketseite. Wer das Gerät hat, kann die Buchung stornieren. Hinnehmbar, weil das Gerät
  dem Fahrgast gehört; auf geteilten Geräten bleibt „Von diesem Gerät entfernen" nur für die
  gespeicherte Kopie.
- **Negativ:** Ab der Sitzwahl braucht der Ablauf JavaScript; ohne zeigt die Seite einen Hinweis.
- **Negativ:** Feldfehler kosten einen Aufruf des Web-Servers (kleiner POST, ohne API, wenn die
  Prüfung schon dort scheitert).
- **Folgearbeit:** Storno des Holds aus der Seite „Zahlweg wählen"; Zahlwege aus Phase 3 auf
  derselben Seite; Ladezeit auf schwachem Netz messen.

## Verworfene Alternativen

- **Token nur im Zustand der Seite (ADR 0020, Folgearbeit):** verloren beim Neuladen während des
  Holds; der Fahrgast käme nicht mehr an seine Buchung, bis sie abläuft.
- **Token im `sessionStorage`:** übersteht Neuladen, aber jedes Skript der Origin liest es, und ein
  neuer Tab sieht es nicht; das Fragment leistet dasselbe ohne zusätzlichen Speicher.
- **Eigene Seite für Fahrgastdaten mit Sitzen in der URL:** ohne JavaScript bedienbar, aber die
  Gruppe (Geschlecht) müsste neu erfragt oder über die URL getragen werden (ADR 0019).
- **Weiterleitung per `redirect()` in der Server Action:** setzt das Fragment in einen
  Antwort-Header; der Client navigiert stattdessen selbst.
- **Online-Zahlung deaktiviert anzeigen:** weckt Erwartungen ohne Termin; die Startseite nennt sie
  bereits als „kommt bald".

## Annahmen und Revisionsauslöser

- Annahme (unbestätigt): Fahrgäste buchen auf dem eigenen Telefon, nicht auf geteilten Geräten.
- Neu bewerten mit Fahrgastkonten, mit Online-Zahlung (Phase 3) oder wenn Messungen zeigen, dass
  das Client-JS der Sitzwahl auf schwachen Geräten zu schwer ist.

## Verweise

- ADR 0019 (Geschlecht im Query), ADR 0020 (Verwaltungstoken), ADR 0022 (Ticketseite)
- `docs/web-fahrgastablauf.md`, `docs/api-konventionen.md` (Abschnitte „Suche und Sitzplan",
  „Buchung")
- `apps/web/src/components/passenger-form.tsx`, `apps/web/src/components/checkout-view.tsx`,
  `apps/web/src/lib/booking-request.ts`
