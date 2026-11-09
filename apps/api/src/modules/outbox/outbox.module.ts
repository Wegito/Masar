import { Global, Module } from '@nestjs/common';

import { BookingMailHandler } from './booking-mail.handler.js';
import { OutboxService } from './outbox.service.js';
import { OutboxWorker } from './outbox.worker.js';

/** Transaktionaler Ausgang: Schreiben in der Fachtransaktion, Zustellung im Worker (ADR 0021). */
@Global()
@Module({
  providers: [OutboxService, OutboxWorker, BookingMailHandler],
  exports: [OutboxService, OutboxWorker],
})
export class OutboxModule {}
