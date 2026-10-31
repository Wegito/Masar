-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'DEPARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SeatLayoutPattern" AS ENUM ('TWO_PLUS_TWO', 'TWO_PLUS_ONE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SeatLayoutStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SeatSide" AS ENUM ('LEFT', 'AISLE', 'RIGHT');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE');

-- CreateTable
CREATE TABLE "city" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "city_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "city_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "owner_company_id" UUID,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stop" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "route_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "route_stop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fare" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "route_id" UUID NOT NULL,
    "from_route_stop_id" UUID NOT NULL,
    "to_route_stop_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_layout" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "pattern" "SeatLayoutPattern" NOT NULL,
    "status" "SeatLayoutStatus" NOT NULL DEFAULT 'ACTIVE',
    "supersedes_layout_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seat_layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "layout_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "col_index" INTEGER NOT NULL,
    "side" "SeatSide" NOT NULL,
    "is_sellable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_neighbor" (
    "layout_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "neighbor_seat_id" UUID NOT NULL,

    CONSTRAINT "seat_neighbor_pkey" PRIMARY KEY ("seat_id","neighbor_seat_id")
);

-- CreateTable
CREATE TABLE "bus" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "seat_layout_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "seat_layout_id" UUID NOT NULL,
    "bus_id" UUID,
    "service_date" DATE NOT NULL,
    "departure_at" TIMESTAMPTZ(3) NOT NULL,
    "arrival_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
    "online_sales_close_at" TIMESTAMPTZ(3) NOT NULL,
    "cash_deadline_at" TIMESTAMPTZ(3) NOT NULL,
    "gender_rule_enabled" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_stop" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "trip_id" UUID NOT NULL,
    "route_stop_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "arrival_at" TIMESTAMPTZ(3),
    "departure_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trip_stop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_seat" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "trip_id" UUID NOT NULL,
    "seat_layout_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "online_sellable" BOOLEAN NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trip_seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_occupation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "trip_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "from_seq" INTEGER NOT NULL,
    "to_seq" INTEGER NOT NULL,
    "booking_id" UUID NOT NULL,
    "booking_passenger_id" UUID NOT NULL,
    "gender" "Gender",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_occupation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "city_slug_key" ON "city"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "station_slug_key" ON "station"("slug");

-- CreateIndex
CREATE INDEX "station_city_id_idx" ON "station"("city_id");

