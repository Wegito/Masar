import type { MetadataRoute } from 'next';

/** Installierbare Web-App (PWA). Offline-Fähigkeit folgt mit der Ticketseite (Schritt 1.4). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'مسار – حجز البولمان',
    short_name: 'مسار',
    description: 'احجز رحلتك بين المدن السورية من هاتفك.',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/ar',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1674f2',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
