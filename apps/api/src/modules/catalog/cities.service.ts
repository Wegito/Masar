import { Injectable } from '@nestjs/common';

import { type CityView, CitiesRepository } from './cities.repository.js';

@Injectable()
export class CitiesService {
  constructor(private readonly cities: CitiesRepository) {}

  async list(): Promise<{ items: CityView[] }> {
    return { items: await this.cities.findServed() };
  }
}
