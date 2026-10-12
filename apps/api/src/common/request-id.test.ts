import { describe, expect, it } from 'vitest';

import { resolveRequestId } from './request-id.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('Request-ID', () => {
  it('übernimmt eine mitgeschickte UUID in Kleinbuchstaben', () => {
    expect(resolveRequestId('0199F7A4-5C2E-7D3A-9B1E-2F4C6A8D0E12')).toBe(
      '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12',
    );
  });

  it.each([[undefined], [''], ['abc'], ['x\n{"level":60}'], [['a', 'b']]])(
    'ersetzt %j durch eine neue UUIDv7',
    (incoming) => {
      expect(resolveRequestId(incoming)).toMatch(UUID_V7);
    },
  );
});
