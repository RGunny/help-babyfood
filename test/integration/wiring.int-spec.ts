import { Test } from '@nestjs/testing';
import { AlertSettingsService } from '../../src/application/alert-settings.service.js';
import { BoardSyncService } from '../../src/application/board-sync.service.js';
import { ApplicationModule } from '../../src/application/application.module.js';
import { ForecastService } from '../../src/application/forecast.service.js';
import { HouseholdBoardService } from '../../src/application/household-board.service.js';
import { IngredientService } from '../../src/application/ingredient.service.js';
import { MealPlanService } from '../../src/application/meal-plan.service.js';
import { MealSlotService } from '../../src/application/meal-slot.service.js';
import { MenuService } from '../../src/application/menu.service.js';
import { NoFeedService } from '../../src/application/no-feed.service.js';
import { ClockPort } from '../../src/application/ports/clock.port.js';
import { CLOCK } from '../../src/application/ports/tokens.js';
import { ReactionService } from '../../src/application/reaction.service.js';
import { ReconcileService } from '../../src/application/reconcile.service.js';
import { RulesService } from '../../src/application/rules.service.js';
import { StockService } from '../../src/application/stock.service.js';
import { AppEnv } from '../../src/config/env.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { SERVICE_TIME_ZONE } from '../../src/infrastructure/clock.js';
import { APP_ENV, PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { testDatabaseUrl } from './setup/database.js';

const SERVICES = [
  StockService,
  ReconcileService,
  NoFeedService,
  MealPlanService,
  IngredientService,
  MenuService,
  MealSlotService,
  ReactionService,
  ForecastService,
  RulesService,
  AlertSettingsService,
  HouseholdBoardService,
  BoardSyncService,
];

/** Only the environment is swapped: everything else is wired the way the server boots it. */
async function bootApplicationModule() {
  const moduleRef = await Test.createTestingModule({ imports: [ApplicationModule] })
    .overrideProvider(APP_ENV)
    .useValue({
      databaseUrl: testDatabaseUrl(),
      lookbackDays: 90,
      databasePoolSize: 5,
      mcpAllowedHosts: ['localhost'],
      mcpAllowedOrigins: ['localhost'],
      schedulerEnabled: false,
      slackBotToken: 'xoxb-test',
      slackSigningSecret: 'signing-secret-test',
    } satisfies AppEnv)
    .compile();
  await moduleRef.init();
  return moduleRef;
}

describe('Nest 배선', () => {
  it('모듈을 부팅하면 유스케이스가 전부 해석된다', async () => {
    const moduleRef = await bootApplicationModule();
    try {
      for (const service of SERVICES) {
        expect(moduleRef.get(service)).toBeInstanceOf(service);
      }
    } finally {
      await moduleRef.close();
    }
  });

  it('쓰기와 읽기가 같은 Prisma 클라이언트를 쓴다', async () => {
    const moduleRef = await bootApplicationModule();
    try {
      const prisma = moduleRef.get(PrismaService);
      const household = await prisma.household.create({ data: { name: '재하네' }, select: { id: true } });
      const member = await prisma.member.create({
        data: { householdId: household.id, name: '엄마' },
        select: { id: true },
      });
      const actor = { kind: 'member' as const, memberId: member.id };

      await moduleRef.get(IngredientService).register({
        householdId: household.id,
        actor,
        name: '브로콜리',
        category: 'vegetable',
        servingWeightGram: 15,
      });
      const batch = await moduleRef.get(StockService).registerCookedBatch({
        householdId: household.id,
        actor,
        ingredientName: '브로콜리',
        cubeWeightGram: 15,
        cookedOn: localDate('2026-08-15'),
        cubes: 12,
      });

      const status = await moduleRef.get(StockService).getStockStatus(household.id);
      expect(status.ingredients).toMatchObject([{ total: 12 }]);
      const row = await prisma.cookedBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(row.remainingCubes).toBe(12);
    } finally {
      await moduleRef.close();
    }
  });

  it('시계는 프로세스 시간대가 아니라 Asia/Seoul을 쓴다', async () => {
    const moduleRef = await bootApplicationModule();
    try {
      const clock = moduleRef.get<ClockPort>(CLOCK);
      const seoul = new Intl.DateTimeFormat('en-CA', {
        timeZone: SERVICE_TIME_ZONE,
        dateStyle: 'short',
      }).format(new Date());
      expect(clock.today()).toBe(seoul);
    } finally {
      await moduleRef.close();
    }
  });
});
