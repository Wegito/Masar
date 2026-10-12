/** Fehlversuche, die ohne Verzögerung erlaubt sind. */
export const FREE_LOGIN_ATTEMPTS = 5;
/** Obergrenze der Sperre; danach bleibt es bei dieser Dauer je weiterem Fehlversuch. */
export const MAX_LOCK_MS = 15 * 60 * 1000;

/**
 * Progressive Verzögerung statt harter Sperre (ADR 0009): ab dem fünften Fehlversuch 1 Minute,
 * dann je Fehlversuch doppelt so lang, höchstens 15 Minuten. Eine harte Sperre ließe sich
 * missbrauchen, um Personal gezielt auszusperren.
 */
export function lockDurationMs(failedLogins: number): number {
  if (failedLogins < FREE_LOGIN_ATTEMPTS) {
    return 0;
  }
  return Math.min(60_000 * 2 ** (failedLogins - FREE_LOGIN_ATTEMPTS), MAX_LOCK_MS);
}
