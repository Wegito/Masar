/**
 * Vertrag für Fehlerberichte aus dem Browser an `POST /api/v1/client-errors`. Die Reporter in Web
 * und Portal kürzen auf diese Längen; die API lehnt Längeres ab.
 */
export const CLIENT_ERROR_LIMITS = { message: 500, stack: 4000, path: 300 } as const;

export const CLIENT_APPS = ['web', 'portal'] as const;
export type ClientApp = (typeof CLIENT_APPS)[number];

/** `error`: Ausnahme ohne Behandlung; `unhandledrejection`: abgelehntes Promise ohne catch. */
export const CLIENT_ERROR_KINDS = ['error', 'unhandledrejection'] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

export interface ClientErrorReport {
  app: ClientApp;
  kind: ClientErrorKind;
  message: string;
  stack?: string;
  /** Pfad ohne Query und Fragment, möglichst schon mit `sanitizePath` bereinigt. */
  path: string;
}
