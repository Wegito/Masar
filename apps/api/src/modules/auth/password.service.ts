import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id mit 64 MiB Speicher, 3 Durchläufen, Parallelität 1 (ADR 0009). Argon2id ist der
 * Standard der Bibliothek; ein Test prüft das am erzeugten Hash.
 */
const ARGON2_OPTIONS = { memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

/** NIST SP 800-63B: Unicode-Passwörter vor dem Hashen normalisieren (z. B. arabische Zeichenformen). */
function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

@Injectable()
export class PasswordService {
  /** Hash eines Wegwerf-Passworts, damit auch unbekannte E-Mail-Adressen gleich lange brauchen. */
  private readonly dummyHash: Promise<string> = hash('masar-timing-ausgleich', ARGON2_OPTIONS);

  hash(password: string): Promise<string> {
    return hash(normalizePassword(password), ARGON2_OPTIONS);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, normalizePassword(password));
  }

  /** Gleicher Rechenaufwand wie eine echte Prüfung; das Ergebnis ist immer „falsch“. */
  async verifyDummy(password: string): Promise<false> {
    await verify(await this.dummyHash, normalizePassword(password));
    return false;
  }
}
