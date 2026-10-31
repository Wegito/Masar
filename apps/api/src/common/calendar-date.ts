/**
 * Kalendertage (`YYYY-MM-DD`) und PostgreSQL-Spalten vom Typ `date`.
 *
 * Prisma bildet `date` auf ein `Date` um Mitternacht UTC ab. Die Umrechnung steht nur hier, damit
 * niemand versehentlich einen Kalendertag über die lokale Zeitzone des Servers verschiebt.
 */
export function toDbDate(calendarDate: string): Date {
  const date = new Date(`${calendarDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== calendarDate) {
    throw new RangeError(`Ungültiger Kalendertag: ${calendarDate}`);
  }
  return date;
}

export function fromDbDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
