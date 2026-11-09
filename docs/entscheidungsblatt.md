# Entscheidungsblatt

Stand: 2026-11-05. 16 offene Fragen aus den Prüfberichten in `REPORTS/`, jede mit Hintergrund, Optionen und einer Empfehlung. Sie werden von WEGITO und Haya gemeinsam entschieden. Dieselben Fragen stehen als Artifact mit Auswahlfeldern unter <https://claude.ai/artifact/No41ec5s5fVPfSXvijE3ae> (Zugriff über die Freigabe von WEGITO). Diese Datei ist die Fassung für alle, die keinen Zugriff darauf haben.

So geht es weiter:

1. Fragen lesen, die Option wählen und bei Bedarf eine Notiz schreiben (Zeile „Antwort“).
2. Entscheiden WEGITO und Haya anders als empfohlen, kurz die Begründung festhalten.
3. Sind alle Fragen beantwortet, arbeitet der Agent die Antworten in ADRs und Code ein. Erledigte Punkte stehen danach nicht mehr in `docs/offene-entscheidungen.md`.

Die Kürzel unter „Fundstelle“ verweisen auf die Befunde in `REPORTS/`.

## Betrieb und Prozess

### Q01: Soll die automatische Prüfung (CI) auch auf william laufen?

Fundstelle: DT-01

**Hintergrund.** Heute läuft CI nur bei Pull Requests und Pushes auf main. Phase 1 und 2 sind nie durch CI gelaufen. Dadurch blieb unbemerkt, dass der Gesamtlauf der Ende-zu-Ende-Tests rot war.

**Optionen**

- **a)** Ja, auch auf william und Pull Requests dorthin: Fehler fallen sofort nach jedem Push auf. Kostet nur Laufzeit auf GitHub.
- **b)** Nur Pull Requests nach main: Bleibt wie heute. Fehler zeigen sich erst beim Zusammenführen.
- **c)** Bewusst nur lokal prüfen: Kein Aufwand, aber jede Prüfung hängt an einer Person.

**Empfehlung: a)** Der erste vollständige Lauf hat zwei echte Fehler offengelegt. Eine Automatik hätte sie früher gefunden.

**Antwort:** _offen_

**Notiz:**

### Q02: Bis wann darf eine Fahrt abgesagt werden, und wer setzt den Status „abgefahren“?

Fundstelle: Planung A1-01

**Hintergrund.** Kein Ablauf setzt heute den Status DEPARTED, und die Absage prüft die Abfahrtszeit nicht. Eine längst gefahrene Fahrt lässt sich absagen. Dann werden alle Buchungen ohne Gebühr storniert und die Tickets entwertet.

**Optionen**

- **a)** Absage nur bis zur Abfahrt am Starthalt; ein Job setzt danach DEPARTED: Klare Regel, schützt Fahrgäste und Abrechnung.
- **b)** Absage bis zur Ankunft am Endhalt: Mehr Spielraum bei Ausfällen unterwegs, aber Buchungen gefahrener Strecken würden mit storniert.
- **c)** Nie sperren: Volle Freiheit für die Firma, Risiko von Fehlbedienung.

**Empfehlung: a)** Eine gefahrene Fahrt darf nicht rückwirkend ungültig werden. Ausfälle unterwegs brauchen später einen eigenen Ablauf.

**Antwort:** _offen_

**Notiz:**

### Q03: Wie zählt die Ratenbegrenzung IPv6-Fahrgäste, und läuft der Betrieb mit IPv6?

Fundstelle: A3-06, AB-03

**Hintergrund.** Hinter Docker ohne IPv6 erscheinen alle IPv6-Fahrgäste bei Caddy mit derselben Gateway-Adresse. Login-Grenze, Code-Suche und Audit-IP gelten dann für alle gemeinsam. Der Throttler zählt außerdem je /64, die Code-Suche je /48.

**Optionen**

- **a)** Docker mit IPv6 betreiben und überall je /64 zählen: Richtige Adresse sichtbar, einheitliche Regel. Etwas mehr Einrichtung am Server.
- **b)** Docker ohne IPv6 lassen und die Prüfliste ergänzen: Einfach, aber IPv6-Fahrgäste teilen sich die Grenzen.
- **c)** Erst nach dem Pilot klären: Im Pilot gibt es nur wenige Nutzer, das Risiko ist klein.

