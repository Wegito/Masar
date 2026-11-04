/**
 * Fahrtplanung (Schritt 2.4, ADR 0027). API und Portal prüfen dieselben Grenzen.
 */

export const TRIP_SCHEDULE_LIMITS = {
  /** Höchstens so viele Kalendertage je Wochenplan (wie `expandSchedule`). */
  maxDays: 62,
  /** Fahrzeit vom ersten bis zum letzten Halt in Minuten (wie `expandSchedule`). */
  minDurationMinutes: 1,
  maxDurationMinutes: 2_880,
  /** Online-Verkaufsschluss vor der Abfahrt in Minuten (höchstens ein Tag). */
  maxSalesCloseMinutes: 1_440,
  /** Höchstens so viele Sitze im Online-Kontingent (größer als jeder Sitzplan des Generators). */
  maxOnlineSeats: 200,
} as const;

/**
 * Wochentage wie `Date.getUTCDay()`: 0 = Sonntag bis 6 = Samstag. Die Oberfläche zeigt sie ab
 * Samstag, wie der Kalender in Syrien.
 */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Anzeige-Reihenfolge der Wochentage im Portal: Samstag zuerst. */
export const WEEKDAYS_FROM_SATURDAY: readonly Weekday[] = [6, 0, 1, 2, 3, 4, 5];

/** Uhrzeit `HH:MM` im 24-Stunden-Format (Ortszeit Damaskus). */
export const DEPARTURE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Ergebnis je Termin in Vorschau und Veröffentlichung. */
export const SCHEDULE_ITEM_STATES = ['NEW', 'EXISTS', 'BUS_CONFLICT'] as const;
export type ScheduleItemState = (typeof SCHEDULE_ITEM_STATES)[number];
