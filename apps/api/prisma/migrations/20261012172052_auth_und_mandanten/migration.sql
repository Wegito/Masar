-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('ar', 'en');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('STAFF', 'PASSENGER');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('ADMIN', 'AGENT', 'DRIVER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'GUEST', 'SYSTEM');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "phone_e164" TEXT,
    "phone_verified_at" TIMESTAMPTZ(3),
    "password_hash" TEXT,
    "display_name" TEXT NOT NULL,
    "preferred_locale" "Locale" NOT NULL DEFAULT 'ar',
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "gender_rule_enabled" BOOLEAN NOT NULL DEFAULT true,
    "require_national_id" BOOLEAN NOT NULL DEFAULT false,
    "hold_minutes" INTEGER NOT NULL DEFAULT 15,
    "cash_deadline_minutes" INTEGER NOT NULL DEFAULT 120,
    "online_sales_close_minutes" INTEGER NOT NULL DEFAULT 30,
    "default_currency" CHAR(3) NOT NULL DEFAULT 'SYP',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_member" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'ar',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "requested_ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" UUID,
    "company_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "reason" TEXT,
    "data" JSONB,
    "request_id" TEXT,
    "ip" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_phone_e164_key" ON "user"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_slug_key" ON "company"("slug");

-- CreateIndex
CREATE INDEX "company_member_user_id_idx" ON "company_member"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_member_company_id_user_id_key" ON "company_member"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_company_id_idx" ON "invitation"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_hash_key" ON "password_reset"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_user_id_idx" ON "password_reset"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_company_id_occurred_at_idx" ON "audit_log"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_member" ADD CONSTRAINT "company_member_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_member" ADD CONSTRAINT "company_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Handgeschrieben (ADR 0004, ADR 0016). Prisma kennt diese Objekte nicht; Tests weisen sie nach.
-- ---------------------------------------------------------------------------------------------

-- Audit-Log nur anhängend: Die Anwendungsrolle bekam über die Default-Privilegien auch UPDATE und
-- DELETE. Beides wird hier entzogen; Einträge lassen sich nur noch einfügen und lesen.
REVOKE UPDATE, DELETE ON "audit_log" FROM masar_app;

-- E-Mail-Adressen werden in der Anwendung normalisiert. Die Datenbank lehnt nicht normalisierte
-- Werte zusätzlich ab, damit ein vergessener Schreibpfad keine Dubletten (A@x und a@x) erzeugt.
ALTER TABLE "user" ADD CONSTRAINT "user_email_normalized" CHECK ("email" = lower(btrim("email")));
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_email_normalized" CHECK ("email" = lower(btrim("email")));
