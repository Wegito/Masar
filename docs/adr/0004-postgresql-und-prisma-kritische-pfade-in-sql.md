# ADR 0004: PostgreSQL und Prisma, kritische Pfade in explizitem SQL

Status: Angenommen · Datum: 2026-10-12 · Entschieden von: Projektleitung (Fragerunden und Planfreigabe vom 2026-10-12)

## Kontext

Die Kernlogik von Masar ist ein Inventarproblem: Ein Sitz darf auf überlappenden Teilstrecken einer Fahrt nur einmal vergeben werden, auch wenn zwei Fahrgäste gleichzeitig buchen. Dazu kommt eine Sitzregel, die vom Geschlecht der Nachbarn abhängt (ADR 0006). Beides muss die Datenbank unter Nebenläufigkeit korrekt halten.

Versionsstand am 2026-10-12: `@prisma/client` 7.10.0 (`latest`), `prisma` CLI mit Dist-Tag `latest` = 8.0.0-rc.22, also ein Release Candidate.

## Entscheidung

- Datenbank **PostgreSQL** (Docker-Image `postgres:17` laut Plan; siehe Revisionsauslöser zu Version 18).
- ORM **Prisma**, CLI und Client auf **7.10.x gepinnt**. Das Prisma-Schema ist die Quelle der Wahrheit für alle Tabellen, die Prisma ausdrücken kann.
- **Kritische Pfade laufen als expliziter SQL** über `$queryRaw`/`$executeRaw` mit Tagged Templates in einer interaktiven Transaktion (`prisma.$transaction(async tx => …)`):
  - Sitz reservieren, Hold-Ablauf, Bestätigen, Stornieren, Fahrt absagen, Webhook-Verarbeitung.
  - Muster: Sperren → frisch lesen → prüfen → schreiben. Die Fahrt-Zeile wird per `SELECT … FOR UPDATE` gesperrt (ADR 0005).
  - Sperr-Reihenfolge ist fest: Fahrt → Buchung → Zahlung.
- **Datenbank-Objekte, die Prisma nicht ausdrücken kann**, entstehen in handbearbeiteten Migrationen (`prisma migrate dev --create-only`, SQL ergänzen, anwenden, committen):
  - Extension `btree_gist` und der `EXCLUDE`-Constraint auf `seat_occupation` (ADR 0005).
  - `CHECK`-Constraints, wo Invarianten in der Datenbank sicherer sind als im Code.
- Partielle Indizes werden im Prisma-Schema über `where` deklariert, nicht von Hand.
- Zwei Datenbank-Rollen: eine Migrationsrolle mit DDL-Rechten und eine Anwendungsrolle nur mit DML-Rechten. Für `audit_log` hat die Anwendungsrolle nur `INSERT` und `SELECT`.
- Angewandte Migrationen werden nie verändert. Korrekturen sind neue Migrationen.

## Begründung

- PostgreSQL kann die wichtigste Invariante selbst erzwingen: `EXCLUDE USING gist` mit Bereichstypen verhindert überlappende Belegungen, unabhängig davon, welcher Code-Pfad schreibt. MySQL kann das nicht; dort läge die Invariante allein bei Sperren im Code.
- Prisma deckt den Großteil der Datenzugriffe lesbar und typsicher ab und hat ein ausgereiftes Migrationswerkzeug. Die wenigen kritischen Abfragen bleiben bewusst als SQL sichtbar, weil Sperren und Bereichsoperatoren dort genau so stehen müssen, wie sie gemeint sind.
- Ein Release Candidate als Grundlage eines neuen Projekts ist ein unnötiges Risiko; 7.10 ist die aktuelle stabile Linie.

## Konsequenzen

- **Positiv:** Doppelbuchungen scheitern auch dann an der Datenbank, wenn ein künftiger Code-Pfad die Sperre vergisst.
- **Positiv:** Kritischer SQL ist an wenigen Stellen gebündelt und reviewbar.
- **Negativ:** Zwei Arten von Datenzugriff (Prisma-API und SQL) im selben Projekt. Rohes SQL hat keine Schema-Typprüfung; Tests müssen das ausgleichen.
- **Negativ: Drift-Risiko.** Prisma kennt den `EXCLUDE`-Constraint nicht. Es gibt Berichte, dass eine später generierte Migration nicht modellierte Objekte als Abweichung behandelt und entfernt hat (Prisma-Issue 24180: eigene Spalte und eigener Index wurden gelöscht). Ob das für `EXCLUDE`- und `CHECK`-Constraints gilt, ist für 7.10 unbestätigt.
- **Folgearbeit, Gegenmaßnahmen gegen Drift:**
  1. Nach jeder neuen Migration die generierte SQL-Datei vor dem Anwenden lesen; Review-Regel im Pull Request.
  2. Integrationstest, der prüft, dass `seat_occupation_no_overlap` in `pg_constraint` existiert.
  3. Integrationstest, der an der Sperre vorbei direkt in `seat_occupation` einfügt und den Fehler `23P01` erwartet.
  4. CI-Schritt, der prüft, dass Migrationen und Schema zusammenpassen. Achtung: Falls Prisma den Constraint beim Vergleich als Unterschied meldet, schlägt dieser Schritt dauerhaft fehl. Das wird in Schritt 1.1 geprüft und der CI-Schritt bei Bedarf angepasst.
