import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { validationFailed } from './common/app-error.js';
import { loggerParams } from './common/logging.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { type Env, validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Tests hängen nie von einer lokalen .env ab.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        loggerParams({
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
          LOG_FORMAT: config.get('LOG_FORMAT', { infer: true }),
        }),
    }),
    // Grundlimit je IP; strengere Limits setzen einzelne Routen (Login, Buchungssuche).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    {
      provide: APP_PIPE,
      useFactory: () => new StandardSchemaValidationPipe({ exceptionFactory: validationFailed }),
    },
  ],
})
export class AppModule {}