**Empfehlung: a)** Das ist eine einmalige Einstellung am Server und beseitigt das Problem an der Wurzel.

**Antwort:** _offen_

**Notiz:**

### Q04: Soll der Seed in Produktion technisch unmöglich sein?

Fundstelle: BT-03

**Hintergrund.** Der Seed schützt sich nur über die Umgebungsvariable NODE_ENV. Er kann außerdem bestehende Konten ohne Audit-Eintrag zu Plattform-Admins machen.

**Optionen**

- **a)** Ja: eigener Schutz im Seed, keine Hochstufung bestehender Konten, Audit-Eintrag: Ein falsch gesetzter Wert kann dann keinen Schaden anrichten.
- **b)** Wie bisher über NODE_ENV: Kein Aufwand, aber ein Betriebsfehler genügt.

**Empfehlung: a)** Plattform-Admins sehen alle Firmen. Dafür braucht es mehr als eine Variable.

**Antwort:** _offen_

**Notiz:**

## Datenbank

### Q05: Wie kommen partielle Indizes in die Datenbank?

Fundstelle: A-DB-09

**Hintergrund.** ADR 0004 schreibt partielle Indizes im Prisma-Schema vor. In Prisma 7.10 geht das nur mit einem nicht aktivierten Vorschau-Feature. Deshalb gibt es heute keinen. Der Outbox-Index wächst mit allen erledigten Zeilen.

**Optionen**

- **a)** Vorschau-Feature partialIndexes aktivieren: Passt zum ADR. Ein Vorschau-Feature kann sich noch ändern.
- **b)** ADR 0004 anpassen: Indizes per handgeschriebener Migration mit Existenztest: Geht schon heute und entspricht der Regel für handgeschriebenes SQL.

**Empfehlung: b)** Das Projekt nutzt diesen Weg bereits für den EXCLUDE-Constraint. Ein Vorschau-Feature im Kern wäre ein neues Risiko.

**Antwort:** _offen_

**Notiz:**

## Daten und Datenschutz

### Q06: Welche Löschfristen gelten für die IP beim Passwort-Reset und für eingeladene E-Mail-Adressen?

Fundstelle: A3-08

**Hintergrund.** Das Dateninventar nennt die IP in password_reset.requested_ip und die E-Mail-Adressen eingeladener Personen nicht. Für beide gibt es keine Löschfrist.

**Optionen**

- **a)** IP nach 30 Tagen, Einladungs-Adresse 90 Tage nach Ablauf oder Annahme löschen: Vorschlag von Claude, deckt Sicherheitsprüfung und Support ab.
- **b)** IP nach 7 Tagen, Einladungs-Adresse sofort nach Annahme: Knapper. Weniger Daten, aber weniger Spielraum bei Missbrauch.
- **c)** Eigene Fristen (in der Notiz nennen)

**Empfehlung: a)** Beide Fristen sind kurz genug für eine Begründung und lang genug, um einen Missbrauchsversuch nachzuvollziehen.

**Antwort:** _offen_

**Notiz:**

### Q07: Wann kommt der Lösch- und Pseudonymisierungsjob für personenbezogene Daten?

Fundstelle: DS-03

**Hintergrund.** pii_purge_after wird gesetzt, aber nie ausgewertet. Ausweisnummern bleiben unbegrenzt gespeichert, obwohl die Datenschutz-Doku einen täglichen Job beschreibt.

**Optionen**

- **a)** Vor dem Pilot bauen: Das Versprechen der Doku wird eingehalten, bevor echte Daten entstehen.
- **b)** Im Pilot von Hand löschen, mit Grenze (wenige Firmen, wenige Wochen): Weniger Aufwand jetzt, aber ein manueller Schritt, der vergessen werden kann.
- **c)** Erst nach dem Pilot: Echte Ausweisnummern lägen dann unbegrenzt in der Datenbank.

**Empfehlung: a)** Ausweisnummern sind der sensibelste Datensatz im System. Der Job ist klein und gut testbar.

**Antwort:** _offen_

**Notiz:**

### Q08: Darf das Personal maskierte Telefonnummern über die Suche rekonstruieren?

Fundstelle: A-SH-01

**Hintergrund.** Die Suche nach dem Telefon-Ende wirkt wie ein Orakel: Wer lange genug sucht, setzt eine maskierte Nummer ohne Audit-Eintrag vollständig zusammen.

