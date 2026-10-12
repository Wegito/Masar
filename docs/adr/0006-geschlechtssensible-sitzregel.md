# ADR 0006: Geschlechtssensible Sitzregel, serverseitig durchgesetzt

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Am Schalter syrischer Busfirmen wird üblicherweise gefragt, ob eine Frau oder ein Mann reist. Eine Frau soll nicht neben einem fremden Mann sitzen. Für viele Frauen ist genau das ein Grund, nicht gern in die Garage zu fahren. Masar will dieses Versprechen online halten. Keiner der drei bekannten Wettbewerber (HajzGo, Safra, Sham Bus) wirbt am 2026-10-12 damit; es ist die Differenzierung von Masar.

In der Fragerunde gewählt: Sitzplan mit Geschlechtsregel, je Firma schaltbar. Für die Oberfläche: zuerst das Geschlecht abfragen, dann nur „für dich wählbar" anzeigen.

## Entscheidung

**Regel**

- Eine Frau sitzt nie neben einem Mann aus einer anderen Buchung, und umgekehrt.
- Fahrgäste **derselben Buchung** sind ausgenommen (Familie, Paar, Gruppe).
- Die Regel greift nur, wenn sich die Teilstrecken der beiden Fahrgäste überlappen (halboffene Intervalle, ADR 0005).
- Die Regel ist je Firma schaltbar (`company.gender_rule_enabled`) und wird bei Anlage einer Fahrt als Schnappschuss übernommen (`trip.gender_rule_enabled`). Eine spätere Änderung der Firmeneinstellung ändert bestehende Fahrten nicht.
- Ist die Regel aktiv, ist das Geschlecht je Fahrgast Pflicht (`GENDER_REQUIRED`).
- Eine bestehende Belegung ohne Geschlechtsangabe zählt als Konflikt (sicherer Fehlerfall).

**Nachbarschaft**

- „Neben" heißt: direkt nebeneinander in derselben Reihe auf derselben Gangseite.
- Nachbarschaft wird je Sitzplan als **explizite, symmetrische Sitzpaare** gespeichert (`seat_neighbor`), erzeugt vom Sitzplan-Generator:
  - Reihe 2+2: Paare links und rechts vom Gang.
  - Reihe 2+1 (VIP): ein Paar auf der Doppelseite; der Einzelsitz hat keinen Nachbarn.
  - Hinterbank mit fünf Sitzen: eine Kette (1–2, 2–3, 3–4, 4–5). Der mittlere Sitz hat zwei Nachbarn.
- Abweichung vom ersten Planentwurf: Dort war eine Gruppe je Reihenseite (`adjacency_group`) vorgesehen. Eine Gruppe kann die Hinterbank nicht abbilden, weil der mittlere Sitz zu zwei Gruppen gehören müsste. Ein typischer 45-Sitzer (zehn Reihen 2+2 plus Hinterbank mit fünf Sitzen) hätte damit eine Lücke genau dort, wo die Regel schützen soll.

**Durchsetzung**

- Die Prüfung läuft im Buchungsservice unter der Fahrt-Sperre (ADR 0005). Ein Datenbank-Constraint ist nicht möglich, weil die Regel vom Inhalt benachbarter Zeilen abhängt.
- Prüfabfrage je neuem Fahrgast (vereinfacht):

```sql
SELECT so.seat_id
FROM seat_neighbor n
JOIN seat_occupation so
  ON so.seat_id = n.neighbor_seat_id AND so.trip_id = $trip_id
WHERE n.seat_id = $seat_id
  AND int4range(so.from_seq, so.to_seq) && int4range($from_seq, $to_seq)
  AND so.booking_id <> $booking_id
  AND so.gender IS DISTINCT FROM $gender;
```

- Ein Treffer ergibt HTTP 409 mit Code `GENDER_RULE_CONFLICT`.

**Oberfläche und Datenschutz**

