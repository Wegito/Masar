import { Module } from '@nestjs/common';

import { BookingExpiryJob } from './booking-expiry.job.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsRepository } from './bookings.repository.js';
import { BookingsService } from './bookings.service.js';
import { CompanyBookingsController } from './company-bookings.controller.js';
import { NationalIdCipher } from './national-id.cipher.js';

@Module({
  controllers: [BookingsController, CompanyBookingsController],
  providers: [BookingsService, BookingsRepository, NationalIdCipher, BookingExpiryJob],
  exports: [BookingsService, BookingExpiryJob],
})
export class BookingsModule {}
