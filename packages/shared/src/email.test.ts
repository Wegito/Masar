import { describe, expect, it } from 'vitest';

import { normalizeEmail } from './email.js';

describe('E-Mail-Normalisierung', () => {
  it.each([
    ['Rana.Haddad@Example.COM', 'rana.haddad@example.com'],
    ['  staff@masar.example  ', 'staff@masar.example'],
    ['\tADMIN@MASAR.EXAMPLE\n', 'admin@masar.example'],
  ])('%j wird zu %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it('ist idempotent', () => {
    const once = normalizeEmail(' A@B.Example ');
    expect(normalizeEmail(once)).toBe(once);
  });
});
