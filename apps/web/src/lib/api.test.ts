import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Eingehende Anfrage wie hinter Caddy: der Client setzt einen Eintrag, Caddy hängt die echte IP an.
const incomingHeaders = new Headers({ 'x-forwarded-for': '198.51.100.7, 203.0.113.1' });

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(incomingHeaders),
}));

const { apiGet } = await import('./api');

const fetchMock = vi.fn<typeof fetch>();

/** Header des einzigen fetch-Aufrufs als Objekt. */
function sentHeaders(): Record<string, string> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]?.[1];
  return (init?.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  fetchMock.mockResolvedValue(Response.json({ items: [] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('apiGet und die Client-IP', () => {
  it('sendet bei zwischengespeicherten Abrufen kein X-Forwarded-For (Cache nicht je IP)', async () => {
    await apiGet('/cities', {}, { revalidate: 300 });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toMatchObject({ next: { revalidate: 300 } });
    expect(Object.keys(sentHeaders()).map((name) => name.toLowerCase())).not.toContain(
      'x-forwarded-for',
    );
  });

  it('gibt ohne revalidate genau die geprüfte Client-IP weiter', async () => {
    await apiGet('/trips/search', { from: 'a' });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toMatchObject({ cache: 'no-store' });
    expect(sentHeaders()['X-Forwarded-For']).toBe('203.0.113.1');
  });
});