**Optionen**

- **a)** Jede Suche im Audit-Log festhalten (nur IDs und Länge): Missbrauch wird sichtbar, die Arbeit am Schalter bleibt einfach.
- **b)** Mindestlänge und Begrenzung der Versuche je Person: Erschwert das Zusammensetzen, bremst aber auch ehrliche Suchen.
- **c)** Hinnehmen: Das Personal darf Fahrgast-Kontaktdaten ohnehin per Klick einsehen.

**Empfehlung: a)** Das Personal darf die Nummer per Klick sehen (mit Audit). Die Suche sollte nicht schwächer sein als dieser Weg.

**Antwort:** _offen_

**Notiz:**

### Q09: Sollen stornierte Buchungen druckbar bleiben?

Fundstelle: P-09

**Hintergrund.** Die Druckansicht am Schalter wertet den Buchungsstatus nicht aus. Eine stornierte Buchung druckt als vollständige Karte mit „Bezahlt: Betrag“.

**Optionen**

- **a)** Druck für stornierte Buchungen sperren: Kein Ticket, das nach Storno noch gültig aussieht.
- **b)** Druckbar mit deutlichem Vermerk „storniert“ und ohne QR-Code: Nützlich als Beleg für den Fahrgast.

**Empfehlung: a)** Ein ausgedrucktes Ticket einer stornierten Buchung ist ein Betrugsrisiko am Einstieg.

**Antwort:** _offen_

**Notiz:**

## Geld, Zeit und Lizenz

### Q10: Gibt es mehrere Währungen je Tarif oder nur SYP?

Fundstelle: A-GZ-02

**Hintergrund.** ADR 0026 lässt Firmen die Währung eines Tarifstands wählen (SYP, USD, EUR). ADR 0011 hat genau das verworfen: Preise in SYP, Anzeige nur in SYP. Beide ADRs widersprechen sich.

**Optionen**

- **a)** Nur SYP, ADR 0026 anpassen: Einfach und eindeutig. Schwankende Preise müssen die Firmen selbst nachführen.
- **b)** Mehrere Währungen je Tarif zulassen, ADR 0011 anpassen: Näher an der Praxis, wenn Firmen in Dollar kalkulieren. Braucht Regeln für Anzeige und Umrechnung.

**Empfehlung: a)** Für den Pilot reicht eine Währung. Mehrere lassen sich später ergänzen, wenn Firmen es verlangen. Hier brauchen wir euer Wissen aus den Gesprächen.

**Antwort:** _offen_

**Notiz:**

### Q11: Gelten Fristen für Zusteiger ab dem Einstiegshalt oder ab dem Starthalt?

Fundstelle: A-GZ-07

**Hintergrund.** Hold-Ende, Verkaufsfenster am Schalter und Stornostufen hängen an der Abfahrt am Starthalt. Für Fahrgäste, die an einem späteren Halt zusteigen, ist das nicht ausdrücklich entschieden.

**Optionen**

- **a)** Ab dem Einstiegshalt des Fahrgasts: Fair für Zusteiger. Mehr Rechenaufwand, zusätzliche Tests.
- **b)** Ab dem Starthalt der Fahrt: Wie heute. Ein Zusteiger nach mehreren Stunden müsste vor der Abfahrt am Start stornieren.

**Empfehlung: a)** Ein Fahrgast, der erst Stunden später zusteigt, soll nach seiner eigenen Abfahrt bemessen werden.

**Antwort:** _offen_

**Notiz:**

### Q12: Wird die Lizenz gegen den Fahrtag geprüft?

Fundstelle: LIC-02

**Hintergrund.** Heute zählt der Tag des Planens, nicht der Tag der Fahrt. Eine Firma könnte kurz vor Ablauf der Lizenz Fahrten für viele Monate planen. ADR 0032 nennt eine Grenze von 62 Tagen, im Code gibt es sie nicht.

**Optionen**

- **a)** Gegen den Fahrtag prüfen: Fahrten nach Ablauf und Kulanz lassen sich nicht planen.
- **b)** Planungshorizont begrenzen und weiter gegen heute prüfen: Einfacher. Ein Rest bleibt: bis zum Horizont kann nach Ablauf noch geplant sein.

**Empfehlung: a)** Es passt zur Idee der Lizenz: Wer nicht mehr zahlt, bekommt keine neuen Fahrten über den bezahlten Zeitraum hinaus.

