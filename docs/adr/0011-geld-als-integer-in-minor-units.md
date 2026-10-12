# ADR 0011: Geld als Integer in Minor-Units mit Währungsspalte

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Zum 1. Januar 2026 hat die syrische Zentralbank das Pfund redenominiert: 100 alte Syrische Pfund entsprechen einem neuen. Der ISO-Code bleibt `SYP`. Der Umtausch der alten Scheine ist abgeschlossen. Das Pfund hat in den letzten Jahren stark an Wert verloren; Beträge können über die Zeit um Größenordnungen wachsen.

Später sollen Angehörige im Ausland in Fremdwährung zahlen können (ADR 0008). In der Fragerunde gewählt: Preise in SYP, Anzeige nur in SYP.

## Entscheidung

- Jeder Geldbetrag wird als **Ganzzahl in der kleinsten Einheit** gespeichert (`amount_minor`), immer zusammen mit einer **Währungsspalte** (`currency`, drei Buchstaben nach ISO 4217).
- Für `SYP` gilt der ISO-Exponent 2. Ein Tarif von 600 SYP wird als `60000` gespeichert. Angezeigt werden ganze Pfund ohne Nachkommastellen.
- Einzelbeträge (Tarif, Buchungssumme, Zahlung, Erstattung) sind `integer`. **Summen und Berichtswerte sind `bigint`.**
- Provisionssätze sind Ganzzahlen in Basispunkten (`rate_bps`, 1 % = 100).
- Rechnen nur mit Ganzzahlen; Rundung findet genau an einer dokumentierten Stelle statt (Provision je Zeile, ADR 0017).
- Beträge verschiedener Währungen werden nie addiert. Summen entstehen je Währung.
- Formatierung über Helfer in `packages/shared` mit `Intl.NumberFormat` und westlichen Ziffern (ADR 0010).
- Snapshots: Eine Buchung speichert den Tarif zum Buchungszeitpunkt. Spätere Tarifänderungen wirken nicht zurück.

## Begründung

- Gleitkommazahlen runden binär und erzeugen Cent-Fehler in Summen. Ganzzahlen sind exakt.
- Die Währungsspalte erlaubt Fremdwährung später ohne Schemaänderung.
- Ein `integer` reicht für Einzelbeträge bis rund 21 Millionen SYP. Summen über viele Buchungen können diese Grenze erreichen, besonders bei weiterer Inflation; deshalb `bigint` für Summen.

## Konsequenzen

- **Positiv:** Exakte Beträge; keine Rundungsdrift in Monatsberichten.
- **Negativ:** In TypeScript ist `bigint` ein eigener Typ; Prisma liefert Summen als `BigInt`. JSON kennt kein `bigint`; die API gibt auch Summen als JSON-Zahl aus, nach Prüfung gegen `Number.MAX_SAFE_INTEGER` (rund 9·10¹⁵ Minor-Units, siehe `docs/api-konventionen.md`).
- **Folgearbeit:** Rundungsregel für die Provision festlegen (Vorschlag: je Zeile kaufmännisch auf ganze Minor-Units, Summe aus gerundeten Zeilen). Formatierungs- und Rechentests in `packages/shared`.

## Verworfene Alternativen

- **SYP mit zusätzlicher USD-Referenz:** hilfreich für die Diaspora, braucht aber eine Kursquelle und eine Regel, welcher Kurs wann gilt.
- **Währung je Tarif durch die Firma wählbar:** gemischte Währungen auf einer Fahrt erschweren Suche, Vergleich und Abrechnung.

## Annahmen und Revisionsauslöser

- Annahme: Firmen setzen Tarife in ganzen Pfund. Nachkommastellen werden nicht gebraucht.
- Neu bewerten bei einer weiteren Redenominierung (alle gespeicherten Beträge müssten umgerechnet werden; Datum der Umstellung als Stichtag dokumentieren).
- Neu bewerten mit Diaspora-Zahlungen (Kursquelle, Kurszeitpunkt, `payee`).

## Verweise

- ADR 0008 (Zahlungen), ADR 0010 (Formatierung), ADR 0017 (Provision)
- Syrian pound: https://en.wikipedia.org/wiki/Syrian_pound (abgerufen 2026-10-12)
- Redenominierung: https://new.intellinews.com/articles/syria-strips-two-zeros-off-currency-as-citizens-face-90-day-deadline-to-swap-old-pounds-417967 (abgerufen 2026-10-12)
