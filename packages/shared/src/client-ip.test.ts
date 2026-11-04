import { isIP } from 'node:net';

import { describe, expect, it } from 'vitest';

import { forwardedClientIp, parseIp } from './client-ip.js';

describe('Client-IP aus X-Forwarded-For', () => {
  it('nimmt eine einzelne IPv4 unverändert', () => {
    expect(forwardedClientIp('203.0.113.7')).toBe('203.0.113.7');
    expect(forwardedClientIp('  203.0.113.7  ')).toBe('203.0.113.7');
  });

  it('nimmt bei mehreren Einträgen nur den letzten (vom Proxy gesetzten)', () => {
    // Ein Client schickt selbst einen Header, ein anhängender Proxy setzt die echte IP ans Ende.
    expect(forwardedClientIp('1.2.3.4, 203.0.113.7')).toBe('203.0.113.7');
    expect(forwardedClientIp('10.0.0.1,198.51.100.2,203.0.113.7')).toBe('203.0.113.7');
  });

  it('lässt den Header weg, wenn der letzte Eintrag keine IP ist', () => {
    // Eine gültige IP weiter vorn rettet einen ungültigen letzten Eintrag nicht.
    expect(forwardedClientIp('203.0.113.7, unknown')).toBeNull();
    expect(forwardedClientIp('203.0.113.7,')).toBeNull();
    expect(forwardedClientIp('')).toBeNull();
    expect(forwardedClientIp(null)).toBeNull();
    expect(forwardedClientIp(undefined)).toBeNull();
  });

  it('lehnt Müll, Ports, Präfixe und kaputte IPv4 ab', () => {
    for (const value of [
      'garbage',
      '<script>',
      '203.0.113.7:443',
      '203.0.113.0/24',
      '256.1.1.1',
      '1.2.3',
      '1.2.3.4.5',
      '01.2.3.4',
      '1.2.3.4 5.6.7.8',
      ' ',
      'for=203.0.113.7',
      '[2001:db8::1]',
      '[2001:db8::1]:443',
      'fe80::1%eth0',
      '2001:db8::1::2',
      '12345::1',
      ':::',
      'g::1',
      '1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7:8:9',
      '1:2:3:4::5:6:7:8',
      '1.2.3.4::',
      '::1.2.3.4:1',
      '::256.1.1.1',
      '1:',
      ':1',
      '1:::2',
    ]) {
      expect(forwardedClientIp(value), value).toBeNull();
    }
  });

  it('nimmt IPv6 und schreibt sie kanonisch', () => {
    expect(forwardedClientIp('2001:db8::1')).toBe('2001:db8::1');
    expect(forwardedClientIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(forwardedClientIp('::1')).toBe('::1');
    expect(forwardedClientIp('1.2.3.4, 2001:db8::7')).toBe('2001:db8::7');
    expect(forwardedClientIp('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7');
    expect(forwardedClientIp('::FFFF:CB00:7107')).toBe('::ffff:203.0.113.7');
    expect(forwardedClientIp('64:ff9b::203.0.113.7')).toBe('64:ff9b::cb00:7107');
    expect(forwardedClientIp('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1');
    expect(forwardedClientIp('1:2:3:4:5:6:7:8')).toBe('1:2:3:4:5:6:7:8');
    expect(forwardedClientIp('1::')).toBe('1::');
    expect(forwardedClientIp('::')).toBe('::');
  });

  it('stimmt mit der Prüfung von Node überein (node:net)', () => {
    const groups = ['0', '1', 'ffff', 'db8', '', '1.2.3.4', '256.0.0.1', 'g'];
    const candidates = new Set<string>();
    for (const a of groups) {
      for (const b of groups) {
        for (const c of groups) {
          for (const sep of [':', '::']) {
            candidates.add(`${a}:${b}${sep}${c}`);
            candidates.add(`${a}${sep}${b}:${c}:1:2:3:4:5`);
            candidates.add(`${a}:${b}:${c}:1:2:3${sep}4`);
          }
        }
      }
    }
    for (const value of candidates) {
      const expected = isIP(value) === 0 ? null : 'IP';
      expect(parseIp(value) === null ? null : 'IP', value).toBe(expected);
    }
    expect(candidates.size).toBeGreaterThan(1000);
  });

  it('zerlegt überlange Header nicht', () => {
    const forged = `${'1.1.1.1, '.repeat(200)}203.0.113.7`;
    expect(forwardedClientIp(forged)).toBeNull();
    expect(parseIp('1'.repeat(46))).toBeNull();
  });
});
