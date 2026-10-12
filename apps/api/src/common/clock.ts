import { Global, Injectable, Module } from '@nestjs/common';

/** Zeitquelle. Fristen hängen nie an `new Date()` im Fachcode, damit Tests die Zeit steuern können. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
