import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';

/**
 * Ansicht einer Buchung für den Fahrgast (über das Verwaltungstoken) und für das Personal der Firma.
 * Enthält die Personendaten genau dieser Buchung; sie gehen nur an Berechtigte und nie ins Log.
 * Die interne ID erscheint nur in der Ansicht für das Personal (ADR 0013).
 */

const bookingViewSelect = {
  id: true,
  bookingCode: true,
  status: true,
  paymentMethod: true,
  holdExpiresAt: true,
  deadlineAt: true,
  confirmedAt: true,
  cancelledAt: true,
  fareAmountMinor: true,
  totalAmountMinor: true,
  currency: true,
  contactName: true,
  contactPhoneE164: true,
  tripId: true,
  company: { select: { nameAr: true, nameEn: true } },
  fromStop: {
    select: { seq: true, departureAt: true, station: { select: { nameAr: true, nameEn: true } } },
  },
  toStop: {
    select: { seq: true, arrivalAt: true, station: { select: { nameAr: true, nameEn: true } } },
  },
  passengers: {
    select: {
      fullName: true,
      gender: true,
      tripSeat: { select: { seat: { select: { label: true, rowIndex: true, colIndex: true } } } },
    },
  },
  tickets: { select: { seatLabel: true, status: true } },
} satisfies Prisma.BookingSelect;

type Db = PrismaClient | Prisma.TransactionClient;

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export async function loadBookingView(db: Db, bookingId: string) {
  const b = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: bookingViewSelect,
  });
  const passengers = [...b.passengers].sort(
    (x, y) =>
      x.tripSeat.seat.rowIndex - y.tripSeat.seat.rowIndex ||
      x.tripSeat.seat.colIndex - y.tripSeat.seat.colIndex,
  );
  return {
    bookingId: b.id,
    view: {
      bookingCode: b.bookingCode,
      status: b.status,
      paymentMethod: b.paymentMethod,
      holdExpiresAt: iso(b.holdExpiresAt),
      deadlineAt: iso(b.deadlineAt),
      confirmedAt: iso(b.confirmedAt),
      cancelledAt: iso(b.cancelledAt),
      trip: {
        tripId: b.tripId,
        company: b.company,
        from: { seq: b.fromStop.seq, station: b.fromStop.station, at: iso(b.fromStop.departureAt) },
        to: { seq: b.toStop.seq, station: b.toStop.station, at: iso(b.toStop.arrivalAt) },
      },
      fare: { amountMinor: b.fareAmountMinor, currency: b.currency },
      total: { amountMinor: b.totalAmountMinor, currency: b.currency },
      contact: { name: b.contactName, phone: b.contactPhoneE164 },
      passengers: passengers.map((p) => ({
        seatLabel: p.tripSeat.seat.label,
        fullName: p.fullName,
        gender: p.gender,
      })),
      tickets: b.tickets,
    },
  };
}

export type BookingView = Awaited<ReturnType<typeof loadBookingView>>['view'];
