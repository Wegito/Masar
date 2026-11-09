-- Schritt 2.7 (Lizenzstand je Firma, ADR 0029 und 0032). Additiv: neuer Enum-Typ, neue Tabelle mit
-- Verlauf, ein Trigger für neue Firmen und ein Startstand für bestehende Firmen.

-- CreateEnum
CREATE TYPE "LicensePlan" AS ENUM ('FOUNDING', 'ONE_YEAR', 'TWO_YEARS');

-- CreateTable
CREATE TABLE "company_license" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "plan" "LicensePlan" NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "bus_packages" INTEGER NOT NULL,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_license_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_license_company_id_valid_from_idx" ON "company_license"("company_id", "valid_from");

-- AddForeignKey
ALTER TABLE "company_license" ADD CONSTRAINT "company_license_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Handgeschrieben (ADR 0004, 0032). Prisma kennt diese Objekte nicht; der Test
-- apps/api/test/licenses-schema.e2e.test.ts weist jedes davon in der Datenbank nach.
-- Die Extension btree_gist legt bereits die Migration 20261012092834_init an.
-- ---------------------------------------------------------------------------------------------

-- Zeiträume sind Kalendertage in Damaskus, beide eingeschlossen. Je Firma gilt an jedem Tag
-- höchstens ein Zeitraum; Verlängerungen schließen lückenlos an (valid_from = valid_until + 1).
ALTER TABLE "company_license"
  ADD CONSTRAINT "company_license_valid_range" CHECK ("valid_until" >= "valid_from"),
  ADD CONSTRAINT "company_license_bus_packages_positive" CHECK ("bus_packages" >= 1),
  ADD CONSTRAINT "company_license_notes_length" CHECK ("notes" IS NULL OR char_length("notes") <= 200),
  ADD CONSTRAINT "company_license_no_overlap"
    EXCLUDE USING gist (
      "company_id" WITH =,
      daterange("valid_from", "valid_until", '[]') WITH &&
    );

-- Der Verlauf bleibt erhalten: Die Anwendung ändert Zeiträume, löscht sie aber nicht.
REVOKE DELETE ON "company_license" FROM masar_app;

-- Jede neue Firma beginnt mit der Gründungsphase: 6 Monate FOUNDING ab dem Anlagetag in Damaskus,
-- ein Paket (5 Busse). Der letzte gültige Tag ist der Tag vor dem Monatsjahrestag; wie in
-- PostgreSQL wird auf das Monatsende gekürzt (31.08. + 6 Monate = 28.02.). Der Trigger gilt für
-- jeden Schreibpfad (Seed, Tests, spätere Firmenanlage durch den Plattform-Admin).
CREATE FUNCTION "company_license_founding"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  first_day date := (NEW."created_at" AT TIME ZONE 'Asia/Damascus')::date;
BEGIN
  INSERT INTO "company_license" ("company_id", "plan", "valid_from", "valid_until", "bus_packages", "updated_at")
  VALUES (NEW."id", 'FOUNDING', first_day, (first_day + interval '6 months')::date - 1, 1, now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER "company_license_founding"
  AFTER INSERT ON "company"
  FOR EACH ROW EXECUTE FUNCTION "company_license_founding"();

-- Bestehende Firmen (Demo-Firma der Entwicklung): Die Gründungsphase beginnt mit der Einführung
-- der Lizenz, also heute in Damaskus. Pakete so, dass alle aktiven Busse abgedeckt sind.
INSERT INTO "company_license" ("company_id", "plan", "valid_from", "valid_until", "bus_packages", "updated_at")
SELECT c."id",
       'FOUNDING',
       d.first_day,
       (d.first_day + interval '6 months')::date - 1,
       GREATEST(1, ceil((SELECT count(*) FROM "bus" b
                         WHERE b."company_id" = c."id" AND b."status" = 'ACTIVE') / 5.0)::int),
       now()
FROM "company" c
CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE 'Asia/Damascus')::date AS first_day) d;
