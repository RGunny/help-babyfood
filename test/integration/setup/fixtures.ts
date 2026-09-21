import { MealPlanService } from '../../../src/application/meal-plan.service.js';
import { NoFeedService } from '../../../src/application/no-feed.service.js';
import { ClockPort } from '../../../src/application/ports/clock.port.js';
import { Actor } from '../../../src/application/ports/household-write.port.js';
import { ReconcileService } from '../../../src/application/reconcile.service.js';
import { StockService } from '../../../src/application/stock.service.js';
import { LocalDate, localDate } from '../../../src/domain/shared/local-date.js';
import { LocalDateTime, localTime } from '../../../src/domain/shared/local-time.js';
import { PrismaHouseholdStateRepository } from '../../../src/infrastructure/prisma/household-state.repository.js';
import { PrismaHouseholdWriter } from '../../../src/infrastructure/prisma/household-writer.js';
import { fromLocalDate } from '../../../src/infrastructure/prisma/mappers/local-date.mapper.js';
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
}

export function buildServices(now: LocalDateTime, lookbackDays = 90): TestServices {
  // PrismaService의 생성자는 Nest 데코레이터를 달고 있을 뿐이라 직접 만들 수 있다.
  const prisma = new PrismaService({
    databaseUrl: testDatabaseUrl(),
    lookbackDays,
    databasePoolSize: 5,
  }) as PrismaService;
  const clock = new MutableClock(now);
  const writer = new PrismaHouseholdWriter(prisma, new PrismaHouseholdStateRepository(lookbackDays), clock);
  return {
    prisma,
    clock,
    stock: new StockService(writer, writer, clock),
    reconcile: new ReconcileService(writer),
    noFeed: new NoFeedService(writer),
    mealPlan: new MealPlanService(writer, writer),
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

export async function seedHousehold(prisma: PrismaClient, options: SeedOptions = {}): Promise<Household> {
  const { mealCount = 6, slotStartDate = '2026-08-17', mealTime = '10:00' } = options;

  const household = await prisma.household.create({ data: { name: '재하네' }, select: { id: true } });
  const member = await prisma.member.create({
    data: { householdId: household.id, name: '엄마' },
    select: { id: true },
  });

  const ingredientIds = new Map<string, string>();
  for (const spec of INGREDIENTS) {
    const created = await prisma.ingredient.create({
      data: {
        householdId: household.id,
        name: spec.name,
        category: spec.category,
        servingWeightGram: spec.servingWeightGram,
      },
      select: { id: true },
    });
    ingredientIds.set(spec.name, created.id);
    const labels = [spec.name, ...('aliases' in spec ? spec.aliases : [])];
    await prisma.ingredientLabel.createMany({
      data: labels.map((label, position) => ({
        householdId: household.id,
        ingredientId: created.id,
        label,
        normalizedLabel: normalize(label),
        isCanonical: position === 0,
        position,
      })),
    });
  }
  const idOf = (name: string): string => {
    const id = ingredientIds.get(name);
    if (id === undefined) throw new Error(`픽스처에 없는 재료입니다: ${name}`);
    return id;
  };

  const menu = await prisma.menu.create({
    data: {
      householdId: household.id,
      name: '쌀오트밀죽',
      components: {
        create: [
          { ingredientId: idOf('쌀'), cubes: 1 },
          { ingredientId: idOf('오트밀'), cubes: 1 },
        ],
      },
    },
    select: { id: true },
  });

  await prisma.slotSchedule.create({
    data: {
      householdId: household.id,
      slot: 'morning',
      startDate: fromLocalDate(localDate(slotStartDate)),
      mealTime,
    },
  });

  const mealIds: string[] = [];
  for (let order = 1; order <= mealCount; order++) {
    const meal = await prisma.meal.create({
      data: {
        householdId: household.id,
        slot: 'morning',
        mealOrder: order,
        plannedBaseMenuId: menu.id,
        toppings: {
          create: [
            { kind: 'planned', position: 0, ingredientId: idOf('소고기') },
            { kind: 'planned', position: 1, ingredientId: idOf('브로콜리') },
          ],
        },
      },
      select: { id: true },
    });
    mealIds.push(meal.id);
  }

  return {
    id: household.id,
    memberId: member.id,
    actor: { kind: 'member', memberId: member.id },
    ingredientId: idOf,
    menuId: menu.id,
    mealIds,
  };
}

/** Same rule as the domain's `normalizeIngredientName`. */
function normalize(label: string): string {
  return label.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

export function createTestPrisma(): PrismaClient {
  return createPrismaClient();
}