- Die App fragt vor dem Sitzplan: „Ich buche für: Frau / Mann / mehrere Personen".
- Der Sitzplan zeigt je Sitz nur `FREE`, `TAKEN`, `NOT_ONLINE`, `BLOCKED` oder `NOT_FOR_YOU`. Das Geschlecht eines Nachbarn wird nie ausdrücklich angezeigt.
- Geschlecht ist eine Selbstauskunft mit den Werten `FEMALE` und `MALE`. Es dient nur der Sitzregel und der Fahrgastliste der Firma. Es erscheint nie in Logs, Analysen oder Exporten ohne diesen Zweck (ADR 0016).

## Begründung

- Nur die Serverprüfung unter Sperre ist sicher gegen gleichzeitige Buchungen und manipulierte Clients. Die Oberfläche ist Komfort, keine Kontrolle.
- Explizite Paare bilden jeden Sitzplan exakt ab, auch Sonderformen. Die Abfrage wird dadurch sogar einfacher als mit Gruppen.
- Die Ausnahme für dieselbe Buchung entspricht der Schalterpraxis: Wer zusammen bucht, darf zusammen sitzen.
- „Für dich wählbar" statt ausdrücklicher Anzeige verrät anonymen Besuchern so wenig wie möglich über bereits gebuchte Fahrgäste.

## Konsequenzen

- **Positiv:** Das Kernversprechen gilt unabhängig vom Kanal, solange jeder Schreibpfad durch den Buchungsservice geht.
- **Negativ:** Das Nachbar-Geschlecht bleibt erschließbar: Wer den Sitzplan für beide Geschlechter abfragt, kann Unterschiede sehen. Das entspricht der Schalterpraxis und wird bewusst akzeptiert.
- **Negativ:** Paare oder Familien, die getrennt buchen, können nicht nebeneinander sitzen, wenn die Regel sie trennt. Hinweis in der Oberfläche: gemeinsam buchen.
- **Negativ:** Die Regel ist nur so gut wie die Selbstauskunft. Die Firma kann beim Einsteigen umsetzen.
- **Folgearbeit:**
  - Testmatrix: Frau neben Mann mit und ohne Überlappung, gleiche Buchung, Regel aus, VIP-Einzelsitz, mittlerer Sitz der Hinterbank, Belegung ohne Geschlecht.
  - Darstellung für „mehrere Personen" mit gemischten Geschlechtern im Sitzplan entwerfen (Schritt 1.5).
  - Datenschutzhinweis ar/en: Zweck der Geschlechtsangabe erklären.
  - `docs/domaenenmodell.md` auf `seat_neighbor` abstimmen.

## Verworfene Alternativen

- **Sitzplan ohne Geschlechtsregel:** einfacher, aber das Schalterpersonal müsste weiter von Hand umsetzen, und das Versprechen an Frauen fehlt.
- **Keine Sitzwahl, nur Anzahl:** einfachstes Inventar, schwächstes Produkt.
- **Nachbar-Geschlecht je Sitz ausdrücklich anzeigen:** entspricht der Schalterpraxis, verrät aber jedem Besucher ein Merkmal gebuchter Fahrgäste.
- **Keine Vorab-Anzeige, Konflikt erst beim Reservieren:** datensparsam, aber schlechte Bedienbarkeit.
- **Gruppe je Reihenseite (`adjacency_group`):** siehe Abweichung oben.

## Annahmen und Revisionsauslöser

- Annahme: Die beschriebene Schalterpraxis gilt bei den Zielfirmen. Mit der ersten Partnerfirma bestätigen.
- Annahme: Nur der direkte Sitznachbar zählt, nicht Gang, vorn oder hinten.
- Neu bewerten bei Beschwerden über getrennte Familien oder über die Erschließbarkeit des Nachbar-Geschlechts.
- Neu bewerten bei rechtlichen Bedenken zur Erhebung des Geschlechts.

## Verweise

- ADR 0005 (Belegung, Sperre), ADR 0010 (Oberfläche), ADR 0016 (Datenschutz)
- `docs/domaenenmodell.md`, `docs/datenschutz.md`
- Marktrecherche vom 2026-10-12: hajzgo.com, safraway.com, shambus.com (Anbieterseiten)
