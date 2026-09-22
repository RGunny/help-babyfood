import { Inject, MiddlewareConsumer, Module, NestModule, Provider, RequestMethod } from '@nestjs/common';
import { ApplicationModule } from '../../application/application.module.js';
import { NoFeedService } from '../../application/no-feed.service.js';
import type { ClockPort } from '../../application/ports/clock.port.js';
import { HouseholdReader } from '../../application/ports/household-write.port.js';
import { CLOCK, HOUSEHOLD_READER } from '../../application/ports/tokens.js';
import { ReactionService } from '../../application/reaction.service.js';
import { StockService } from '../../application/stock.service.js';
import type { AppEnv } from '../../config/env.js';
import { PersistenceModule } from '../../infrastructure/prisma/persistence.module.js';
import { APP_ENV, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SlackActionDispatcher, postEphemeral } from './action-dispatch.js';
import { InteractionsController, SLACK_ACTION_DISPATCHER } from './interactions.controller.js';
import { slackSignature } from './signature.middleware.js';
import { SlackMemberResolver } from './slack-member.resolver.js';

const providers: Provider[] = [
  {
    provide: SLACK_ACTION_DISPATCHER,
    useFactory: (
      noFeed: NoFeedService,
      reaction: ReactionService,
      stock: StockService,
      reader: HouseholdReader,
      prisma: PrismaService,
    ) => new SlackActionDispatcher({ noFeed, reaction, stock, reader }, new SlackMemberResolver(prisma), postEphemeral),
    inject: [NoFeedService, ReactionService, StockService, HOUSEHOLD_READER, PrismaService],
  },
];

/**
 * Slack button responses: the signature check in front of the route, and the controller behind it.
 *
 * Imports the application to call its use cases. It does not import `SlackDeliveryModule`: taking
 * a tap uses nothing from sending, and the two directions stay in separate modules so that neither
 * forms a cycle with `ApplicationModule` (ADR 0006, "층별 결합").
 */
@Module({
  imports: [ApplicationModule, PersistenceModule],
  controllers: [InteractionsController],
  providers,
})
export class SlackInteractionModule implements NestModule {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(slackSignature(this.env.slackSigningSecret, this.clock))
      .forRoutes({ path: 'slack/interactions', method: RequestMethod.POST });
  }
}
