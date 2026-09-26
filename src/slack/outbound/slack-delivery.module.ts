import { Module } from '@nestjs/common';
import { ClockPort } from '../../application/ports/clock.port.js';
import { BOARD_PUBLISHER, BRIEF_DELIVERY, CLOCK } from '../../application/ports/tokens.js';
import type { AppEnv } from '../../config/env.js';
import { PersistenceModule } from '../../infrastructure/prisma/persistence.module.js';
import { APP_ENV, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SlackBriefDelivery } from './slack-brief-delivery.js';
import { SlackCanvasPublisher } from './slack-canvas-publisher.js';
import { PrismaSlackMessageLog } from './slack-message-log.js';

/**
 * The Slack implementations of `BriefDeliveryPort` and `BoardPublisherPort`.
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
      useFactory: (prisma: PrismaService, env: AppEnv, clock: ClockPort) =>
        new SlackBriefDelivery(prisma, env.slackBotToken, new PrismaSlackMessageLog(prisma), clock),
      inject: [PrismaService, APP_ENV, CLOCK],
    },
    {
      provide: BOARD_PUBLISHER,
      useFactory: (prisma: PrismaService, env: AppEnv, clock: ClockPort) =>
        new SlackCanvasPublisher(prisma, env.slackBotToken, clock),
      inject: [PrismaService, APP_ENV, CLOCK],
    },
  ],
  exports: [BRIEF_DELIVERY, BOARD_PUBLISHER],
})
export class SlackDeliveryModule {}
