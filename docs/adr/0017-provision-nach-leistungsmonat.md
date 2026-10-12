# ADR 0017: Provision nach Leistungsmonat

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Geschäftsmodell (Fragerunde): Masar erhält eine Provision je Buchung über die App. Die Firma kassiert direkt; Masar stellt die Provision monatlich in Rechnung. Als Basis wurde gewählt: **alle bestätigten App-Buchungen**, einschließlich Barzahlung, mit Überwachung der No-Show-Quote.

Eine Buchung hat drei verschiedene Zeitpunkte: Buchung, Zahlung und Fahrt (Leistung). Beispiel: Buchung am 28. Januar, Online-Zahlung am 29. Januar, Fahrt am 3. Februar. In einer Verständnisfrage der Fragerunde wurde zunächst „Januar (Buchungsmonat)" gewählt. Der freigegebene Plan legt den Leistungsmonat fest; dieses ADR hält die Gründe fest.

Risiko beim Barweg: Eine Firma könnte Provision umgehen, indem sie Barzahler nie als bezahlt markiert.

## Entscheidung

- **Basis:** Jede Buchung, die über die App entstanden ist und `CONFIRMED` erreicht:
  - online bezahlt: mit der bestätigten Zahlung;
  - bar: wenn das Personal „bar bezahlt" markiert oder der Fahrer das Ticket scannt (Phase 4).
- **Satz:** Beim Übergang nach `CONFIRMED` werden der gültige Satz (`commission_rate_bps`) und der Betrag (`commission_amount_minor`) an der Buchung eingefroren. Spätere Satzänderungen wirken nicht zurück.
- **Zeitraum:** der Monat von `trip.service_date`, also der Abfahrtstag am Starthalt in Ortszeit `Asia/Damascus` (ADR 0012).
- **Zeilen:** nur für Fahrten mit Status `DEPARTED` oder `COMPLETED`. Vor der Abfahrt stornierte Buchungen erzeugen nie eine Zeile.
- **Bericht:** `commission_statement` je Firma und Monat mit Zuständen `DRAFT` → `ISSUED` → `PAID`. Nach `ISSUED` unveränderlich. Korrekturen, etwa eine Erstattung nach der Fahrt, werden als Korrekturzeile im nächsten offenen Monat erfasst, mit Verweis auf die ursprüngliche Buchung.
- **No-Show-Quote:** Der Bericht zeigt je Firma die Barreservierungen, die ohne Bestätigung verfallen sind, im Verhältnis zu allen Barreservierungen. Ausreißer werden mit der Firma besprochen.
- Summen sind `bigint` (ADR 0011).

## Begründung

- **Stornos:** Beim Buchungsmonat müsste ein im Januar gebuchtes und im Februar storniertes Ticket einen bereits ausgestellten Januar-Bericht korrigieren. Beim Leistungsmonat gelangen Stornos vor der Abfahrt nie in einen Bericht.
- **Realisationsprinzip:** Ein Ertrag entsteht, wenn die Leistung erbracht ist. Masars Vermittlungsleistung ist vollständig, wenn die Fahrt stattfindet. (Für das deutsche Handelsrecht § 252 Abs. 1 Nr. 4 HGB; welche Regeln für die syrische Betreiberfirma gelten, ist nicht geprüft.)
- **Zahlungsmonat** wäre je Zahlweg verschieden: Bar wird oft erst beim Einsteigen bezahlt, online Tage vorher. Derselbe Vorgang fiele je nach Zahlweg in andere Monate.
- **Barweg einbeziehen** gibt allen Zahlwegen denselben Anreiz. Die No-Show-Quote macht Umgehung sichtbar, statt sie technisch unmöglich machen zu wollen.

## Konsequenzen

- **Positiv:** Berichte sind stabil, sobald sie ausgestellt sind; Stornos verursachen keine Nacharbeit.
- **Negativ:** Masars Einnahmen kommen später: Eine Januar-Buchung für eine Februar-Fahrt wird erst mit dem Februar-Bericht abgerechnet.
- **Negativ:** Der Bericht hängt am Fahrtstatus. Bleibt eine Fahrt fälschlich `SCHEDULED` (zum Beispiel weil der Status-Job ausfällt), fehlen ihre Zeilen. Das braucht Überwachung.
- **Negativ:** Die No-Show-Quote erkennt Umgehung nur statistisch; Streitfälle sind möglich.
- **Folgearbeit:** Rundungsregel festlegen (ADR 0011); Berichtsgenerator mit Tests für Monatsgrenze 23:30 am Monatsletzten, Storno vor Abfahrt, Erstattung nach Abfahrt, Satzwechsel zwischen Buchung und Bestätigung; Export als CSV/PDF (Phase 4).

## Verworfene Alternativen

- **Buchungsmonat:** Stornos nach Monatswechsel erzwingen Korrekturen ausgestellter Berichte.
- **Zahlungsmonat:** je Zahlweg verschiedene Monate für denselben Vorgang.
- **Nur online bezahlte Tickets:** kein Umgehungsanreiz, aber am Anfang, solange kaum online bezahlt wird, fast kein Umsatz für Masar.
- **Mit der ersten Partnerfirma entscheiden:** hätte das Abrechnungsmodell offen gelassen; der Partnervertrag kann es dennoch ändern (Revisionsauslöser).

## Annahmen und Revisionsauslöser

- Annahme: Partnerfirmen akzeptieren Provision auf bestätigte Barbuchungen. Im ersten Vertrag bestätigen.
- Neu bewerten, wenn ein Partnervertrag eine andere Basis oder einen anderen Zeitraum festlegt.
- Neu bewerten mit Diaspora-Zahlungen: Kassiert die Plattform selbst (`payee = PLATFORM`), wird die Provision einbehalten statt in Rechnung gestellt.
- Neu bewerten nach steuerlicher Beratung für die Betreiberfirma.

## Verweise

- ADR 0008 (Zahlwege, Geldfluss), ADR 0011 (Geld), ADR 0012 (Ortszeit)
- `docs/domaenenmodell.md`
- Lernlog 2026-09-09 „Buchungszeitpunkt, Zahlungszeitpunkt und Leistungszeitpunkt sind drei verschiedene Daten"
