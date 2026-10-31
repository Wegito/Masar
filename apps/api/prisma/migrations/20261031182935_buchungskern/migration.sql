-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'RESERVED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('ONLINE', 'COUNTER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'WALLET_TRANSFER', 'ECASH', 'INTL_CARD');

-- CreateEnum
CREATE TYPE "CancelActor" AS ENUM ('PASSENGER', 'COMPANY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CancelReason" AS ENUM ('PASSENGER_REQUEST', 'TRIP_CHANGED', 'TRIP_CANCELLED', 'DUPLICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AWAITING_REVIEW', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Payee" AS ENUM ('COMPANY', 'PLATFORM');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('ISSUED', 'CHECKED_IN', 'VOID');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "booking_code" CHAR(8) NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "channel" "BookingChannel" NOT NULL,
    "payment_method" "PaymentMethod",
    "from_seq" INTEGER NOT NULL,
    "to_seq" INTEGER NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone_e164" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "hold_expires_at" TIMESTAMPTZ(3),
    "deadline_at" TIMESTAMPTZ(3),
    "fare_amount_minor" INTEGER NOT NULL,
    "total_amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "manage_token_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" "CancelActor",
    "cancel_reason" "CancelReason",
    "expired_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_passenger" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "booking_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "gender" "Gender",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_passenger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "booking_passenger_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "seat_label" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'ISSUED',
    "checked_in_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "booking_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "payee" "Payee" NOT NULL DEFAULT 'COMPANY',
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_booking_code_key" ON "booking"("booking_code");

-- CreateIndex
CREATE UNIQUE INDEX "booking_manage_token_hash_key" ON "booking"("manage_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "booking_idempotency_key_key" ON "booking"("idempotency_key");

-- CreateIndex
CREATE INDEX "booking_trip_id_status_idx" ON "booking"("trip_id", "status");

-- CreateIndex
CREATE INDEX "booking_contact_phone_e164_status_idx" ON "booking"("contact_phone_e164", "status");

-- CreateIndex
CREATE INDEX "booking_status_hold_expires_at_idx" ON "booking"("status", "hold_expires_at");

-- CreateIndex
CREATE INDEX "booking_status_deadline_at_idx" ON "booking"("status", "deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_id_trip_id_key" ON "booking"("id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_id_company_id_key" ON "booking"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_id_trip_id_company_id_key" ON "booking"("id", "trip_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_id_trip_id_from_seq_to_seq_key" ON "booking"("id", "trip_id", "from_seq", "to_seq");

-- CreateIndex
CREATE INDEX "booking_passenger_trip_id_idx" ON "booking_passenger"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_passenger_booking_id_seat_id_key" ON "booking_passenger"("booking_id", "seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_passenger_id_booking_id_trip_id_seat_id_key" ON "booking_passenger"("id", "booking_id", "trip_id", "seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_booking_passenger_id_key" ON "ticket"("booking_passenger_id");

-- CreateIndex
CREATE INDEX "ticket_booking_id_idx" ON "ticket"("booking_id");

-- CreateIndex
CREATE INDEX "ticket_trip_id_idx" ON "ticket"("trip_id");

-- CreateIndex
CREATE INDEX "payment_booking_id_idx" ON "payment"("booking_id");

-- CreateIndex
CREATE INDEX "outbox_status_next_attempt_at_idx" ON "outbox"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "seat_occupation" ADD CONSTRAINT "seat_occupation_booking_id_trip_id_from_seq_to_seq_fkey" FOREIGN KEY ("booking_id", "trip_id", "from_seq", "to_seq") REFERENCES "booking"("id", "trip_id", "from_seq", "to_seq") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "seat_occupation" ADD CONSTRAINT "seat_occupation_booking_passenger_id_booking_id_trip_id_se_fkey" FOREIGN KEY ("booking_passenger_id", "booking_id", "trip_id", "seat_id") REFERENCES "booking_passenger"("id", "booking_id", "trip_id", "seat_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_trip_id_company_id_fkey" FOREIGN KEY ("trip_id", "company_id") REFERENCES "trip"("id", "company_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_trip_id_from_seq_fkey" FOREIGN KEY ("trip_id", "from_seq") REFERENCES "trip_stop"("trip_id", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_trip_id_to_seq_fkey" FOREIGN KEY ("trip_id", "to_seq") REFERENCES "trip_stop"("trip_id", "seq") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_passenger" ADD CONSTRAINT "booking_passenger_booking_id_trip_id_fkey" FOREIGN KEY ("booking_id", "trip_id") REFERENCES "booking"("id", "trip_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_passenger" ADD CONSTRAINT "booking_passenger_trip_id_seat_id_fkey" FOREIGN KEY ("trip_id", "seat_id") REFERENCES "trip_seat"("trip_id", "seat_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_booking_passenger_id_fkey" FOREIGN KEY ("booking_passenger_id") REFERENCES "booking_passenger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_booking_id_trip_id_company_id_fkey" FOREIGN KEY ("booking_id", "trip_id", "company_id") REFERENCES "booking"("id", "trip_id", "company_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_booking_id_company_id_fkey" FOREIGN KEY ("booking_id", "company_id") REFERENCES "booking"("id", "company_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Handgeschrieben (ADR 0004, 0005, 0013). Nachweis in test/bookings-schema.e2e.test.ts.
-- ---------------------------------------------------------------------------------------------

-- Status und Pflichtfelder hängen zusammen. Ein vergessenes Feld in einem Schreibpfad fällt so
-- sofort auf, statt eine Buchung ohne Frist oder ohne Stornozeitpunkt zu hinterlassen.
ALTER TABLE "booking"
  ADD CONSTRAINT "booking_seq_order" CHECK ("from_seq" < "to_seq"),
  ADD CONSTRAINT "booking_code_format" CHECK ("booking_code" ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  ADD CONSTRAINT "booking_amounts_positive" CHECK ("fare_amount_minor" > 0 AND "total_amount_minor" > 0),
  ADD CONSTRAINT "booking_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "booking_status_fields" CHECK (
    ("status" <> 'HELD' OR "hold_expires_at" IS NOT NULL)
    AND ("status" <> 'RESERVED' OR ("deadline_at" IS NOT NULL AND "payment_method" IS NOT NULL))
    AND ("status" <> 'CONFIRMED' OR ("confirmed_at" IS NOT NULL AND "payment_method" IS NOT NULL))
    AND ("status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL))
    AND ("status" <> 'EXPIRED' OR "expired_at" IS NOT NULL)
  );

ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "payment_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "ticket"
  ADD CONSTRAINT "ticket_checked_in_fields" CHECK ("status" <> 'CHECKED_IN' OR "checked_in_at" IS NOT NULL);

ALTER TABLE "outbox"
  ADD CONSTRAINT "outbox_attempts_nonnegative" CHECK ("attempts" >= 0);
