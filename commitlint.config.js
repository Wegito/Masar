/**
 * Conventional Commits, Betreffzeilen auf Deutsch.
 * Beispiel: "feat(bookings): Sitzplatz-Hold mit Ablauf"
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Deutsche Betreffzeilen beginnen oft mit einem Substantiv und damit groß.
    'subject-case': [0],
  },
};
