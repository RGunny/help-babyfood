import { Module } from '@nestjs/common';
import { BRIEF_DELIVERY } from '../../application/ports/tokens.js';
import type { AppEnv } from '../../config/env.js';
import { PersistenceModule } from '../../infrastructure/prisma/persistence.module.js';
import { APP_ENV, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SlackBriefDelivery } from './slack-brief-delivery.js';

/**
 * The Slack implementation of `BriefDeliveryPort`.
 *
 * Imports persistence only. `ApplicationModule` imports this module to get the port, so importing
 * it back would be a cycle; the interaction side, which calls the use cases, is a module of its own
 * (ADR 0006, "층별 결합").
 */
@Module({
  imports: [PersistenceModule],
  providers: [
    {
      provide: BRIEF_DELIVERY,
      useFactory: (prisma: PrismaService, env: AppEnv) => new SlackBriefDelivery(prisma, env.slackBotToken),
      inject: [PrismaService, APP_ENV],
    },
  ],
  exports: [BRIEF_DELIVERY],
})
export class SlackDeliveryModule {}
