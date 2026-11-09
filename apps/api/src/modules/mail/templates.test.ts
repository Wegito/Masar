import { describe, expect, it } from 'vitest';

import { bookingMail, invitationMail, passwordResetMail } from './templates.js';

const LINK = 'http://localhost:3002/ar/auth/accept-invitation#token=abc';

describe('E-Mail-Vorlagen', () => {
  it('lädt auf Arabisch mit Firmenname, Rolle und Link auf eigener Zeile ein', () => {
    const mail = invitationMail({
      locale: 'ar',
      companyName: 'بولمان الشام',
      role: 'AGENT',
      link: LINK,
      validHours: 72,
    });
    expect(mail.subject).toContain('بولمان الشام');
    expect(mail.text).toContain('موظف حجوزات');
    expect(mail.text.split('\n')).toContain(LINK);
  });

  it('lädt auf Englisch ein', () => {
    const mail = invitationMail({
      locale: 'en',
      companyName: 'Sham Pullman',
      role: 'ADMIN',
      link: LINK,
      validHours: 72,
    });
    expect(mail.subject).toBe('Invitation to join Sham Pullman on Masar');
    expect(mail.text).toContain('as administrator');
  });

  it('nennt beim Passwort-Reset die Gültigkeit und beruhigt bei fremder Anfrage', () => {
    const mail = passwordResetMail({ locale: 'en', link: LINK, validMinutes: 30 });
    expect(mail.text).toContain('30 minutes');
    expect(mail.text).toContain('your password stays unchanged');
  });

  it('nennt in Buchungsnachrichten Code, Sitze und bei Barzahlung die Frist', () => {
    const input = {
      companyName: 'Sham Pullman',
      bookingCode: 'ABCD-EFGH',
      departure: '10 Nov 2026, 10:00',
      route: 'Damascus – Aleppo',
      total: 'SYP 1,200',
      seats: '3A, 3B',
      deadline: '10 Nov 2026, 08:00',
    };
    const reserved = bookingMail('RESERVED', { ...input, locale: 'en' });
    expect(reserved.text).toContain('Please pay before 10 Nov 2026, 08:00');
    expect(reserved.text.split(/\n/)).toContain('ABCD-EFGH');
    for (const kind of ['RESERVED', 'CONFIRMED', 'CANCELLED'] as const) {
      for (const locale of ['ar', 'en'] as const) {
        const mail = bookingMail(kind, { ...input, locale });
        expect(mail.subject).toContain('ABCD-EFGH');
        expect(mail.text).toContain('3A, 3B');
      }
    }
    expect(bookingMail('CONFIRMED', { ...input, locale: 'ar' }).subject).toContain('تأكيد');
  });
});
