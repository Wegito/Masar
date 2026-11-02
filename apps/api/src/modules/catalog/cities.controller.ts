import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/decorators.js';
import type { CityView } from './cities.repository.js';
import { CitiesService } from './cities.service.js';

@Controller('cities')
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  /**
   * Städte mit Haltestellen für die Suchmaske. Öffentlich, weil Gäste ohne Konto suchen (ADR 0009);
   * enthält nur Katalogdaten. Die Liste ist klein und wächst langsam, deshalb ohne Paginierung. Es
   * gilt das Grundlimit von 120 je Minute und IP.
   */
  @Public()
  @Get()
  list(): Promise<{ items: CityView[] }> {
    return this.cities.list();
  }
}
