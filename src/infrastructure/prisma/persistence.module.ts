import { Module } from '@nestjs/common';
import { ClockPort } from '../../application/ports/clock.port.js';
import {
  CLOCK,
  FEEDING_HISTORY,
  HOUSEHOLD_DIRECTORY,
  HOUSEHOLD_READER,
  HOUSEHOLD_WRITER,
} from '../../application/ports/tokens.js';
import { AppEnv, readEnv } from '../../config/env.js';
import { SeoulClock } from '../clock.js';
import { PrismaFeedingHistoryRepository } from './feeding-history.repository.js';
import { PrismaHouseholdDirectory } from './household-directory.repository.js';
import { PrismaHouseholdStateRepository } from './household-state.repository.js';
import { PrismaHouseholdWriter } from './household-writer.js';
import { APP_ENV, PrismaService } from './prisma.service.js';

/**
 * Binds the ports to their Prisma implementations. `PrismaHouseholdWriter` is both the writer and
 * the reader, so the reader token points at the same instance: one client, one pool.
 */
@Module({
  providers: [
    { provide: APP_ENV, useFactory: (): AppEnv => readEnv() },
    PrismaService,
    { provide: CLOCK, useFactory: (): ClockPort => new SeoulClock() },
    {
      provide: HOUSEHOLD_WRITER,
      useFactory: (prisma: PrismaService, env: AppEnv, clock: ClockPort) =>
        new PrismaHouseholdWriter(prisma, new PrismaHouseholdStateRepository(env.lookbackDays), clock),
      inject: [PrismaService, APP_ENV, CLOCK],
    },
    { provide: HOUSEHOLD_READER, useExisting: HOUSEHOLD_WRITER },
    {
      provide: FEEDING_HISTORY,
      useFactory: (prisma: PrismaService) => new PrismaFeedingHistoryRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: HOUSEHOLD_DIRECTORY,
      useFactory: (prisma: PrismaService) => new PrismaHouseholdDirectory(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [
    APP_ENV,
    PrismaService,
    CLOCK,
    HOUSEHOLD_WRITER,
    HOUSEHOLD_READER,
    FEEDING_HISTORY,
    HOUSEHOLD_DIRECTORY,
  ],
})
export class PersistenceModule {}
