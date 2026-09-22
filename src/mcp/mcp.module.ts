import { hostHeaderValidation, originValidation, requireBearerAuth } from '@modelcontextprotocol/express';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import {
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  Provider,
  RequestMethod,
} from '@nestjs/common';
import { AlertSettingsService } from '../application/alert-settings.service.js';
import { ApplicationModule } from '../application/application.module.js';
import { DailyBriefService } from '../application/daily-brief.service.js';
import { ForecastService } from '../application/forecast.service.js';
import { IngredientService } from '../application/ingredient.service.js';
import { MealPlanImportService } from '../application/meal-plan-import.service.js';
import { MealPlanService } from '../application/meal-plan.service.js';
import { MealSlotService } from '../application/meal-slot.service.js';
import { MenuService } from '../application/menu.service.js';
import { NoFeedService } from '../application/no-feed.service.js';
import { ClockPort } from '../application/ports/clock.port.js';
import { HouseholdReader } from '../application/ports/household-write.port.js';
import { CLOCK, HOUSEHOLD_READER } from '../application/ports/tokens.js';
import { ReactionService } from '../application/reaction.service.js';
import { RulesService } from '../application/rules.service.js';
import { StockService } from '../application/stock.service.js';
import type { AppEnv } from '../config/env.js';
import { PersistenceModule } from '../infrastructure/prisma/persistence.module.js';
import { APP_ENV, PrismaService } from '../infrastructure/prisma/prisma.service.js';
import { MCP_SCOPE, MemberTokenVerifier } from './auth/member-token.verifier.js';
import { McpController } from './mcp.controller.js';
import { MCP_HANDLER, MCP_NODE_HANDLER, createHandler, createNodeHandler } from './mcp.handler.js';
import { ToolDeps } from './server.factory.js';

const TOOL_DEPS = Symbol('ToolDeps');
const TOKEN_VERIFIER = Symbol('MemberTokenVerifier');

const providers: Provider[] = [
  {
    provide: TOOL_DEPS,
    useFactory: (
      reader: HouseholdReader,
      stock: StockService,
      mealPlan: MealPlanService,
      mealPlanImport: MealPlanImportService,
      mealSlot: MealSlotService,
      noFeed: NoFeedService,
      rules: RulesService,
      reaction: ReactionService,
      forecast: ForecastService,
      dailyBrief: DailyBriefService,
      alertSettings: AlertSettingsService,
      ingredient: IngredientService,
      menu: MenuService,
    ): ToolDeps => ({
      reader,
      stock,
      mealPlan,
      mealPlanImport,
      mealSlot,
      noFeed,
      rules,
      reaction,
      forecast,
      dailyBrief,
      alertSettings,
      ingredient,
      menu,
    }),
    inject: [
      HOUSEHOLD_READER,
      StockService,
      MealPlanService,
      MealPlanImportService,
      MealSlotService,
      NoFeedService,
      RulesService,
      ReactionService,
      ForecastService,
      DailyBriefService,
      AlertSettingsService,
      IngredientService,
      MenuService,
    ],
  },
  {
    provide: TOKEN_VERIFIER,
    useFactory: (prisma: PrismaService, clock: ClockPort) => new MemberTokenVerifier(prisma, clock),
    inject: [PrismaService, CLOCK],
  },
  {
    provide: MCP_HANDLER,
    useFactory: (deps: ToolDeps) => createHandler(deps),
    inject: [TOOL_DEPS],
  },
  {
    provide: MCP_NODE_HANDLER,
    useFactory: (handler: McpHttpHandler) => createNodeHandler(handler),
    inject: [MCP_HANDLER],
  },
];

/**
 * The MCP endpoint and everything that stands in front of it.
 *
 * Three checks run before the handler, in this order, because each one is cheaper and more
 * conclusive than the next: the `Host` header, the `Origin` header, then the bearer token. The
 * handler itself validates none of them — it is documented as trusting its caller.
 */
@Module({
  imports: [ApplicationModule, PersistenceModule],
  controllers: [McpController],
  providers,
})
export class McpModule implements NestModule {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(TOKEN_VERIFIER) private readonly verifier: MemberTokenVerifier,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        hostHeaderValidation([...this.env.mcpAllowedHosts]),
        originValidation([...this.env.mcpAllowedOrigins]),
        // resourceMetadataUrl은 넘기지 않는다. 그것을 실으면 OAuth 인증 서버가 있다고
        // 광고하는 셈인데, 지금은 구성원별 토큰만 있고 인증 서버가 없다.
        requireBearerAuth({ verifier: this.verifier, requiredScopes: [MCP_SCOPE] }),
      )
      .forRoutes({ path: 'mcp', method: RequestMethod.ALL });
  }
}
