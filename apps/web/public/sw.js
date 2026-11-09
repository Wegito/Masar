/* global self, caches */
/**
 * Service Worker der Fahrgast-App (Schritt 1.4, ADR 0022). Er hält nur die Ticketseite offline
 * lesbar: die Seite selbst (ohne Fragment, also ohne Token; die Daten liegen im localStorage) und
 * die unveränderlichen Dateien unter /_next/static. Alles andere geht unverändert ans Netz.
 * Server Actions (POST) und die API laufen nie über den Cache.
 *
 * Den Cache füllt die Ticketseite selbst nach dem Laden (src/lib/offline.ts), weil beim ersten
 * Besuch der Worker noch nicht zwischen Seite und Netz steht.
 */
const CACHE = 'masar-ticket-v1';
const TICKET_PAGE = /^\/(ar|en)\/bookings\/[0-9a-f-]{36}$/;

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('masar-ticket-') && name !== CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

/** Ticketseite: zuerst das Netz (aktueller Stand), ohne Netz die gespeicherte Seite. */
async function ticketPage(request, path) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(path, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(path)) ?? Response.error();
  }
}

/** Dateien mit Hash im Namen ändern sich nie: zuerst der Cache. */
async function staticFile(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === 'navigate' && TICKET_PAGE.test(url.pathname)) {
    event.respondWith(ticketPage(request, url.pathname));
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(staticFile(request));
  }
});
