import { Module } from '@nestjs/common';

import { BookingExpiryJob } from './booking-expiry.job.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsRepository } from './bookings.repository.js';
import { BookingsService } from './bookings.service.js';
import { CompanyBookingsController } from './company-bookings.controller.js';
import { CompanyBookingsRepository } from './company-bookings.repository.js';
import { CompanyBookingsService } from './company-bookings.service.js';
import { GuestKeys } from './guest-keys.js';
import { LookupLimiter } from './lookup-limiter.js';
import { NationalIdCipher } from './national-id.cipher.js';
import { TripPassengersController } from './trip-passengers.controller.js';

@Module({
  controllers: [BookingsController, CompanyBookingsController, TripPassengersController],
  providers: [
    BookingsService,
    BookingsRepository,
    CompanyBookingsService,
    CompanyBookingsRepository,
    NationalIdCipher,
    GuestKeys,
    LookupLimiter,
    BookingExpiryJob,
  ],
  exports: [BookingsService, BookingExpiryJob],
})
export class BookingsModule {}
