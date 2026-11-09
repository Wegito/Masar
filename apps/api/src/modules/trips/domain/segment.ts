/**
 * Teilstrecken einer Fahrt (ADR 0005). Reine Funktionen ohne Ein- und Ausgabe.
 *
 * Eine Teilstrecke ist das halboffene Intervall `[fromSeq, toSeq)` über die Positionen der
 * Fahrthalte: `[0,2)` und `[2,4)` überlappen nicht, `[0,3)` und `[2,4)` schon.
 */

export interface SeqRange {
  fromSeq: number;
  toSeq: number;
}

export interface StopRef {
  id: string;
  seq: number;
}

export type SegmentResolution<T extends StopRef> =
  { ok: true; from: T; to: T; range: SeqRange } | { ok: false };

/**
 * Löst Einstiegs- und Ausstiegshalt zu einer Teilstrecke auf. Scheitert, wenn ein Halt nicht zur
 * Fahrt gehört oder der Einstieg nicht vor dem Ausstieg liegt (`INVALID_SEGMENT`).
 */
export function resolveSegment<T extends StopRef>(
  stops: readonly T[],
  fromStopId: string,
  toStopId: string,
): SegmentResolution<T> {
  const from = stops.find((stop) => stop.id === fromStopId);
  const to = stops.find((stop) => stop.id === toStopId);
  if (from === undefined || to === undefined || from.seq >= to.seq) {
    return { ok: false };
  }
  return { ok: true, from, to, range: { fromSeq: from.seq, toSeq: to.seq } };
}

/** Überlappung zweier halboffener Teilstrecken; entspricht `int4range(...) && int4range(...)`. */
export function segmentsOverlap(a: SeqRange, b: SeqRange): boolean {
  return a.fromSeq < b.toSeq && b.fromSeq < a.toSeq;
}