-- CreateIndex
CREATE INDEX "station_owner_company_id_idx" ON "station"("owner_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_id_company_id_key" ON "route"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_company_id_name_key" ON "route"("company_id", "name");

-- CreateIndex
CREATE INDEX "route_stop_station_id_idx" ON "route_stop"("station_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stop_route_id_seq_key" ON "route_stop"("route_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "route_stop_route_id_station_id_key" ON "route_stop"("route_id", "station_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stop_route_id_id_key" ON "route_stop"("route_id", "id");

-- CreateIndex
CREATE INDEX "fare_route_id_idx" ON "fare"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layout_id_company_id_key" ON "seat_layout"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layout_company_id_name_version_key" ON "seat_layout"("company_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layout_id_label_key" ON "seat"("layout_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layout_id_row_index_col_index_key" ON "seat"("layout_id", "row_index", "col_index");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layout_id_id_key" ON "seat"("layout_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bus_company_id_plate_key" ON "bus"("company_id", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "bus_id_company_id_seat_layout_id_key" ON "bus"("id", "company_id", "seat_layout_id");

-- CreateIndex
CREATE INDEX "trip_company_id_service_date_idx" ON "trip"("company_id", "service_date");

-- CreateIndex
CREATE INDEX "trip_route_id_idx" ON "trip"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_id_company_id_key" ON "trip"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_id_seat_layout_id_key" ON "trip"("id", "seat_layout_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stop_trip_id_seq_key" ON "trip_stop"("trip_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stop_trip_id_id_key" ON "trip_stop"("trip_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_seat_trip_id_seat_id_key" ON "trip_seat"("trip_id", "seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_occupation_booking_passenger_id_key" ON "seat_occupation"("booking_passenger_id");

-- CreateIndex
CREATE INDEX "seat_occupation_booking_id_idx" ON "seat_occupation"("booking_id");

-- AddForeignKey
ALTER TABLE "station" ADD CONSTRAINT "station_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "city"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station" ADD CONSTRAINT "station_owner_company_id_fkey" FOREIGN KEY ("owner_company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route" ADD CONSTRAINT "route_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stop" ADD CONSTRAINT "route_stop_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stop" ADD CONSTRAINT "route_stop_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fare" ADD CONSTRAINT "fare_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fare" ADD CONSTRAINT "fare_route_id_from_route_stop_id_fkey" FOREIGN KEY ("route_id", "from_route_stop_id") REFERENCES "route_stop"("route_id", "id") ON DELETE NO ACTION ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fare" ADD CONSTRAINT "fare_route_id_to_route_stop_id_fkey" FOREIGN KEY ("route_id", "to_route_stop_id") REFERENCES "route_stop"("route_id", "id") ON DELETE NO ACTION ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "seat_layout" ADD CONSTRAINT "seat_layout_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_layout" ADD CONSTRAINT "seat_layout_supersedes_layout_id_fkey" FOREIGN KEY ("supersedes_layout_id") REFERENCES "seat_layout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat" ADD CONSTRAINT "seat_layout_id_fkey" FOREIGN KEY ("layout_id") REFERENCES "seat_layout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_neighbor" ADD CONSTRAINT "seat_neighbor_layout_id_fkey" FOREIGN KEY ("layout_id") REFERENCES "seat_layout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_neighbor" ADD CONSTRAINT "seat_neighbor_layout_id_seat_id_fkey" FOREIGN KEY ("layout_id", "seat_id") REFERENCES "seat"("layout_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "seat_neighbor" ADD CONSTRAINT "seat_neighbor_layout_id_neighbor_seat_id_fkey" FOREIGN KEY ("layout_id", "neighbor_seat_id") REFERENCES "seat"("layout_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bus" ADD CONSTRAINT "bus_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus" ADD CONSTRAINT "bus_seat_layout_id_company_id_fkey" FOREIGN KEY ("seat_layout_id", "company_id") REFERENCES "seat_layout"("id", "company_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "route"("id", "company_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_seat_layout_id_company_id_fkey" FOREIGN KEY ("seat_layout_id", "company_id") REFERENCES "seat_layout"("id", "company_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_bus_id_company_id_seat_layout_id_fkey" FOREIGN KEY ("bus_id", "company_id", "seat_layout_id") REFERENCES "bus"("id", "company_id", "seat_layout_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_route_stop_id_fkey" FOREIGN KEY ("route_stop_id") REFERENCES "route_stop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_seat" ADD CONSTRAINT "trip_seat_trip_id_seat_layout_id_fkey" FOREIGN KEY ("trip_id", "seat_layout_id") REFERENCES "trip"("id", "seat_layout_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "trip_seat" ADD CONSTRAINT "trip_seat_seat_layout_id_seat_id_fkey" FOREIGN KEY ("seat_layout_id", "seat_id") REFERENCES "seat"("layout_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "seat_occupation" ADD CONSTRAINT "seat_occupation_trip_id_seat_id_fkey" FOREIGN KEY ("trip_id", "seat_id") REFERENCES "trip_seat"("trip_id", "seat_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "seat_occupation" ADD CONSTRAINT "seat_occupation_trip_id_from_seq_fkey" FOREIGN KEY ("trip_id", "from_seq") REFERENCES "trip_stop"("trip_id", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "seat_occupation" ADD CONSTRAINT "seat_occupation_trip_id_to_seq_fkey" FOREIGN KEY ("trip_id", "to_seq") REFERENCES "trip_stop"("trip_id", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- Handgeschrieben (ADR 0004, ADR 0005). Prisma kennt EXCLUDE- und CHECK-Constraints nicht.
-- Am 2026-10-31 geprüft: Prisma 7.10 meldet sie beim Abgleich (db:check) nicht als Abweichung und
-- erzeugt in Folgemigrationen nichts, was sie entfernt. test/inventory-schema.e2e.test.ts weist
-- jeden dieser Constraints in der Datenbank nach.
-- ---------------------------------------------------------------------------------------------

-- Kern des Inventars: Kein Sitz ist auf überlappenden Teilstrecken derselben Fahrt doppelt belegt.
-- Teilstrecken sind halboffen: [0,2) und [2,4) überlappen nicht, der Sitz wird am Ausstiegshalt frei.
ALTER TABLE "seat_occupation"
  ADD CONSTRAINT "seat_occupation_seq_order" CHECK ("from_seq" < "to_seq"),
  ADD CONSTRAINT "seat_occupation_no_overlap"
    EXCLUDE USING gist (
      "trip_id" WITH =,
      "seat_id" WITH =,
      int4range("from_seq", "to_seq", '[)') WITH &&
    );

-- Ein Haltestellenpaar hat an jedem Fahrtag höchstens einen Tarif. Sonst hätte eine Buchung zwei
-- mögliche Preise. Gültigkeit halboffen: [valid_from, valid_until), NULL heißt unbefristet.
ALTER TABLE "fare"
  ADD CONSTRAINT "fare_distinct_stops" CHECK ("from_route_stop_id" <> "to_route_stop_id"),
  ADD CONSTRAINT "fare_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "fare_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "fare_validity_order" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
  ADD CONSTRAINT "fare_no_overlap"
    EXCLUDE USING gist (
      "from_route_stop_id" WITH =,
      "to_route_stop_id" WITH =,
      daterange("valid_from", "valid_until", '[)') WITH &&
    );

ALTER TABLE "route_stop"
  ADD CONSTRAINT "route_stop_seq_nonnegative" CHECK ("seq" >= 0);

ALTER TABLE "trip_stop"
  ADD CONSTRAINT "trip_stop_seq_nonnegative" CHECK ("seq" >= 0),
  ADD CONSTRAINT "trip_stop_has_time" CHECK ("arrival_at" IS NOT NULL OR "departure_at" IS NOT NULL),
  ADD CONSTRAINT "trip_stop_time_order"
    CHECK ("arrival_at" IS NULL OR "departure_at" IS NULL OR "departure_at" >= "arrival_at");

ALTER TABLE "trip"
  ADD CONSTRAINT "trip_time_order" CHECK ("arrival_at" > "departure_at"),
  ADD CONSTRAINT "trip_sales_close_not_after_departure" CHECK ("online_sales_close_at" <= "departure_at"),
  ADD CONSTRAINT "trip_cash_deadline_not_after_departure" CHECK ("cash_deadline_at" <= "departure_at");

ALTER TABLE "seat"
  ADD CONSTRAINT "seat_position_nonnegative" CHECK ("row_index" >= 0 AND "col_index" >= 0);

-- Ein Sitz ist nie sein eigener Nachbar; die Geschlechtsregel würde sonst die eigene Buchung prüfen.
ALTER TABLE "seat_neighbor"
  ADD CONSTRAINT "seat_neighbor_not_self" CHECK ("seat_id" <> "neighbor_seat_id");

ALTER TABLE "seat_layout"
  ADD CONSTRAINT "seat_layout_version_positive" CHECK ("version" >= 1);
