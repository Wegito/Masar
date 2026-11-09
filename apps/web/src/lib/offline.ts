/**
 * Offline-Vorrat der Ticketseite im Browser (Schritt 1.4, ADR 0022). Nur im Client aufrufen.
 * Derselbe Cache-Name wie in public/sw.js.
 */
const CACHE = 'masar-ticket-v1';

/**
 * Registriert den Service Worker und legt die aktuelle Seite (ohne Fragment) samt ihrer
 * statischen Dateien in den Cache. Beim ersten Besuch steht der Worker noch nicht zwischen Seite
 * und Netz; deshalb füllt die Seite den Cache selbst. Gibt `false` zurück, wenn der Browser das
 * nicht kann (dann bleibt nur die Kopie im localStorage, solange die Seite offen ist).
 */
export async function prepareOffline(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) {
    return false;
  }
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const urls = new Set<string>([window.location.pathname]);
  for (const entry of performance.getEntriesByType('resource')) {
    const url = new URL(entry.name);
    if (url.origin === window.location.origin && url.pathname.startsWith('/_next/static/')) {
      urls.add(url.pathname + url.search);
    }
  }
  const cache = await caches.open(CACHE);
  await cache.addAll([...urls]);
  return true;
}

/** Entfernt die gespeicherte Seite (die Daten im localStorage löscht der Aufrufer). */
export async function forgetOffline(path: string): Promise<void> {
  if ('caches' in window) {
    const cache = await caches.open(CACHE);
    await cache.delete(path);
  }
}
