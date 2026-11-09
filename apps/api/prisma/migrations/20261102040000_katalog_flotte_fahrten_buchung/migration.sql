-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'DEPARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SeatSide" AS ENUM ('LEFT', 'RIGHT', 'BENCH');

-- CreateEnum
CREATE TYPE "SeatLayoutPattern" AS ENUM ('TWO_PLUS_TWO', 'TWO_PLUS_ONE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SeatLayoutStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'RESERVED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('ONLINE', 'COUNTER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'WALLET_TRANSFER', 'ECASH', 'INTL_CARD');

-- CreateEnum
CREATE TYPE "CancelActor" AS ENUM ('PASSENGER', 'COMPANY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "BookingPassengerStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AWAITING_REVIEW', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Payee" AS ENUM ('COMPANY', 'PLATFORM');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'MANUAL_DONE');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('ISSUED', 'CHECKED_IN', 'VOID');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "CommissionStatementStatus" AS ENUM ('DRAFT', 'ISSUED');

-- CreateEnum
CREATE TYPE "CommissionLineKind" AS ENUM ('REGULAR', 'CORRECTION');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'IN_APP');

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
    "owner_company_id" UUID,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_policy" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "allow_passenger_cancel" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cancellation_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_policy_rule" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "policy_id" UUID NOT NULL,
    "min_minutes_before_departure" INTEGER NOT NULL,
    "fee_bps" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cancellation_policy_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "cancellation_policy_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
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
    "status" "SeatLayoutStatus" NOT NULL DEFAULT 'DRAFT',
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
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_neighbor" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "layout_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "neighbor_seat_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seat_neighbor_pkey" PRIMARY KEY ("id")
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
    "cash_deadline_at" TIMESTAMPTZ(3),
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
    "seat_id" UUID NOT NULL,
    "seat_layout_id" UUID NOT NULL,
    "online_sellable" BOOLEAN NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trip_seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "booking_code" CHAR(8) NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "channel" "BookingChannel" NOT NULL,
    "payment_method" "PaymentMethod",
    "from_trip_stop_id" UUID NOT NULL,
    "to_trip_stop_id" UUID NOT NULL,
    "from_seq" INTEGER NOT NULL,
    "to_seq" INTEGER NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone_e164" TEXT NOT NULL,
    "contact_email" TEXT,
    "user_id" UUID,
    "locale" "Locale" NOT NULL DEFAULT 'ar',
    "hold_expires_at" TIMESTAMPTZ(3),
    "deadline_at" TIMESTAMPTZ(3),
    "fare_amount_minor" INTEGER NOT NULL,
    "total_amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "commission_rate_bps" INTEGER,
    "commission_amount_minor" INTEGER,
    "manage_token_hash" TEXT,
    "idempotency_key" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" "CancelActor",
    "cancelled_by_user_id" UUID,
    "cancel_reason" TEXT,
    "pii_purge_after" TIMESTAMPTZ(3),
    "pii_purged_at" TIMESTAMPTZ(3),
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
    "national_id_encrypted" BYTEA,
    "national_id_key_id" TEXT,
    "national_id_last4" VARCHAR(4),
    "pii_purge_after" TIMESTAMPTZ(3),
    "pii_purged_at" TIMESTAMPTZ(3),
    "status" "BookingPassengerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_passenger_pkey" PRIMARY KEY ("id")
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
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seat_occupation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "booking_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "payee" "Payee" NOT NULL DEFAULT 'COMPANY',
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fx_rate" DECIMAL(20,10),
    "fx_source" TEXT,
    "fx_at" TIMESTAMPTZ(3),
    "provider_payment_id" TEXT,
    "checkout_url" TEXT,
    "wallet_reference" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "failure_code" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payment_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT,
    "provider_refund_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "requested_by_user_id" UUID,
    "processed_at" TIMESTAMPTZ(3),
    "failure_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider" "PaymentMethod" NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "payment_id" UUID,
    "signature_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "outcome" TEXT,

    CONSTRAINT "payment_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "booking_passenger_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "seat_label" TEXT NOT NULL,
    "qr_token_hash" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'ISSUED',
    "checked_in_at" TIMESTAMPTZ(3),
    "checked_in_by_user_id" UUID,
    "checked_in_device" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rate" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commission_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_statement" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "period" CHAR(7) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "CommissionStatementStatus" NOT NULL DEFAULT 'DRAFT',
    "ticket_total_minor" BIGINT NOT NULL DEFAULT 0,
    "commission_total_minor" BIGINT NOT NULL DEFAULT 0,
    "booking_count" INTEGER NOT NULL DEFAULT 0,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "cash_unconfirmed_count" INTEGER NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commission_statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_statement_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "statement_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" "CommissionLineKind" NOT NULL DEFAULT 'REGULAR',
    "ticket_amount_minor" INTEGER NOT NULL,
    "commission_amount_minor" INTEGER NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commission_statement_line_pkey" PRIMARY KEY ("id")
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
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID,
    "booking_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'ar',
    "data" JSONB,
    "sent_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "city_slug_key" ON "city"("slug");

-- CreateIndex
CREATE INDEX "station_city_id_idx" ON "station"("city_id");

-- CreateIndex
CREATE INDEX "station_owner_company_id_idx" ON "station"("owner_company_id");

-- CreateIndex
CREATE INDEX "cancellation_policy_company_id_idx" ON "cancellation_policy"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_policy_id_company_id_key" ON "cancellation_policy"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_policy_rule_policy_id_min_minutes_before_depar_key" ON "cancellation_policy_rule"("policy_id", "min_minutes_before_departure");

-- CreateIndex
CREATE INDEX "route_company_id_idx" ON "route"("company_id");

-- CreateIndex
CREATE INDEX "route_cancellation_policy_id_idx" ON "route"("cancellation_policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_id_company_id_key" ON "route"("id", "company_id");

-- CreateIndex
CREATE INDEX "route_stop_station_id_idx" ON "route_stop"("station_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stop_route_id_seq_key" ON "route_stop"("route_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "route_stop_route_id_station_id_key" ON "route_stop"("route_id", "station_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stop_id_route_id_key" ON "route_stop"("id", "route_id");

-- CreateIndex
CREATE INDEX "fare_route_id_idx" ON "fare"("route_id");

-- CreateIndex
CREATE INDEX "fare_from_route_stop_id_to_route_stop_id_idx" ON "fare"("from_route_stop_id", "to_route_stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layout_company_id_name_version_key" ON "seat_layout"("company_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layout_id_company_id_key" ON "seat_layout"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layout_id_label_key" ON "seat"("layout_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layout_id_row_index_col_index_key" ON "seat"("layout_id", "row_index", "col_index");

-- CreateIndex
CREATE UNIQUE INDEX "seat_id_layout_id_key" ON "seat"("id", "layout_id");

-- CreateIndex
CREATE INDEX "seat_neighbor_layout_id_idx" ON "seat_neighbor"("layout_id");

-- CreateIndex
CREATE INDEX "seat_neighbor_neighbor_seat_id_idx" ON "seat_neighbor"("neighbor_seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_neighbor_seat_id_neighbor_seat_id_key" ON "seat_neighbor"("seat_id", "neighbor_seat_id");

-- CreateIndex
CREATE INDEX "bus_seat_layout_id_idx" ON "bus"("seat_layout_id");

-- CreateIndex
CREATE UNIQUE INDEX "bus_company_id_plate_key" ON "bus"("company_id", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "bus_id_company_id_seat_layout_id_key" ON "bus"("id", "company_id", "seat_layout_id");

-- CreateIndex
CREATE INDEX "trip_company_id_service_date_idx" ON "trip"("company_id", "service_date");

-- CreateIndex
CREATE INDEX "trip_route_id_service_date_idx" ON "trip"("route_id", "service_date");

-- CreateIndex
CREATE INDEX "trip_seat_layout_id_idx" ON "trip"("seat_layout_id");

-- CreateIndex
CREATE INDEX "trip_bus_id_idx" ON "trip"("bus_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_id_company_id_key" ON "trip"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_id_seat_layout_id_key" ON "trip"("id", "seat_layout_id");

-- CreateIndex
CREATE INDEX "trip_stop_station_id_departure_at_idx" ON "trip_stop"("station_id", "departure_at");

-- CreateIndex
CREATE INDEX "trip_stop_route_stop_id_idx" ON "trip_stop"("route_stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stop_trip_id_seq_key" ON "trip_stop"("trip_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stop_id_trip_id_seq_key" ON "trip_stop"("id", "trip_id", "seq");

-- CreateIndex
CREATE INDEX "trip_seat_seat_id_idx" ON "trip_seat"("seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_seat_trip_id_seat_id_key" ON "trip_seat"("trip_id", "seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_booking_code_key" ON "booking"("booking_code");

-- CreateIndex
CREATE UNIQUE INDEX "booking_manage_token_hash_key" ON "booking"("manage_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "booking_idempotency_key_key" ON "booking"("idempotency_key");

-- CreateIndex
CREATE INDEX "booking_company_id_created_at_idx" ON "booking"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "booking_trip_id_status_idx" ON "booking"("trip_id", "status");

-- CreateIndex
CREATE INDEX "booking_status_hold_expires_at_idx" ON "booking"("status", "hold_expires_at");

-- CreateIndex
CREATE INDEX "booking_user_id_idx" ON "booking"("user_id");

-- CreateIndex
CREATE INDEX "booking_from_trip_stop_id_idx" ON "booking"("from_trip_stop_id");

-- CreateIndex
CREATE INDEX "booking_to_trip_stop_id_idx" ON "booking"("to_trip_stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_id_company_id_key" ON "booking"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_id_trip_id_key" ON "booking"("id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_id_trip_id_from_seq_to_seq_key" ON "booking"("id", "trip_id", "from_seq", "to_seq");

-- CreateIndex
CREATE INDEX "booking_passenger_trip_id_seat_id_idx" ON "booking_passenger"("trip_id", "seat_id");

-- CreateIndex
CREATE INDEX "booking_passenger_pii_purge_after_idx" ON "booking_passenger"("pii_purge_after");

-- CreateIndex
CREATE UNIQUE INDEX "booking_passenger_booking_id_seat_id_key" ON "booking_passenger"("booking_id", "seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_passenger_id_booking_id_key" ON "booking_passenger"("id", "booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_passenger_id_booking_id_seat_id_key" ON "booking_passenger"("id", "booking_id", "seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_occupation_booking_passenger_id_key" ON "seat_occupation"("booking_passenger_id");

-- CreateIndex
CREATE INDEX "seat_occupation_booking_id_idx" ON "seat_occupation"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_idempotency_key_key" ON "payment"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_booking_id_idx" ON "payment"("booking_id");

-- CreateIndex
CREATE INDEX "payment_company_id_status_idx" ON "payment"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_id_company_id_key" ON "payment"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_provider_payment_id_key" ON "payment"("method", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_company_id_method_wallet_reference_key" ON "payment"("company_id", "method", "wallet_reference");

-- CreateIndex
CREATE UNIQUE INDEX "refund_idempotency_key_key" ON "refund"("idempotency_key");

-- CreateIndex
CREATE INDEX "refund_payment_id_idx" ON "refund"("payment_id");

-- CreateIndex
CREATE INDEX "refund_booking_id_idx" ON "refund"("booking_id");

-- CreateIndex
CREATE INDEX "refund_company_id_status_idx" ON "refund"("company_id", "status");

-- CreateIndex
CREATE INDEX "payment_webhook_event_payment_id_idx" ON "payment_webhook_event"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_event_provider_provider_event_id_key" ON "payment_webhook_event"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_booking_passenger_id_key" ON "ticket"("booking_passenger_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_qr_token_hash_key" ON "ticket"("qr_token_hash");

-- CreateIndex
CREATE INDEX "ticket_booking_id_idx" ON "ticket"("booking_id");

-- CreateIndex
CREATE INDEX "ticket_trip_id_status_idx" ON "ticket"("trip_id", "status");

-- CreateIndex
CREATE INDEX "ticket_company_id_idx" ON "ticket"("company_id");

-- CreateIndex
CREATE INDEX "commission_rate_company_id_idx" ON "commission_rate"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_statement_company_id_period_currency_key" ON "commission_statement"("company_id", "period", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "commission_statement_id_company_id_key" ON "commission_statement"("id", "company_id");

-- CreateIndex
CREATE INDEX "commission_statement_line_statement_id_idx" ON "commission_statement_line"("statement_id");

-- CreateIndex
CREATE INDEX "commission_statement_line_booking_id_idx" ON "commission_statement_line"("booking_id");

-- CreateIndex
CREATE INDEX "outbox_status_next_attempt_at_idx" ON "outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbox_aggregate_type_aggregate_id_idx" ON "outbox"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "notification_user_id_created_at_idx" ON "notification"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_booking_id_idx" ON "notification"("booking_id");

-- AddForeignKey
ALTER TABLE "station" ADD CONSTRAINT "station_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "city"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station" ADD CONSTRAINT "station_owner_company_id_fkey" FOREIGN KEY ("owner_company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_policy" ADD CONSTRAINT "cancellation_policy_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_policy_rule" ADD CONSTRAINT "cancellation_policy_rule_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "cancellation_policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route" ADD CONSTRAINT "route_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route" ADD CONSTRAINT "route_cancellation_policy_id_company_id_fkey" FOREIGN KEY ("cancellation_policy_id", "company_id") REFERENCES "cancellation_policy"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stop" ADD CONSTRAINT "route_stop_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stop" ADD CONSTRAINT "route_stop_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fare" ADD CONSTRAINT "fare_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fare" ADD CONSTRAINT "fare_from_route_stop_id_route_id_fkey" FOREIGN KEY ("from_route_stop_id", "route_id") REFERENCES "route_stop"("id", "route_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fare" ADD CONSTRAINT "fare_to_route_stop_id_route_id_fkey" FOREIGN KEY ("to_route_stop_id", "route_id") REFERENCES "route_stop"("id", "route_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_layout" ADD CONSTRAINT "seat_layout_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_layout" ADD CONSTRAINT "seat_layout_supersedes_layout_id_fkey" FOREIGN KEY ("supersedes_layout_id") REFERENCES "seat_layout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat" ADD CONSTRAINT "seat_layout_id_fkey" FOREIGN KEY ("layout_id") REFERENCES "seat_layout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_neighbor" ADD CONSTRAINT "seat_neighbor_layout_id_fkey" FOREIGN KEY ("layout_id") REFERENCES "seat_layout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_neighbor" ADD CONSTRAINT "seat_neighbor_seat_id_layout_id_fkey" FOREIGN KEY ("seat_id", "layout_id") REFERENCES "seat"("id", "layout_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_neighbor" ADD CONSTRAINT "seat_neighbor_neighbor_seat_id_layout_id_fkey" FOREIGN KEY ("neighbor_seat_id", "layout_id") REFERENCES "seat"("id", "layout_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus" ADD CONSTRAINT "bus_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus" ADD CONSTRAINT "bus_seat_layout_id_company_id_fkey" FOREIGN KEY ("seat_layout_id", "company_id") REFERENCES "seat_layout"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "route"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_seat_layout_id_company_id_fkey" FOREIGN KEY ("seat_layout_id", "company_id") REFERENCES "seat_layout"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_bus_id_company_id_seat_layout_id_fkey" FOREIGN KEY ("bus_id", "company_id", "seat_layout_id") REFERENCES "bus"("id", "company_id", "seat_layout_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_route_stop_id_fkey" FOREIGN KEY ("route_stop_id") REFERENCES "route_stop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_seat" ADD CONSTRAINT "trip_seat_trip_id_seat_layout_id_fkey" FOREIGN KEY ("trip_id", "seat_layout_id") REFERENCES "trip"("id", "seat_layout_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "trip_seat" ADD CONSTRAINT "trip_seat_seat_id_seat_layout_id_fkey" FOREIGN KEY ("seat_id", "seat_layout_id") REFERENCES "seat"("id", "layout_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_trip_id_company_id_fkey" FOREIGN KEY ("trip_id", "company_id") REFERENCES "trip"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_from_trip_stop_id_trip_id_from_seq_fkey" FOREIGN KEY ("from_trip_stop_id", "trip_id", "from_seq") REFERENCES "trip_stop"("id", "trip_id", "seq") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_to_trip_stop_id_trip_id_to_seq_fkey" FOREIGN KEY ("to_trip_stop_id", "trip_id", "to_seq") REFERENCES "trip_stop"("id", "trip_id", "seq") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_passenger" ADD CONSTRAINT "booking_passenger_booking_id_trip_id_fkey" FOREIGN KEY ("booking_id", "trip_id") REFERENCES "booking"("id", "trip_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_passenger" ADD CONSTRAINT "booking_passenger_trip_id_seat_id_fkey" FOREIGN KEY ("trip_id", "seat_id") REFERENCES "trip_seat"("trip_id", "seat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_occupation" ADD CONSTRAINT "seat_occupation_booking_id_trip_id_from_seq_to_seq_fkey" FOREIGN KEY ("booking_id", "trip_id", "from_seq", "to_seq") REFERENCES "booking"("id", "trip_id", "from_seq", "to_seq") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_occupation" ADD CONSTRAINT "seat_occupation_booking_passenger_id_booking_id_seat_id_fkey" FOREIGN KEY ("booking_passenger_id", "booking_id", "seat_id") REFERENCES "booking_passenger"("id", "booking_id", "seat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_occupation" ADD CONSTRAINT "seat_occupation_trip_id_seat_id_fkey" FOREIGN KEY ("trip_id", "seat_id") REFERENCES "trip_seat"("trip_id", "seat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_booking_id_company_id_fkey" FOREIGN KEY ("booking_id", "company_id") REFERENCES "booking"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_id_company_id_fkey" FOREIGN KEY ("payment_id", "company_id") REFERENCES "payment"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_booking_id_company_id_fkey" FOREIGN KEY ("booking_id", "company_id") REFERENCES "booking"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_webhook_event" ADD CONSTRAINT "payment_webhook_event_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_trip_id_company_id_fkey" FOREIGN KEY ("trip_id", "company_id") REFERENCES "trip"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_booking_id_trip_id_fkey" FOREIGN KEY ("booking_id", "trip_id") REFERENCES "booking"("id", "trip_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_booking_passenger_id_booking_id_fkey" FOREIGN KEY ("booking_passenger_id", "booking_id") REFERENCES "booking_passenger"("id", "booking_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rate" ADD CONSTRAINT "commission_rate_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_statement" ADD CONSTRAINT "commission_statement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_statement_line" ADD CONSTRAINT "commission_statement_line_statement_id_company_id_fkey" FOREIGN KEY ("statement_id", "company_id") REFERENCES "commission_statement"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_statement_line" ADD CONSTRAINT "commission_statement_line_booking_id_company_id_fkey" FOREIGN KEY ("booking_id", "company_id") REFERENCES "booking"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Handgeschrieben (ADR 0004, 0005, 0018). Prisma kennt diese Objekte nicht; der Test
-- apps/api/test/inventory.e2e.test.ts weist jedes davon in der Datenbank nach.
-- Die Extension btree_gist legt bereits die Migration 20261012092834_init an.
-- ---------------------------------------------------------------------------------------------

-- Sitzbelegung: Kein Sitz doppelt auf überlappenden Teilstrecken derselben Fahrt (ADR 0005).
-- Teilstrecken sind halboffen: [0,2) und [2,4) überlappen nicht, [0,3) und [2,4) schon.
ALTER TABLE "seat_occupation"
  ADD CONSTRAINT "seat_occupation_seq_order" CHECK ("from_seq" >= 0 AND "from_seq" < "to_seq"),
  ADD CONSTRAINT "seat_occupation_no_overlap"
    EXCLUDE USING gist (
      "trip_id" WITH =,
      "seat_id" WITH =,
      int4range("from_seq", "to_seq", '[)') WITH &&
    );

-- Tarife: je Haltestellenpaar höchstens ein gültiger Tarif pro Fahrtag. valid_until NULL heißt
-- unbefristet (daterange ohne Obergrenze).
ALTER TABLE "fare"
  ADD CONSTRAINT "fare_amount_nonnegative" CHECK ("amount_minor" >= 0),
  ADD CONSTRAINT "fare_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "fare_valid_range" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
  ADD CONSTRAINT "fare_distinct_stops" CHECK ("from_route_stop_id" <> "to_route_stop_id"),
  ADD CONSTRAINT "fare_no_overlap"
    EXCLUDE USING gist (
      "from_route_stop_id" WITH =,
      "to_route_stop_id" WITH =,
      daterange("valid_from", "valid_until", '[)') WITH &&
    );

-- Provisionssatz: je Firma höchstens ein Satz pro Fahrtag (ADR 0017).
ALTER TABLE "commission_rate"
  ADD CONSTRAINT "commission_rate_range" CHECK ("rate_bps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "commission_rate_valid_range" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
  ADD CONSTRAINT "commission_rate_no_overlap"
    EXCLUDE USING gist (
      "company_id" WITH =,
      daterange("valid_from", "valid_until", '[)') WITH &&
    );

-- Buchung
ALTER TABLE "booking"
  ADD CONSTRAINT "booking_seq_order" CHECK ("from_seq" >= 0 AND "from_seq" < "to_seq"),
  ADD CONSTRAINT "booking_amounts_nonnegative" CHECK (
    "fare_amount_minor" >= 0
    AND "total_amount_minor" >= 0
    AND ("commission_amount_minor" IS NULL OR "commission_amount_minor" >= 0)
  ),
  ADD CONSTRAINT "booking_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "booking_commission_rate_range" CHECK ("commission_rate_bps" IS NULL OR "commission_rate_bps" BETWEEN 0 AND 10000),
  -- Crockford-Base32 ohne I, L, O, U (ADR 0013, BOOKING_CODE_ALPHABET in @masar/shared).
  ADD CONSTRAINT "booking_code_format" CHECK ("booking_code" ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  ADD CONSTRAINT "booking_held_has_expiry" CHECK ("status" <> 'HELD' OR "hold_expires_at" IS NOT NULL),
  ADD CONSTRAINT "booking_confirmed_has_timestamp" CHECK ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL),
  ADD CONSTRAINT "booking_cancelled_has_timestamp" CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL),
  ADD CONSTRAINT "booking_contact_email_normalized" CHECK ("contact_email" = lower(btrim("contact_email")));

-- Fahrgast: Chiffrat und Schlüssel-ID nur gemeinsam; die letzten vier Stellen nur mit Chiffrat.
ALTER TABLE "booking_passenger"
  ADD CONSTRAINT "booking_passenger_national_id_complete" CHECK (("national_id_encrypted" IS NULL) = ("national_id_key_id" IS NULL)),
  ADD CONSTRAINT "booking_passenger_national_id_last4" CHECK ("national_id_last4" IS NULL OR "national_id_encrypted" IS NOT NULL);

-- Zahlung und Erstattung
ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amount_nonnegative" CHECK ("amount_minor" >= 0),
  ADD CONSTRAINT "payment_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "payment_fx_complete" CHECK (
    ("fx_rate" IS NULL) = ("fx_source" IS NULL) AND ("fx_rate" IS NULL) = ("fx_at" IS NULL)
  ),
  ADD CONSTRAINT "payment_fx_rate_positive" CHECK ("fx_rate" IS NULL OR "fx_rate" > 0);

ALTER TABLE "refund"
  ADD CONSTRAINT "refund_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "refund_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');

-- Fahrt und Halte
ALTER TABLE "trip"
  ADD CONSTRAINT "trip_arrival_after_departure" CHECK ("arrival_at" > "departure_at"),
  ADD CONSTRAINT "trip_sales_close_before_departure" CHECK ("online_sales_close_at" <= "departure_at"),
  ADD CONSTRAINT "trip_cash_deadline_before_departure" CHECK ("cash_deadline_at" IS NULL OR "cash_deadline_at" <= "departure_at"),
  ADD CONSTRAINT "trip_version_nonnegative" CHECK ("version" >= 0);

ALTER TABLE "trip_stop"
  ADD CONSTRAINT "trip_stop_seq_nonnegative" CHECK ("seq" >= 0),
  ADD CONSTRAINT "trip_stop_times_order" CHECK ("arrival_at" IS NULL OR "departure_at" IS NULL OR "arrival_at" <= "departure_at");

ALTER TABLE "route_stop"
  ADD CONSTRAINT "route_stop_seq_nonnegative" CHECK ("seq" >= 0);

-- Flotte
ALTER TABLE "seat_layout"
  ADD CONSTRAINT "seat_layout_version_positive" CHECK ("version" >= 1);

ALTER TABLE "seat"
  ADD CONSTRAINT "seat_position_nonnegative" CHECK ("row_index" >= 0 AND "col_index" >= 0),
  ADD CONSTRAINT "seat_label_not_blank" CHECK (btrim("label") <> '');

ALTER TABLE "seat_neighbor"
  ADD CONSTRAINT "seat_neighbor_not_self" CHECK ("seat_id" <> "neighbor_seat_id");

ALTER TABLE "station"
  ADD CONSTRAINT "station_coordinates" CHECK (
    ("lat" IS NULL) = ("lng" IS NULL)
    AND ("lat" IS NULL OR "lat" BETWEEN -90 AND 90)
    AND ("lng" IS NULL OR "lng" BETWEEN -180 AND 180)
  );

-- Regeln
ALTER TABLE "cancellation_policy_rule"
  ADD CONSTRAINT "cancellation_policy_rule_minutes_nonnegative" CHECK ("min_minutes_before_departure" >= 0),
  ADD CONSTRAINT "cancellation_policy_rule_fee_range" CHECK ("fee_bps" BETWEEN 0 AND 10000);

-- Ticket
ALTER TABLE "ticket"
  ADD CONSTRAINT "ticket_checked_in_has_timestamp" CHECK ("status" <> 'CHECKED_IN' OR "checked_in_at" IS NOT NULL);

-- Abrechnung
ALTER TABLE "commission_statement"
  ADD CONSTRAINT "commission_statement_period_format" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "commission_statement_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');

-- Querschnitt
ALTER TABLE "outbox"
  ADD CONSTRAINT "outbox_attempts_nonnegative" CHECK ("attempts" >= 0);

ALTER TABLE "notification"
  ADD CONSTRAINT "notification_has_recipient" CHECK ("user_id" IS NOT NULL OR "booking_id" IS NOT NULL);

-- Rechte der Anwendungsrolle (Default-Privilegien geben SELECT, INSERT, UPDATE, DELETE).
-- Buchungen, Fahrgäste, Tickets, Zahlungen und Erstattungen sind Historie: Statusänderungen ja,
-- Löschen nein. Belegungen (seat_occupation) bleiben löschbar, weil Storno und Ablauf sie entfernen.
REVOKE DELETE ON "booking", "booking_passenger", "ticket", "payment", "refund" FROM masar_app;
-- Webhook-Eingänge sind Beleg dafür, was ein Anbieter gemeldet hat: nur Verarbeitungsvermerk
-- (processed_at, outcome) darf sich ändern, gelöscht wird nichts.
REVOKE DELETE ON "payment_webhook_event" FROM masar_app;
