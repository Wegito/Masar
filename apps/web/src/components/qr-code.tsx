import type { ReactNode } from 'react';

import type { QrGeometry } from '../lib/qr';

/**
 * Zeichnet einen QR-Code aus der Geometrie, die der Web-Server erzeugt hat. Schwarz auf Weiß mit
 * Ruhezone, scharfe Kanten, auch im Druck; Farben als SVG-Attribute statt Inline-Styles (CSP).
 */
export function QrCode({ qr, label }: { qr: QrGeometry; label: string }): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${String(qr.size)} ${String(qr.size)}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="block size-60 max-w-full rounded-lg border border-slate-200 print:size-64 print:border-0"
    >
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={qr.path} fill="#000000" />
    </svg>
  );
}
