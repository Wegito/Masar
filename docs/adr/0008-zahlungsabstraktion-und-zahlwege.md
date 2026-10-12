# ADR 0008: Zahlungsabstraktion und Reihenfolge der Zahlwege

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Online-Zahlung war in Syrien lange nicht möglich. Stand der Recherche am 2026-10-12 (Anbieterangaben und Sekundärquellen, nicht amtlich bestätigt):

- **ecash** beschreibt sich als von der Zentralbank lizenziertes Gateway mit Anbindung an zehn Banken: Hosted Checkout, REST-API, signierte Webhooks mit Wiederholungen, Auszahlung T+1 bis T+2, Sandbox nach Registrierung. Ein eigenes Wallet ist für Q4 2026 angekündigt.
- **QNB Group** hat laut Fachpresse eine Mastercard-Lizenz für Issuing und Acquiring in Syrien erhalten (Januar 2026). Online-Kartenakzeptanz für normale Händler ist von keiner amtlichen Quelle bestätigt.
- **Wallets** wie Sham Cash und Syriatel Cash sind verbreitet. Eine öffentliche Händler-API für Sham Cash ist nicht bestätigt.

In der Fragerunde wurden alle vier Wege gewünscht: Barzahlung, ecash, Wallet-Überweisung mit Bestätigung, internationale Karten für Angehörige im Ausland. Geschäftsmodell: Provision je Online-Ticket, **die Firma kassiert direkt**. Diaspora-Zahlungen kommen in Phase 2, sollen aber im Modell vorgesehen sein.

## Entscheidung

**Eine Schnittstelle, vier Implementierungen**

- `PaymentProvider` mit den Implementierungen `cash`, `manual_wallet`, `ecash` und später `intl_card`.
- Reihenfolge der Umsetzung: **Bar** (Pflichtweg, Phase 1) → **Wallet-Überweisung mit Bestätigung** → **ecash** (beide Phase 3) → **Diaspora** (nach Gründung einer nicht-syrischen Rechtsperson).
- Barzahlung bleibt immer verfügbar. Fällt ein Anbieter aus, blendet die App ihn aus; Bar und Wallet funktionieren weiter.

**Geldfluss**

- Das Geld geht direkt an die Firma. Masar stellt die Provision monatlich in Rechnung (ADR 0017).
- `payment.payee` (`COMPANY` oder `PLATFORM`) und die Felder `fx_rate`, `fx_rate_source`, `fx_rate_at` existieren ab Tag 1. `PLATFORM` und Fremdwährung werden erst mit Diaspora-Zahlungen genutzt.

**Zahlwege im Einzelnen**

- **Bar:** Buchung wechselt von `HELD` nach `RESERVED` mit Frist vor Abfahrt. Personal markiert „bar bezahlt" am Schalter, oder der Fahrer beim Scan.
- **Wallet-Überweisung:** Fahrgast überweist und trägt die Referenz ein; die Buchung wartet in `PENDING_CONFIRMATION`. Personal bestätigt mit dem erwarteten Betrag. Eine Referenz ist je Firma und Anbieter eindeutig. Bestätigen und Erstatten sind getrennte Rechte.
- **ecash:** Hosted Checkout; Masar sieht nie Kartendaten. Bestätigung nur per Webhook oder Statusabfrage beim Anbieter, nie über die Rückkehr-URL.

**Regeln für Webhooks und externe Aufrufe**

- Signatur über den Roh-Body prüfen, Zeitfenster ±5 Minuten, zwei gleichzeitig gültige Secrets für die Rotation.
- Jedes Ereignis wird zuerst in `payment_webhook_event` mit `unique(provider, provider_event_id)` gespeichert (`INSERT … ON CONFLICT DO NOTHING`). Eine Wiederholung ändert nichts und bekommt trotzdem HTTP 200.
- Betrag, Währung und Buchungsreferenz werden gegen die Buchung geprüft und der Status beim Anbieter gegengelesen. Jede Abweichung führt zu `AWAITING_REVIEW`, nie zur Bestätigung.
- Ein Zahlungsversuch wird **vor** dem externen Aufruf gespeichert, mit Idempotenzschlüssel. Ein Timeout heißt nicht „nicht passiert"; der Ausgang wird durch Lesen geklärt, nicht durch erneutes Senden.
- Trifft eine erfolgreiche Zahlung nach Ablauf des Holds ein, wird der Sitz unter Sperre erneut belegt, falls frei. Sonst wird automatisch eine Erstattung angelegt und der Fahrgast benachrichtigt.
- Erstattungen sind eigene Datensätze mit eigenem Zustandsautomaten; Barerstattungen bestätigt das Personal (`MANUAL_DONE`).

