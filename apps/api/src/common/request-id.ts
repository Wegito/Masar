import { v7 as uuidv7, validate as isUuid } from 'uuid';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Übernimmt eine mitgeschickte Request-ID nur, wenn sie eine UUID ist, sonst entsteht eine neue
 * UUIDv7. Beliebige Header-Werte im Log würden Log-Injection erlauben.
 */
export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' && isUuid(incoming) ? incoming.toLowerCase() : uuidv7();
}
