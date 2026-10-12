/** Statisches Routensegment: Kleinbuchstaben, Wörter durch Bindestriche getrennt. */
const STATIC_SEGMENT = /^[a-z]+(?:-[a-z]+)*$/;
const MAX_SEGMENT_LENGTH = 40;
const MAX_SEGMENTS = 12;

/**
 * Seitenpfad für Fehlerberichte und Logs, ohne Werte, die Personen oder Buchungen erkennbar
 * machen. Nur statische Routensegmente bleiben stehen (`ar`, `auth`, `forgot-password`); alles
 * andere wird zu `:param`, etwa Buchungscodes, UUIDs, Ziffern oder kodierte Namen. Query und
 * Fragment fallen weg, dort stehen Suchparameter und Tokens.
 *
 * Grenze: Ein Wert aus reinen Kleinbuchstaben (z. B. ein klein getippter Buchungscode ohne
 * Ziffern) sieht aus wie ein Routensegment und bleibt stehen.
 */
export function sanitizePath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] ?? '';
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const kept = segments
    .slice(0, MAX_SEGMENTS)
    .map((segment) =>
      segment.length <= MAX_SEGMENT_LENGTH && STATIC_SEGMENT.test(segment) ? segment : ':param',
    );
  const suffix = segments.length > MAX_SEGMENTS ? '/...' : '';
  return `/${kept.join('/')}${suffix}`;
}
