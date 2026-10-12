import { Writable } from 'node:stream';

import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { pinoHttpOptions } from '../src/common/logging.js';

const PHONE_DIGITS = '963933123456';

@Controller('__test')
class LeakyController {
  @Post('booking')
  booking(
    @Body({ schema: z.object({ contactPhone: z.string() }) }) body: { contactPhone: string },
  ) {
    return { ok: body.contactPhone.length > 0 };
  }

  @Get('failure')
  failure(): never {
    throw new Error(`Buchung für +${PHONE_DIGITS} fehlgeschlagen`);
  }
}

/**
 * Prüft die echte Log-Ausgabe der Anwendung: Weder Body noch Query noch Fehlermeldung dürfen eine
 * Telefonnummer ins Log bringen. Die Ausgabe wird in einen Puffer umgeleitet.
 */
describe('Log-Ausgabe enthält keine Telefonnummern (Ende zu Ende)', () => {
  let app: NestExpressApplication;
  const lines: string[] = [];

  beforeAll(async () => {
    const capture = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [LeakyController],
    })
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue({ pinoHttp: [pinoHttpOptions({ LOG_LEVEL: 'info', LOG_FORMAT: 'json' }), capture] })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();

    const http = request(app.getHttpServer());
    await http.post('/api/v1/__test/booking').send({ contactPhone: `+${PHONE_DIGITS}` });
    await http.get(`/api/v1/__test/booking?phone=%2B${PHONE_DIGITS}`);
    await http.get('/api/v1/__test/failure');
  });

  afterAll(async () => {
    await app.close();
  });

  it('hat überhaupt geloggt (sonst wäre der Test wertlos)', () => {
    const text = lines.join('');
    expect(text).toContain('request completed');
    expect(text).toContain('Anfrage mit Serverfehler beendet');
  });

  it('enthält die Telefonnummer an keiner Stelle', () => {
    expect(lines.join('')).not.toContain(PHONE_DIGITS);
  });
});
