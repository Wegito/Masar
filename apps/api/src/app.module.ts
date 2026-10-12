import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { validationFailed } from './common/app-error.js';
import { ClockModule } from './common/clock.js';
import { CsrfGuard } from './common/csrf.guard.js';
import { loggerParams } from './common/logging.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { type Env, validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { AuditModule } from './modules/audit/audit.service.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CompanyRoleGuard } from './modules/auth/company-role.guard.js';
import { SessionGuard } from './modules/auth/session.guard.js';
import { ClientErrorsModule } from './modules/client-errors/client-errors.module.js';
import { CompaniesModule } from './modules/companies/companies.module.js';
import { MailModule } from './modules/mail/smtp.mailer.js';
import { PrismaModule } from './prisma/prisma.module.js';

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
    // Grundlimit je IP; strengere Limits setzen einzelne Routen (Login, Passwort-Reset).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    ClockModule,
    PrismaModule,
    AuditModule,
    MailModule,
    HealthModule,
    AuthModule,
    CompaniesModule,
    ClientErrorsModule,
  ],
  providers: [
    // Reihenfolge der Guards: Ratenbegrenzung, CSRF, Sitzung, Firmenrolle.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CompanyRoleGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    {
      provide: APP_PIPE,
      useFactory: () => new StandardSchemaValidationPipe({ exceptionFactory: validationFailed }),
    },
  ],
})
export class AppModule {}
