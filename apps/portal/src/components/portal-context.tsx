'use client';

import { createContext, type ReactNode, use } from 'react';

import type { UserSummary } from '../lib/api';
import type { Membership } from '../lib/company';

export interface PortalContextValue {
  user: UserSummary;
  /** Gewählte Firma; `null`, wenn die Person keiner Firma angehört. */
  company: Membership | null;
}

const PortalContext = createContext<PortalContextValue | null>(null);

/**
 * Sitzung und gewählte Firma für Client-Komponenten im angemeldeten Bereich. Das Layout
 * `(app)/layout.tsx` prüft beides auf dem Server und reicht es hier herein (ADR 0025).
 */
export function PortalProvider({
  value,
  children,
}: {
  value: PortalContextValue;
  children: ReactNode;
}): ReactNode {
  return <PortalContext value={value}>{children}</PortalContext>;
}

/** Sitzung und Firma; nur unterhalb von `(app)/layout.tsx` aufrufen. */
export function usePortal(): PortalContextValue {
  const value = use(PortalContext);
  if (value === null) {
    throw new Error('usePortal außerhalb des angemeldeten Bereichs');
  }
  return value;
}

/**
 * Gewählte Firma für Seiten, die eine brauchen (etwa Flotte oder Buchungen). Die ID geht nur in
 * den Pfad der API (`/companies/:companyId/...`); die API prüft die Mitgliedschaft selbst.
 */
export function useCompany(): Membership | null {
  return usePortal().company;
}
