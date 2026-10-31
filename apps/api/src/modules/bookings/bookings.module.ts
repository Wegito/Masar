import { Module } from '@nestjs/common';

import { BookingsController, CompanyBookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

@Module({
  controllers: [BookingsController, CompanyBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
