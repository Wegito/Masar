import { Controller, Get, Header, Module } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { Public } from '../auth/decorators.js';

/**
 * Städte für das Suchformular. Öffentlich, weil die Suche ohne Konto funktioniert. Nur Städte mit
 * mindestens einer Haltestelle, damit das Formular keine leeren Ziele anbietet.
 */
@Controller('cities')
export class CitiesController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  async list() {
    const cities = await this.prisma.city.findMany({
      where: { stations: { some: {} } },
      orderBy: { nameEn: 'asc' },
      select: { slug: true, nameAr: true, nameEn: true },
    });
    return { cities };
  }
}

@Module({ controllers: [CitiesController] })
export class CatalogModule {}
