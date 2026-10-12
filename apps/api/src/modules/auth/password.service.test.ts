import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service.js';

const passwords = new PasswordService();

describe('Passwort-Hashing', () => {
  it('nutzt Argon2id mit 64 MiB, 3 Durchläufen und Parallelität 1', async () => {
    const hash = await passwords.hash('richtig-langes-passwort');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  });

  it('erkennt richtige und falsche Passwörter', async () => {
    const hash = await passwords.hash('richtig-langes-passwort');
    await expect(passwords.verify(hash, 'richtig-langes-passwort')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'falsches-langes-passwort')).resolves.toBe(false);
  });

  it('normalisiert Unicode, damit gleich aussehende Eingaben gleich gelten', async () => {
    // "ﬁ" (Ligatur, U+FB01) und "fi" sind nach NFKC gleich.
    const hash = await passwords.hash('ﬁrmen-passwort-12');
    await expect(passwords.verify(hash, 'firmen-passwort-12')).resolves.toBe(true);
  });

  it('prüft zum Schein, ohne je zu bestätigen', async () => {
    await expect(passwords.verifyDummy('irgendetwas')).resolves.toBe(false);
  });
});
