import { Module } from '@nestjs/common';

import { CitiesController } from './cities.controller.js';
import { CitiesRepository } from './cities.repository.js';
import { CitiesService } from './cities.service.js';

@Module({ controllers: [CitiesController], providers: [CitiesService, CitiesRepository] })
export class CatalogModule {}
