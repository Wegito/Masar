'use client';

import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

/**
 * Token aus dem URL-Fragment (#token=...). Das Fragment geht nie an einen Server, also auch nicht
 * in Logs oder den Referer (ADR 0009). `null`, solange es fehlt.
 */
export function useHashToken(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.hash.slice(1)).get('token'),
    () => null,
  );
}
