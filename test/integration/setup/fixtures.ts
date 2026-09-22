import { AlertSettingsService } from '../../../src/application/alert-settings.service.js';
import { DailyBriefService } from '../../../src/application/daily-brief.service.js';
import { ForecastService } from '../../../src/application/forecast.service.js';
import { IngredientService } from '../../../src/application/ingredient.service.js';
import { MealPlanImportService } from '../../../src/application/meal-plan-import.service.js';
import { MealPlanService } from '../../../src/application/meal-plan.service.js';
import { MealSlotService } from '../../../src/application/meal-slot.service.js';
import { MenuService } from '../../../src/application/menu.service.js';
import { NoFeedService } from '../../../src/application/no-feed.service.js';
import { ClockPort } from '../../../src/application/ports/clock.port.js';
import { Actor } from '../../../src/application/ports/household-write.port.js';
import { ReactionService } from '../../../src/application/reaction.service.js';
import { ReconcileService } from '../../../src/application/reconcile.service.js';
import { RulesService } from '../../../src/application/rules.service.js';
import { StockService } from '../../../src/application/stock.service.js';
import { LocalDate, localDate } from '../../../src/domain/shared/local-date.js';
import { LocalDateTime, localTime } from '../../../src/domain/shared/local-time.js';
import { PrismaFeedingHistoryRepository } from '../../../src/infrastructure/prisma/feeding-history.repository.js';
import { PrismaHouseholdDirectory } from '../../../src/infrastructure/prisma/household-directory.repository.js';
import { PrismaHouseholdStateRepository } from '../../../src/infrastructure/prisma/household-state.repository.js';
import { PrismaHouseholdWriter } from '../../../src/infrastructure/prisma/household-writer.js';
import { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { PrismaClient } from '../../../src/generated/prisma/client.js';
import { createPrismaClient, testDatabaseUrl } from './database.js';

/** Lets a test move "now" forward between steps, the way the scheduler sees time pass. */
export class MutableClock implements ClockPort {
  constructor(private current: LocalDateTime) {}

  set(date: string, time: string): void {
    this.current = { date: localDate(date), time: localTime(time) };
  }

  now(): LocalDateTime {
    return this.current;
  }

  today(): LocalDate {
    return this.current.date;
  }

  /** The same wall-clock reading as an instant, so token expiry moves with `set`. */
  instant(): Date {
    return new Date(`${this.current.date}T${this.current.time}:00+09:00`);
  }
}

export const at = (date: string, time: string): LocalDateTime => ({
  date: localDate(date),
  time: localTime(time),
});

export interface TestServices {
  readonly prisma: PrismaClient;
  readonly clock: MutableClock;
  readonly stock: StockService;
  readonly reconcile: ReconcileService;
  readonly noFeed: NoFeedService;
  readonly mealPlan: MealPlanService;
  readonly mealPlanImport: MealPlanImportService;
  readonly ingredient: IngredientService;
  readonly menu: MenuService;
  readonly mealSlot: MealSlotService;
  readonly reaction: ReactionService;
  readonly forecast: ForecastService;
  readonly rules: RulesService;
  readonly alertSettings: AlertSettingsService;
  readonly dailyBrief: DailyBriefService;
}

export function buildServices(now: LocalDateTime, lookbackDays = 90): TestServices {
  // PrismaService의 생성자는 Nest 데코레이터를 달고 있을 뿐이라 직접 만들 수 있다.
  const prisma = new PrismaService({
    databaseUrl: testDatabaseUrl(),
    lookbackDays,
    databasePoolSize: 5,
    mcpAllowedHosts: ['localhost'],
    mcpAllowedOrigins: ['localhost'],
    schedulerEnabled: false,
  }) as PrismaService;
  const clock = new MutableClock(now);
  const writer = new PrismaHouseholdWriter(prisma, new PrismaHouseholdStateRepository(lookbackDays), clock);
  const history = new PrismaFeedingHistoryRepository(prisma);
  return {
    prisma,
    clock,
    stock: new StockService(writer, writer, clock),
    reconcile: new ReconcileService(writer, new PrismaHouseholdDirectory(prisma)),
    noFeed: new NoFeedService(writer),
    mealPlan: new MealPlanService(writer, writer, history),
    mealPlanImport: new MealPlanImportService(writer, writer, history),
    ingredient: new IngredientService(writer),
    menu: new MenuService(writer, writer),
    mealSlot: new MealSlotService(writer, writer),
    reaction: new ReactionService(writer, writer, history),
    forecast: new ForecastService(writer),
    rules: new RulesService(writer, writer),
    alertSettings: new AlertSettingsService(writer, writer),
    dailyBrief: new DailyBriefService(writer, history, clock),
  };
}

/** The ingredients, menu and slot of the stage-1 deduction tests, so scenarios carry over. */
export const INGREDIENTS = [
  { name: '쌀', category: 'base', servingWeightGram: 30 },
  { name: '오트밀', category: 'base', servingWeightGram: 10 },
  { name: '소고기', category: 'meat', servingWeightGram: 10 },
  { name: '브로콜리', category: 'vegetable', servingWeightGram: 15, aliases: ['브로컬리'] },
  { name: '애호박', category: 'vegetable', servingWeightGram: 15 },
] as const;

export const MENU_NAME = '쌀오트밀죽';

export interface Household {
  readonly id: string;
  readonly memberId: string;
  readonly actor: Actor;
  readonly ingredientId: (name: string) => string;
  readonly menuId: string;
  readonly mealIds: readonly string[];
}

export interface SeedOptions {
  /** Morning meals to create, 1..n, each "쌀오트밀죽 + 소고기 + 브로콜리". */
  readonly mealCount?: number;
  readonly slotStartDate?: string;
  readonly mealTime?: string;
}

/**
 * Seeds one household through the services, so a test starts from data the application itself
 * would have produced. Only the household and its member go in directly: creating those is
 * provisioning, and no use case owns it yet.
 */
export async function seedHousehold(
  services: TestServices,
  options: SeedOptions = {},
): Promise<Household> {
  const { mealCount = 6, slotStartDate = '2026-08-17', mealTime = '10:00' } = options;
  const { id, memberId, actor } = await seedHouseholdOnly(services.prisma);

  const ingredientIds = new Map<string, string>();
  for (const spec of INGREDIENTS) {
    const ingredient = await services.ingredient.register({
      householdId: id,
      actor,
      name: spec.name,
      aliases: 'aliases' in spec ? [...spec.aliases] : [],
      category: spec.category,
      servingWeightGram: spec.servingWeightGram,
    });
    ingredientIds.set(spec.name, ingredient.id);
  }
  const idOf = (name: string): string => {
    const ingredientId = ingredientIds.get(name);
    if (ingredientId === undefined) throw new Error(`픽스처에 없는 재료입니다: ${name}`);
    return ingredientId;
  };

  const menu = await services.menu.register({
    householdId: id,
    actor,
    name: MENU_NAME,
    components: [
      { ingredientName: '쌀', cubes: 1 },
      { ingredientName: '오트밀', cubes: 1 },
    ],
  });

  await services.mealSlot.start({
    householdId: id,
    actor,
    slot: 'morning',
    startDate: localDate(slotStartDate),
    mealTime: localTime(mealTime),
  });

  const mealIds: string[] = [];
  if (mealCount > 0) {
    const appended = await services.mealPlan.appendMeals({
      householdId: id,
      actor,
      slot: 'morning',
      meals: Array.from({ length: mealCount }, () => ({
        composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['소고기', '브로콜리'] },
      })),
    });
    mealIds.push(...appended.map((meal) => meal.id));
  }

  return { id, memberId, actor, ingredientId: idOf, menuId: menu.id, mealIds };
}

/** A household with a member and nothing else, for tests that seed the rest themselves. */
export async function seedHouseholdOnly(
  prisma: PrismaClient,
): Promise<{ id: string; memberId: string; actor: Actor }> {
  const household = await prisma.household.create({ data: { name: '재하네' }, select: { id: true } });
  const member = await prisma.member.create({
    data: { householdId: household.id, name: '엄마' },
    select: { id: true },
  });
  return { id: household.id, memberId: member.id, actor: { kind: 'member', memberId: member.id } };
}

export function createTestPrisma(): PrismaClient {
  return createPrismaClient();
}
