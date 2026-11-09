import { Module } from '@nestjs/common';

import { CancellationPoliciesController, StationsController } from './route-catalog.controller.js';
import { RouteCatalogService } from './route-catalog.service.js';
import { RoutesController } from './routes.controller.js';
import { RoutesRepository } from './routes.repository.js';
import { RoutesService } from './routes.service.js';

/** Strecken, Haltestellen, Tarife je Teilstrecke und Stornoregeln (Schritt 2.3, ADR 0026). */
@Module({
  controllers: [RoutesController, StationsController, CancellationPoliciesController],
  providers: [RoutesService, RouteCatalogService, RoutesRepository],
})
export class RoutesModule {}
