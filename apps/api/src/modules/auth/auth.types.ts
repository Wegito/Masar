import type { Request } from 'express';

/** Geprüfte Identität einer Anfrage. `companyId` kommt nie von hier, sondern aus der Mitgliedschaft. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  isPlatformAdmin: boolean;
}

export type AuthedRequest = Request & { auth?: AuthContext };
