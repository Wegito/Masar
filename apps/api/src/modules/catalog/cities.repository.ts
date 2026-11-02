import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';

export interface StationView {
  id: string;
  nameAr: string;
  nameEn: string;
}

export interface CityView {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  stations: StationView[];
}

/** Haltestelle an mindestens einer aktiven Route einer aktiven Firma. */
const SERVED = {
  routeStops: { some: { route: { isActive: true, company: { status: 'ACTIVE' } } } },
} as const;

@Injectable()
export class CitiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Nur bediente Städte und Haltestellen; leere Einträge helfen bei der Suche nicht. */
  findServed(): Promise<CityView[]> {
    return this.prisma.city.findMany({
      where: { stations: { some: SERVED } },
      select: {
        id: true,
        slug: true,
        nameAr: true,
        nameEn: true,
        stations: {
          where: SERVED,
          select: { id: true, nameAr: true, nameEn: true },
          orderBy: [{ nameEn: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ nameEn: 'asc' }, { id: 'asc' }],
    });
  }
}