- **Folgearbeit:** In Schritt 0.6 festlegen, wie Prisma 7 die beiden Verbindungen (Migration, Anwendung) konfiguriert.

## Verworfene Alternativen

- **MySQL/MariaDB:** Die Überlappungs-Invariante wäre nur durch Sperren im Code geschützt.
- **Drizzle:** Schema in TypeScript, SQL-nahe Abfragen und eingebautes `FOR UPDATE`. Abgelehnt wegen jüngerer Migrationswerkzeuge. Bleibt Ausweichplan.
- **Kysely mit SQL-Migrationen:** maximal explizit, aber viel Boilerplate für den Großteil der einfachen Zugriffe.
- **Prisma 8 (RC):** kein stabiles Release.

## Annahmen und Revisionsauslöser

- Unbestätigt: `btree_gist` lässt sich mit der Migrationsrolle ohne Superuser anlegen. Die Extension gilt seit PostgreSQL 13 als „trusted"; dafür braucht die Rolle das `CREATE`-Recht auf der Datenbank. Prüfen in Schritt 0.6.
- **Ausweichplan**, falls Prisma den Constraint nicht toleriert: diese eine Migration außerhalb von Prisma verwalten (eigenes SQL-Skript vor `migrate deploy`) oder zu Drizzle wechseln, bevor viele Migrationen existieren.
- Neu bewerten bei Prisma 8 stabil.
- Prüfen in Schritt 0.6: PostgreSQL 18 ist seit September 2025 verfügbar und hat `uuidv7()` eingebaut (relevant für ADR 0013). Der Plan nennt Version 17; die Wahl soll vor der ersten Migration bewusst getroffen werden.
- Neu bewerten, wenn die Sperre auf der Fahrt-Zeile messbar zum Engpass wird.

## Verweise

- ADR 0005 (Sitzbelegung und Constraint), ADR 0006 (Geschlechtsregel), ADR 0013 (IDs), ADR 0014 (Betrieb)
- `docs/domaenenmodell.md`
- Prisma-Doku „Unsupported database features": https://www.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features (abgerufen 2026-10-12)
- Prisma-Issue: https://github.com/prisma/prisma/issues/24180 (abgerufen 2026-10-12)
- Lernlog 2026-09-30 „Erst sperren, dann lesen"

## Nachtrag 2026-10-12 (Schritt 0.6)

- **Version gewählt: PostgreSQL 18.6.** Version 19 ist noch nicht erschienen (Release laut Planung der Entwickler am 2026-10-29), 18 ist die aktuelle stabile Linie und bringt `uuidv7()` mit. Docker-Image `postgres:18.6`; ab Version 18 liegt das Datenvolume unter `/var/lib/postgresql`.
- **`btree_gist` bestätigt:** Die Migrationsrolle legt die Extension als Besitzerin der Datenbank an, ohne Superuser-Rechte (geprüft lokal und im CI-Aufbau).
- **Drift bestätigt unkritisch für die Extension:** Ein zweiter `migrate dev`-Lauf erzeugte eine leere Migration, und `migrate diff` zwischen Datenbank und Schema war leer. Für den `EXCLUDE`-Constraint in Schritt 1.1 bleibt die Prüfung offen; das Issue 24180 ist weiterhin offen.
- **Schattendatenbank fest konfiguriert** (`masar_shadow`). Prisma 7 verlangt sie für den Abgleich Migrationen gegen Schema; dadurch braucht die Migrationsrolle kein `CREATEDB`.
- **Prisma 7 eingerichtet:** Generator `prisma-client` mit ESM-Ausgabe nach `src/generated/prisma`, Treiber-Adapter `@prisma/adapter-pg`, CLI-Konfiguration in `prisma.config.ts` (Migrationsrolle), Laufzeit über `DATABASE_URL` (Anwendungsrolle).
- **Timeouts je Verbindung:** `lock_timeout` 5 s, `statement_timeout` 10 s, `idle_in_transaction_session_timeout` 10 s, Verbindungsaufbau 5 s. Eine hängende Buchungstransaktion blockiert eine Fahrt damit höchstens 10 Sekunden.
- **Sicherheits-Vorgaben:** `pnpm audit` meldete Lücken in `mysql2` und `deepmerge-ts`, beide nur über die Prisma-CLI. Beide sind per `overrides` auf gepatchte Versionen gesetzt und mit der CLI geprüft.
