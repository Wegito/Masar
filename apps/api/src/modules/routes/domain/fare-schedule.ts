/**
 * Gültigkeit von Tarifen (Schritt 2.3, ADR 0026). Ein Tarif gilt für Fahrtage im halboffenen
 * Bereich [valid_from, valid_until); leeres Ende heißt unbefristet. Kalendertage sind
 * `YYYY-MM-DD` in Asia/Damascus und lassen sich deshalb als Zeichenketten vergleichen.
 *
 * Ein neuer Tarifstand gilt ab einem Tag D bis auf Weiteres. Ältere Stände enden an D, Stände ab D
 * werden ersetzt. So gibt es je Teilstrecke und Fahrtag immer höchstens einen Preis
 * (`fare_no_overlap`), und Buchungen behalten ihren eingefrorenen Preis.
 */

export interface ScheduledFare {
  id: string;
  validFrom: string;
  validUntil: string | null;
}

export interface FareSchedulePlan {
  /** Stände, die erst ab D oder später gelten: werden durch den neuen ersetzt. */
  deleteIds: string[];
  /** Stände, die vor D beginnen und über D hinaus gelten: enden an D. */
  closeIds: string[];
}

export function planFareSchedule(
  existing: readonly ScheduledFare[],
  validFrom: string,
): FareSchedulePlan {
  const deleteIds: string[] = [];
  const closeIds: string[] = [];
  for (const fare of existing) {
    if (fare.validFrom >= validFrom) {
      deleteIds.push(fare.id);
    } else if (fare.validUntil === null || fare.validUntil > validFrom) {
      closeIds.push(fare.id);
    }
  }
  return { deleteIds, closeIds };
}

/** Ein neuer Tarifstand darf nicht rückwirkend gelten: frühestens heute in Damaskus. */
export function validFromIssue(validFrom: string, today: string): 'FARE_VALID_FROM_PAST' | null {
  return validFrom < today ? 'FARE_VALID_FROM_PAST' : null;
}

export interface StoredFare {
  fromSeq: number;
  toSeq: number;
  amountMinor: number;
  currency: string;
  validFrom: string;
  validUntil: string | null;
}

export interface FareSet {
  validFrom: string;
  validUntil: string | null;
  currency: string;
  items: { fromSeq: number; toSeq: number; amountMinor: number }[];
}

/**
 * Fasst Tarife zu Ständen zusammen (gleicher Zeitraum und gleiche Währung), nur heute oder künftig
 * gültige, sortiert nach Beginn; Einträge je Stand nach Einstieg, dann Ausstieg.
 */
export function groupFareSets(fares: readonly StoredFare[], today: string): FareSet[] {
  const sets = new Map<string, FareSet>();
  for (const fare of fares) {
    if (fare.validUntil !== null && fare.validUntil <= today) continue;
    const id = `${fare.validFrom}|${fare.validUntil ?? ''}|${fare.currency}`;
    let set = sets.get(id);
    if (set === undefined) {
      set = {
        validFrom: fare.validFrom,
        validUntil: fare.validUntil,
        currency: fare.currency,
        items: [],
      };
      sets.set(id, set);
    }
    set.items.push({ fromSeq: fare.fromSeq, toSeq: fare.toSeq, amountMinor: fare.amountMinor });
  }
  const result = [...sets.values()].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  for (const set of result) {
    set.items.sort((a, b) => a.fromSeq - b.fromSeq || a.toSeq - b.toSeq);
  }
  return result;
}
