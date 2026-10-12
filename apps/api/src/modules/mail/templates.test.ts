import { describe, expect, it } from 'vitest';

import { invitationMail, passwordResetMail } from './templates.js';

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
});
