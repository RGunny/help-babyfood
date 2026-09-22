import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApplicationModule } from '../application/application.module.js';
import type { AppEnv } from '../config/env.js';
import { PersistenceModule } from '../infrastructure/prisma/persistence.module.js';
import { APP_ENV } from '../infrastructure/prisma/prisma.service.js';
import { BriefDispatchJob } from './brief-dispatch.job.js';
import { ReconcileJob } from './reconcile.job.js';

/**
 * The periodic jobs. Like `src/mcp`, this is an adapter layer: it calls the application services
 * and knows nothing about stock or dates.
 *
 * `forRoot` is called here and nowhere else — importing it twice would register every job twice.
 * The options are built from the environment so that a process can boot without the sweep:
 * `cronJobs: false` makes the explorer skip the `@Cron` methods rather than register a job that
 * then has to check a flag on every tick. Only `cronJobs` is set, so an `@Interval` or `@Timeout`
 * added later would not register until this says so.
 */
@Module({
  imports: [
    ApplicationModule,
    ScheduleModule.forRootAsync({
      imports: [PersistenceModule],
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => ({ cronJobs: env.schedulerEnabled }),
    }),
  ],
  providers: [ReconcileJob, BriefDispatchJob],
})
export class SchedulerModule {}