## Begründung

- Keiner der Online-Wege ist am 2026-10-12 vertraglich gesichert. Barzahlung macht das Produkt sofort nutzbar und von keinem Anbieter abhängig.
- Eine gemeinsame Schnittstelle hält Buchungslogik und Anbieter getrennt. Ein neuer oder ausfallender Anbieter ändert keine Buchungsregel.
- „Firma kassiert direkt" vermeidet, dass Masar fremdes Geld hält und auszahlt. Das senkt die regulatorische Last erheblich.
- Die Webhook-Regeln setzen bekannte Lehren um: Wiederholungen sind normal, Signaturen können leaken, Rückkehr-URLs lassen sich fälschen.

## Konsequenzen

- **Positiv:** Phase 1 braucht keinen Zahlungsvertrag.
- **Negativ:** Barreservierungen ohne Erscheinen blockieren Sitze. Gegenmittel: Frist je Firma, Limits je Telefonnummer, No-Show-Quote im Monatsbericht (ADR 0017).
- **Negativ:** Wallet-Bestätigungen sind manuell und fälschungsanfällig. Gegenmittel: eindeutige Referenzen, Betragsabgleich, Audit, tägliche Abgleichliste.
- **Negativ:** Bei „Firma kassiert direkt" braucht jede Firma ein eigenes Händlerkonto, und Masar verwahrt deren Zugangsdaten verschlüsselt, sofern ecash kein Plattform-Modell anbietet.
- **Folgearbeit:** ecash-Sandbox beantragen; klären, ob ecash Unterhändler (Sub-Merchants) für Plattformen anbietet; Abgleichsjob für offene Zahlungen; Datenmodell `company_payment_credential` in Phase 3.

## Verworfene Alternativen

- **Masar kassiert und zahlt an Firmen aus:** besseres Kundenerlebnis, aber Treuhand- und Lizenzfragen sowie Auszahlungslogik ab Tag 1.
- **Servicegebühr vom Fahrgast:** nicht gewählt; das Modell schließt sie später nicht aus.
- **Diaspora ab Tag 1 über eine Auslandsstelle von Masar:** Settlement, Kursquelle und Treuhandfragen gehörten dann ins MVP.
- **Diaspora über einen Partner-Anbieter mit Syrien-Bezug:** unklar, ob es diesen Anbieter 2026 gibt.

## Annahmen und Revisionsauslöser

- Unbestätigt: Angaben von ecash zu Funktionen, Lizenz und Onboarding (Anbieterseite).
- Unbestätigt: Ob Online-Kartenzahlungen für syrische Händler zugelassen sind.
- Neu bewerten, wenn ecash ein Plattform-Modell anbietet, wenn Sham Cash eine Händler-API veröffentlicht, wenn die Zentralbank neue Regeln erlässt, oder wenn eine nicht-syrische Rechtsperson entsteht.

## Verweise

- ADR 0005 (Belegung), ADR 0011 (Geld), ADR 0016 (Verschlüsselung von Zugangsdaten), ADR 0017 (Provision)
- `docs/domaenenmodell.md`, `docs/sicherheit/bedrohungsmodell.md`
- ecash: https://ecash-pay.com/ (Anbieterangaben, abgerufen 2026-10-12)
- QNB und Mastercard: https://fintech.global/2026/01/05/qnb-group-launches-mastercard-payment-solutions-in-syria/ (abgerufen 2026-10-12)
- Händlersicht Syrien 2026: https://maizny.com/en/guides/syria-online-payments (Sekundärquelle, abgerufen 2026-10-12)
- Lernlog 2026-09-30 „Versuch vor dem externen Aufruf festschreiben"
