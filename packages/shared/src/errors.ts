/**
 * Stabile Fehlercodes der API mit HTTP-Status.
 *
 * Ein Code wird nie umbenannt oder mit neuer Bedeutung wiederverwendet. Bedeutung und Liste:
 * docs/api-konventionen.md. Ein Test hält beide synchron.
 */
export const ERROR_HTTP_STATUS = {
  // Allgemein
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,

  // Anmeldung
  INVALID_CREDENTIALS: 401,
  LOGIN_THROTTLED: 429,
  INVITATION_INVALID: 400,
  PASSWORD_RESET_INVALID: 400,

  // Firmen und Mitglieder
  ALREADY_MEMBER: 409,

  // Fahrten und Suche
  TRIP_NOT_FOUND: 404,
  TRIP_NOT_BOOKABLE: 409,
  SALES_CLOSED: 409,
  INVALID_SEGMENT: 400,
  NO_FARE_FOR_SEGMENT: 409,

  // Buchung
  SEAT_UNKNOWN: 400,
  SEAT_TAKEN: 409,
  SEAT_NOT_ONLINE: 409,
  SEAT_BLOCKED: 409,
  GENDER_REQUIRED: 400,
  GENDER_RULE_CONFLICT: 409,
  NATIONAL_ID_REQUIRED: 400,
  TOO_MANY_SEATS: 400,
  TOO_MANY_OPEN_HOLDS: 409,
  HOLD_EXPIRED: 409,
  BOOKING_NOT_FOUND: 404,
  BOOKING_NOT_CANCELLABLE: 409,
  INVALID_STATE_TRANSITION: 409,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export const ERROR_CODES = Object.keys(ERROR_HTTP_STATUS) as readonly ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_HTTP_STATUS, value);
}

export function httpStatusOf(code: ErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}
