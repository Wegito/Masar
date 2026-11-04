/**
 * Tarifmatrix einer Strecke (Schritt 2.3, ADR 0026). Reine Funktionen ohne Ein- und Ausgabe.
 *
 * Eine Strecke mit n Halten hat n·(n−1)/2 Teilstrecken in Fahrtrichtung: von Halt i nach Halt j
 * mit i < j (Positionen `seq` ab 0). Jede Teilstrecke braucht genau einen Preis, sonst ist sie
 * nicht buchbar (`NO_FARE_FOR_SEGMENT`) — die Matrix ist deshalb immer vollständig.
 *
 * Zusätzlich gilt: Eine Teilstrecke kostet nie weniger als eine in ihr enthaltene. Sonst wäre das
 * längere Ticket billiger, Fahrgäste kauften es für die kürzere Fahrt und blockierten den Sitz
 * auf Abschnitten, die sie gar nicht fahren. Gleich teuer ist erlaubt (Einheitspreis).
 */

export interface FareItem {
  fromSeq: number;
  toSeq: number;
  amountMinor: number;
}

export type FarePair = [number, number];

export type FareMatrixIssue =
  /** Paar außerhalb der Strecke, gegen die Fahrtrichtung, doppelt oder mit ungültigem Betrag. */
  | { code: 'FARE_MATRIX_INVALID'; pairs: FarePair[] }
  /** Es fehlen Preise für Teilstrecken. */
  | { code: 'FARE_MATRIX_INCOMPLETE'; missing: FarePair[] }
  /** `pair` ist billiger als die enthaltene Teilstrecke `contained`. */
  | { code: 'FARE_NOT_MONOTONIC'; pair: FarePair; contained: FarePair };

/** Alle Teilstrecken in Fahrtrichtung, sortiert nach Einstieg, dann Ausstieg. */
export function farePairs(stopCount: number): FarePair[] {
  const pairs: FarePair[] = [];
  for (let from = 0; from < stopCount; from += 1) {
    for (let to = from + 1; to < stopCount; to += 1) {
      pairs.push([from, to]);
    }
  }
  return pairs;
}

function key(from: number, to: number): string {
  return `${from}-${to}`;
}

/**
 * Prüft eine Tarifmatrix für eine Strecke mit `stopCount` Halten. Liefert das erste gefundene
 * Problem (in der Reihenfolge ungültig, unvollständig, nicht monoton) oder `null`.
 */
export function fareMatrixIssue(
  stopCount: number,
  items: readonly FareItem[],
): FareMatrixIssue | null {
  const amounts = new Map<string, number>();
  const invalid: FarePair[] = [];
  for (const item of items) {
    const { fromSeq, toSeq, amountMinor } = item;
    const inRange =
      Number.isInteger(fromSeq) &&
      Number.isInteger(toSeq) &&
      fromSeq >= 0 &&
      toSeq < stopCount &&
      fromSeq < toSeq;
    const validAmount = Number.isSafeInteger(amountMinor) && amountMinor > 0;
    if (!inRange || !validAmount || amounts.has(key(fromSeq, toSeq))) {
      invalid.push([fromSeq, toSeq]);
      continue;
    }
    amounts.set(key(fromSeq, toSeq), amountMinor);
  }
  if (invalid.length > 0) {
    return { code: 'FARE_MATRIX_INVALID', pairs: invalid };
  }

  const missing = farePairs(stopCount).filter(([from, to]) => !amounts.has(key(from, to)));
  if (missing.length > 0) {
    return { code: 'FARE_MATRIX_INCOMPLETE', missing };
  }

  // Monotonie: Es genügt, jede Teilstrecke mit den beiden um einen Halt kürzeren zu vergleichen;
  // über die Kette folgt die Regel für jede enthaltene Teilstrecke.
  for (const [from, to] of farePairs(stopCount)) {
    if (to - from < 2) continue;
    const amount = amounts.get(key(from, to)) ?? 0;
    for (const contained of [
      [from + 1, to],
      [from, to - 1],
    ] satisfies FarePair[]) {
      if ((amounts.get(key(contained[0], contained[1])) ?? 0) > amount) {
        return { code: 'FARE_NOT_MONOTONIC', pair: [from, to], contained };
      }
    }
  }
  return null;
}
