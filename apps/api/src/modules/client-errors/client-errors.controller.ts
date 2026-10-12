import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../auth/decorators.js';
import { type ClientErrorInput, clientErrorSchema } from './client-errors.schemas.js';
import { ClientErrorsService } from './client-errors.service.js';

@Controller('client-errors')
export class ClientErrorsController {
  constructor(private readonly clientErrors: ClientErrorsService) {}

  /**
   * Fehlerberichte aus Web und Portal. Öffentlich, weil Fehler auch vor der Anmeldung auftreten.
   * Ein gültiger Bericht ergibt immer 204, auch wenn das globale Limit ihn verwirft: Der Browser
   * braucht kein Ergebnis und wiederholt nichts.
   */
  @Public()
  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  report(@Body({ schema: clientErrorSchema }) body: ClientErrorInput): void {
    this.clientErrors.report(body);
  }
}
