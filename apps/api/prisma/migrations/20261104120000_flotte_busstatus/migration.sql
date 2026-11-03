-- Schritt 2.2 (Flotte, ADR 0024): Busse lassen sich deaktivieren. Additiv: neuer Enum-Typ und eine
-- Spalte mit Standardwert; bestehende Busse gelten als aktiv.

-- CreateEnum
CREATE TYPE "BusStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "bus" ADD COLUMN     "status" "BusStatus" NOT NULL DEFAULT 'ACTIVE';
