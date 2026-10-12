import { Module } from '@nestjs/common';

import { ClientErrorsController } from './client-errors.controller.js';
import { ClientErrorsService } from './client-errors.service.js';

@Module({ controllers: [ClientErrorsController], providers: [ClientErrorsService] })
export class ClientErrorsModule {}
