import { isValidCalendarDate, SYRIA_TIME_ZONE } from '@masar/shared';

/**
 * Fahrtplanung anhand wiederkehrender Fahrplanregeln.
 * Reine Domain-Funktion ohne Ein- und Ausgabe (ADR 0012).
 */

export interface ScheduleRule {
  weekdays: number[];
  departureTime: string;
  durationMinutes: number;
}

export interface PlannedTrip {
  serviceDate: string;
  departureAt: Date;
  arrivalAt: Date;
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

/** Wandelt Ortsdatum und -uhrzeit in Damaskus in den UTC-Zeitpunkt um. */
function damascusToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hours: number,
  minutes: number,
): Date {
  const naiveUtc = Date.UTC(year, monthIndex, day, hours, minutes, 0, 0);
  let instant = naiveUtc - zoneOffsetMs(naiveUtc);
  instant = naiveUtc - zoneOffsetMs(instant);
  return new Date(instant);
}

/**
 * Expandiert eine Fahrplanregel über einen Datumsbereich in konkrete geplante Fahrten.
 *
 * @param rule Fahrplanregel mit Wochentagen, Abfahrtszeit und Reisedauer.
 * @param fromDate Startdatum im Format YYYY-MM-DD (inklusiv, Damaskus-Ortszeit).
 * @param toDate Enddatum im Format YYYY-MM-DD (inklusiv, Damaskus-Ortszeit).
 * @returns Geplante Einzelfahrten, chronologisch aufsteigend nach departureAt sortiert.
 */
export function expandSchedule(
  rule: ScheduleRule,
  fromDate: string,
  toDate: string,
): PlannedTrip[] {
  if (!rule.weekdays || rule.weekdays.length === 0) {
    throw new RangeError('Wochentage dürfen nicht leer sein.');
  }

  const seenWeekdays = new Set<number>();
  for (const weekday of rule.weekdays) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new RangeError(
        `Ungültiger Wochentag: ${weekday}. Erlaubt sind ganze Zahlen von 0 bis 6.`,
      );
    }
    if (seenWeekdays.has(weekday)) {
      throw new RangeError(`Doppelter Wochentag in Regel: ${weekday}.`);
    }
    seenWeekdays.add(weekday);
  }

  const timeMatch = /^(\d{2}):(\d{2})$/.exec(rule.departureTime);
  if (!timeMatch) {
    throw new RangeError(`Ungültiges Uhrzeit-Format: ${rule.departureTime}. Erwartet wird HH:MM.`);
  }

  const departureHours = Number(timeMatch[1]);
  const departureMinutes = Number(timeMatch[2]);
  if (departureHours < 0 || departureHours > 23 || departureMinutes < 0 || departureMinutes > 59) {
    throw new RangeError(`Ungültige Uhrzeit: ${rule.departureTime}.`);
  }

  if (
    !Number.isInteger(rule.durationMinutes) ||
    rule.durationMinutes < 1 ||
    rule.durationMinutes > 2880
  ) {
    throw new RangeError(
      `Ungültige Reisedauer: ${rule.durationMinutes}. Erlaubt sind ganze Zahlen von 1 bis 2880 Minuten.`,
    );
  }

  if (!isValidCalendarDate(fromDate)) {
    throw new RangeError(`Ungültiges Startdatum: ${fromDate}.`);
  }

  if (!isValidCalendarDate(toDate)) {
    throw new RangeError(`Ungültiges Enddatum: ${toDate}.`);
  }

  if (fromDate > toDate) {
    throw new RangeError(`Startdatum darf nicht nach Enddatum liegen: ${fromDate} > ${toDate}.`);
  }

  const [fromYear, fromMonth, fromDay] = fromDate.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const [toYear, toMonth, toDay] = toDate.split('-').map(Number) as [number, number, number];

  const fromUtcMidnight = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toUtcMidnight = Date.UTC(toYear, toMonth - 1, toDay);

  const dayCount = Math.round((toUtcMidnight - fromUtcMidnight) / 86_400_000) + 1;
  if (dayCount > 62) {
    throw new RangeError(`Zeitraum darf maximal 62 Tage umfassen: ${dayCount} Tage angegeben.`);
  }

  const trips: PlannedTrip[] = [];

  for (let i = 0; i < dayCount; i++) {
    const currentUtc = new Date(fromUtcMidnight + i * 86_400_000);
    const weekday = currentUtc.getUTCDay();

    if (!seenWeekdays.has(weekday)) {
      continue;
    }

    const year = currentUtc.getUTCFullYear();
    const monthIndex = currentUtc.getUTCMonth();
    const day = currentUtc.getUTCDate();

    const monthStr = String(monthIndex + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const serviceDate = `${year}-${monthStr}-${dayStr}`;
    const departureAt = damascusToUtc(year, monthIndex, day, departureHours, departureMinutes);
    const arrivalAt = new Date(departureAt.getTime() + rule.durationMinutes * 60_000);

    trips.push({
      serviceDate,
      departureAt,
      arrivalAt,
    });
  }

  trips.sort((a, b) => a.departureAt.getTime() - b.departureAt.getTime());

  return trips;
}
