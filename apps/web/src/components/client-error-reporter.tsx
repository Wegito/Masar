'use client';

import { CLIENT_ERROR_LIMITS, type ClientErrorReport, sanitizePath } from '@masar/shared';
import { useEffect } from 'react';

/** Höchstens so viele Meldungen je geladener Seite, damit eine Fehlerschleife nichts flutet. */
const MAX_REPORTS_PER_PAGE = 5;

function describeReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      message: reason.message || reason.name || 'Error',
      ...(reason.stack === undefined ? {} : { stack: reason.stack }),
    };
  }
  return {
    message:
      typeof reason === 'string' && reason !== '' ? reason : `Non-Error value (${typeof reason})`,
  };
}

/**
 * Meldet unbehandelte Fehler im Browser an die eigene API (POST /api/v1/client-errors). Kein
 * Drittanbieter: Solche Dienste sind aus Syrien nicht verlässlich erreichbar, und Daten verlassen
 * so die Plattform nicht. Gesendet wird der Pfad ohne Query und Fragment (dort stehen Tokens),
 * dazu Meldung und Stacktrace; die API bereinigt alles noch einmal.
 *
 * Grenze: Fehler, die eine Error-Boundary (error.tsx) abfängt, erreichen diese Listener nicht;
 * eine solche Boundary muss selbst melden.
 */
export function ClientErrorReporter(): null {
  useEffect(() => {
    let sent = 0;

    function report(kind: ClientErrorReport['kind'], reason: unknown): void {
      if (sent >= MAX_REPORTS_PER_PAGE) {
        return;
      }
      sent += 1;
      try {
        const { message, stack } = describeReason(reason);
        const body: ClientErrorReport = {
          app: 'web',
          kind,
          message: message.slice(0, CLIENT_ERROR_LIMITS.message),
          ...(stack === undefined ? {} : { stack: stack.slice(0, CLIENT_ERROR_LIMITS.stack) }),
          path: sanitizePath(window.location.pathname).slice(0, CLIENT_ERROR_LIMITS.path),
        };
        void fetch('/api/v1/client-errors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          // Der Endpunkt ist öffentlich; das Sitzungs-Cookie muss nicht mit.
          credentials: 'omit',
          // Kommt auch an, wenn die Seite gerade verlassen wird.
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // Das Melden darf nie selbst einen Fehler auslösen.
      }
    }

    const onError = (event: ErrorEvent): void => {
      report('error', event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      report('unhandledrejection', event.reason);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