**Antwort:** _offen_

**Notiz:**

## Planung und Flotte

### Q13: Darf ein Bus seinen Sitzplan nach der ersten Fahrt wechseln?

Fundstelle: Planung A1-02

**Hintergrund.** Ein Bus kann heute nur ohne Fahrten den Sitzplan wechseln. Offen ist, was bei einem archivierten Sitzplan (RETIRED) gilt, wenn schon Fahrten existieren.

**Optionen**

- **a)** Wechsel nur, wenn es keine zukünftigen Fahrten gibt: Vergangene Fahrten behalten ihren Plan, neue Fahrten nutzen den neuen.
- **b)** Nie wechseln, stattdessen neuen Bus anlegen: Sehr klar, aber ein Umbau des Busses wird umständlich.

**Empfehlung: a)** Busse werden umgebaut. Wichtig ist nur, dass keine gebuchte Fahrt ihre Sitze verliert.

**Antwort:** _offen_

**Notiz:**

### Q14: Darf eine neue Version eines Sitzplans umbenannt werden?

Fundstelle: Planung A1-04

**Hintergrund.** Neue Versionen tragen denselben Namen wie ihr Vorgänger. Ob die Firma den Namen später ändern darf, ist nicht festgelegt.

**Optionen**

- **a)** Ja, der Name ist nur eine Beschriftung: Die Firma ordnet ihre Pläne frei.
- **b)** Nein, der Name bleibt fest und bindet die Versionen zusammen: Eindeutiger Verlauf, weniger Freiheit.

**Empfehlung: a)** Ein fester Name löst kein Problem, das heute besteht.

**Antwort:** _offen_

**Notiz:**

## Architektur

### Q15: Steht die Firmen-ID in jeder Folgeabfrage?

Fundstelle: A-MT-03

**Hintergrund.** Das Bedrohungsmodell verspricht „companyId in jeder Abfrage“. In der Praxis prüft der Einstieg die Firma, und Folgeabfragen laufen nur über die geprüfte ID. Das ist nach der Prüfung sicher, aber ein zweiter Schutzring fehlt.

**Optionen**

- **a)** Doku anpassen: die Einstiegsprüfung genügt: Kein Umbau.
- **b)** In jeder Folgeabfrage nachrüsten: Doppelter Schutz, mehr Arbeit.
- **c)** Nur bei Schreibzugriffen nachrüsten: Der wichtigste Teil mit überschaubarem Aufwand.

**Empfehlung: c)** Schreibzugriffe über die falsche Firma wären der schwerste Fehler. Lesen ist durch den Einstieg schon geschützt.

**Antwort:** _offen_

**Notiz:**

### Q16: Schließen wir den Zeitkanal beim Login?

Fundstelle: A3-02

**Hintergrund.** Bei einem bestehenden Konto laufen vor der Antwort zwei bis drei Schreibzugriffe, bei einer unbekannten Adresse keiner. Wer die Antwortzeit misst, kann erkennen, ob eine E-Mail-Adresse ein Konto hat.

**Optionen**

- **a)** Schließen: gleiche Arbeit auch für unbekannte Adressen: Kein Hinweis mehr auf vorhandene Konten. Etwas mehr Last.
- **b)** Hinnehmen: Die Login-Grenze bremst das Ausprobieren ohnehin.

**Empfehlung: a)** Ob eine Adresse ein Konto hat, ist für Angreifer nützliche Information, und die Abhilfe ist klein.

**Antwort:** _offen_

**Notiz:**

## Weitere Punkte

Das sind keine Auswahlfragen, sie brauchen aber trotzdem eine Entscheidung oder ein Ja.

### Z01: Sham-Cash-Weg in ADR 0008 festhalten

Fundstelle: H4

**Hintergrund.** Empfangsadresse je Firma, Buchungscode als Verwendungszweck, Bestätigung durch das Personal. WEGITO wollte sich Zahlungen später ansehen. Keine inoffizielle Schnittstelle anbinden.

**Antwort:** _offen_

### Z02: Build-Schlüssel aus der ersten Version rotieren

Fundstelle: Schlüssel

**Hintergrund.** Die Historie des ersten Commits enthält einen Next.js-Build-Schlüssel. Das Repo ist privat. Ob der Schlüssel erneuert wird, ist offen.

**Antwort:** _offen_
