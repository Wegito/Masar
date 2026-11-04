import { Module } from '@nestjs/common';

import { LicensesModule } from '../licenses/licenses.module.js';
import { BusesController } from './buses.controller.js';
import { BusesService } from './buses.service.js';
import { FleetRepository } from './fleet.repository.js';
import { SeatLayoutsController } from './seat-layouts.controller.js';
import { SeatLayoutsService } from './seat-layouts.service.js';

/** Flotte einer Firma: Sitzpläne und Busse (Schritt 2.2, ADR 0024). */
@Module({
  imports: [LicensesModule],
  controllers: [SeatLayoutsController, BusesController],
  providers: [SeatLayoutsService, BusesService, FleetRepository],
})
export class FleetModule {}
