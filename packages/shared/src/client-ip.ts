/** Längste Schreibweise einer IPv6-Adresse mit eingebetteter IPv4 (45 Zeichen). */
const MAX_IP_LENGTH = 45;
/** Längere Header sind kein Ergebnis eines ehrlichen Proxys; sie werden nicht zerlegt. */
const MAX_HEADER_LENGTH = 1024;

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
/** Vorprüfung für IPv6: nur Hexziffern, Doppelpunkte und Punkte (eingebettete IPv4). */
const IPV6_CHARS = /^[0-9a-fA-F:.]+$/;

/**
 * Client-IP aus `X-Forwarded-For` für die Weitergabe an die API (ADR 0033). Web und Portal reichen
 * nie den rohen Header weiter, sondern nur diese eine geprüfte Adresse.
 *
 * Genommen wird der letzte Eintrag der Kette: Ihn hat der vertrauenswürdige Proxy (Caddy) selbst
 * gesetzt. Alles davor kann vom Client stammen und ist fälschbar. Ist der letzte Eintrag keine
 * syntaktisch gültige IPv4- oder IPv6-Adresse (ohne Port, ohne Zonen-ID), gibt die Funktion
 * `null` zurück, und der Header entfällt. IPv6 kommt in kanonischer Kurzform zurück.
 *
 * Grenze: Die Funktion prüft nur die Form. Dass der letzte Eintrag wirklich von Caddy stammt,
 * stellt der Betrieb sicher: Web und Portal sind nur über Caddy erreichbar.
 */
export function forwardedClientIp(header: string | null | undefined): string | null {
  if (header === null || header === undefined || header.length > MAX_HEADER_LENGTH) {
    return null;
  }
  const last = header.split(',').at(-1)?.trim() ?? '';
  return parseIp(last);
}

/** Gültige IPv4 oder IPv6 (kanonisch), sonst `null`. */
export function parseIp(value: string): string | null {
  if (value.length === 0 || value.length > MAX_IP_LENGTH) {
    return null;
  }
  if (IPV4.test(value)) {
    return value;
  }
  if (!value.includes(':') || !IPV6_CHARS.test(value)) {
    return null;
  }
  const hextets = parseIpv6(value);
  return hextets === null ? null : formatIpv6(hextets);
}

const HEXTET = /^[0-9a-fA-F]{1,4}$/;

/** Acht 16-Bit-Gruppen oder `null`; erlaubt `::` einmal und eine IPv4 ganz am Ende. */
function parseIpv6(value: string): number[] | null {
  const halves = value.split('::');
  if (halves.length > 2) {
    return null;
  }
  const compressed = halves.length === 2;
  const head = splitGroups(halves[0] ?? '');
  const tail = compressed ? splitGroups(halves[1] ?? '') : [];
  // Eine eingebettete IPv4 darf nur ganz am Ende stehen, also nie direkt vor `::`.
  const end = compressed ? tail : head;
  const last = end.at(-1);
  let embedded: number[] = [];
  if (last?.includes('.') === true) {
    if (!IPV4.test(last)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = last.split('.').map(Number);
    embedded = [(a << 8) | b, (c << 8) | d];
    end.pop();
  }
  // Leere Gruppen (`1:`, `:1`) und Punkte an anderer Stelle scheitern hier.
  if (![...head, ...tail].every((group) => HEXTET.test(group))) {
    return null;
  }
  const count = head.length + tail.length + embedded.length;
  if (compressed ? count > 7 : count !== 8) {
    return null;
  }
  const numbers = (groups: string[]): number[] => groups.map((group) => Number.parseInt(group, 16));
  const zeros = new Array<number>(8 - count).fill(0);
  return [...numbers(head), ...zeros, ...numbers(tail), ...embedded];
}

function splitGroups(part: string): string[] {
  return part === '' ? [] : part.split(':');
}

/** Kanonische Kurzform nach RFC 5952; IPv4-gemappte Adressen mit Punkten am Ende. */
function formatIpv6(hextets: number[]): string {
  const mapped = hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff;
  if (mapped) {
    const [high = 0, low = 0] = hextets.slice(6);
    return `::ffff:${String(high >> 8)}.${String(high & 0xff)}.${String(low >> 8)}.${String(low & 0xff)}`;
  }
  // Längste Folge von mindestens zwei Nullgruppen; bei Gleichstand die erste.
  let bestStart = -1;
  let bestLength = 1;
  for (let start = 0; start < 8; start++) {
    let length = 0;
    while (start + length < 8 && hextets[start + length] === 0) {
      length++;
    }
    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
  }
  const hex = hextets.map((part) => part.toString(16));
  if (bestStart === -1) {
    return hex.join(':');
  }
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}
