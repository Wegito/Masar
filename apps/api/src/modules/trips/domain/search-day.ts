import { isValidCalendarDate, SYRIA_TIME_ZONE } from '@masar/shared';

/**
 * Suchtag als halboffenes UTC-Intervall (ADR 0012). Reine Funktionen ohne Ein- und Ausgabe.
 *
 * Der Versatz zu UTC kommt immer aus der IANA-Zone `Asia/Damascus`, nie aus einer Konstante. Ändert
 * Syrien die Zeitregel wieder, genügt ein tzdata-Update.
 */

export interface UtcRange {
  /** Erster Zeitpunkt des Tages (einschließlich). */
  start: Date;
  /** Erster Zeitpunkt des Folgetages (ausschließlich). */
  end: Date;
}

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SYRIA_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Versatz der Zone gegenüber UTC in Millisekunden zu einem Zeitpunkt (positiv östlich von UTC). */
function zoneOffsetMs(instant: number): number {
  const parts = offsetFormatter.formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Mitternacht eines Kalendertags in Damaskus als UTC-Zeitpunkt. */
function damascusMidnight(year: number, month: number, day: number): Date {
  const naive = Date.UTC(year, month - 1, day);
  // Zweimal angleichen, damit auch ein Zonenwechsel zwischen Schätzung und Ergebnis stimmt.
  let result = naive - zoneOffsetMs(naive);
  result = naive - zoneOffsetMs(result);
  return new Date(result);
}

/**
 * Der Kalendertag `YYYY-MM-DD` in Damaskus als `[start, end)` in UTC. Wirft bei einem ungültigen
 * Tag; die Eingabeprüfung im Controller lässt solche Werte gar nicht erst durch.
 */
export function damascusDayRange(date: string): UtcRange {
  if (!isValidCalendarDate(date)) {
    throw new RangeError(`Ungültiger Kalendertag: ${date}`);
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { start: damascusMidnight(year, month, day), end: damascusMidnight(year, month, day + 1) };
}
