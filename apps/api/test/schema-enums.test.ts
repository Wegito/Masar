import {
  BOOKING_CHANNELS,
  BOOKING_STATUSES,
  BUS_STATUSES,
  CANCEL_ACTORS,
  COMPANY_ROLES,
  GENDERS,
  LICENSE_PLANS,
  LOCALES,
  PAYEES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  SEAT_LAYOUT_PATTERNS,
  SEAT_LAYOUT_STATUSES,
  SEAT_SIDES,
  TICKET_STATUSES,
  TRIP_STATUSES,
} from '@masar/shared';
import { describe, expect, it } from 'vitest';

import {
  BookingChannel,
  BookingStatus,
  BusStatus,
  CancelActor,
  CompanyRole,
  Gender,
  LicensePlan,
  Locale,
  Payee,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
  SeatLayoutPattern,
  SeatLayoutStatus,
  SeatSide,
  TicketStatus,
  TripStatus,
} from '../src/generated/prisma/enums.js';

/** Datenbank-Enums und die Werte im gemeinsamen Paket müssen übereinstimmen (Web nutzt die zweiten). */
describe('Enums in Datenbankschema und gemeinsamem Paket', () => {
  it.each([
    ['CompanyRole', Object.values(CompanyRole), COMPANY_ROLES],
    ['Locale', Object.values(Locale), LOCALES],
    ['Gender', Object.values(Gender), GENDERS],
    ['TripStatus', Object.values(TripStatus), TRIP_STATUSES],
    ['SeatSide', Object.values(SeatSide), SEAT_SIDES],
    ['BookingStatus', Object.values(BookingStatus), BOOKING_STATUSES],
    ['BookingChannel', Object.values(BookingChannel), BOOKING_CHANNELS],
    ['PaymentMethod', Object.values(PaymentMethod), PAYMENT_METHODS],
    ['CancelActor', Object.values(CancelActor), CANCEL_ACTORS],
    ['PaymentStatus', Object.values(PaymentStatus), PAYMENT_STATUSES],
    ['Payee', Object.values(Payee), PAYEES],
    ['RefundStatus', Object.values(RefundStatus), REFUND_STATUSES],
    ['TicketStatus', Object.values(TicketStatus), TICKET_STATUSES],
    ['SeatLayoutPattern', Object.values(SeatLayoutPattern), SEAT_LAYOUT_PATTERNS],
    ['SeatLayoutStatus', Object.values(SeatLayoutStatus), SEAT_LAYOUT_STATUSES],
    ['BusStatus', Object.values(BusStatus), BUS_STATUSES],
    ['LicensePlan', Object.values(LicensePlan), LICENSE_PLANS],
  ])('%s stimmt überein', (_name, database, shared) => {
    expect([...database].sort()).toEqual([...shared].sort());
  });
});
