/**
 * Preise einer Buchung in Minor-Units (ADR 0011). Reine Funktionen, nur ganze Zahlen.
 */

/** Größter Wert einer `integer`-Spalte in PostgreSQL; Einzelbeträge sind `integer` (ADR 0011). */
export const MAX_INT4 = 2_147_483_647;

export interface BookingPrice {
  fareAmountMinor: number;
  totalAmountMinor: number;
  currency: string;
}

function assertAmount(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INT4) {
    throw new RangeError(`${what} liegt außerhalb von 0 bis ${MAX_INT4}`);
  }
}

/** Gesamtbetrag = Tarif × Fahrgäste (Invariante im Domänenmodell). */
export function priceBooking(
  fare: { amountMinor: number; currency: string },
  passengers: number,
): BookingPrice {
  assertAmount(fare.amountMinor, 'Tarif');
  if (!Number.isSafeInteger(passengers) || passengers < 1) {
    throw new RangeError('Mindestens ein Fahrgast');
  }
  const totalAmountMinor = fare.amountMinor * passengers;
  assertAmount(totalAmountMinor, 'Gesamtbetrag');
  return { fareAmountMinor: fare.amountMinor, totalAmountMinor, currency: fare.currency };
}

/**
 * Anteil in Basispunkten, kaufmännisch auf ganze Minor-Units gerundet (halbe Einheiten aufwärts).
 * Einzige Rundungsstelle für Provision und Stornogebühr (ADR 0011, 0017).
 */
export function basisPointsOf(amountMinor: number, bps: number): number {
  assertAmount(amountMinor, 'Betrag');
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new RangeError('Basispunkte liegen außerhalb von 0 bis 10 000');
  }
  // amountMinor ≤ 2³¹ und bps ≤ 10⁴: das Produkt bleibt unter 2⁵³, also exakt.
  return Math.floor((amountMinor * bps + 5_000) / 10_000);
}
