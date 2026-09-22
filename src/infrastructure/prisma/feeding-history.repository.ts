import { FeedingHistory, FeedingHistoryPort } from '../../application/ports/feeding-history.port.js';
import { toMeal } from './mappers/state.mapper.js';
import { PrismaTransaction } from './prisma.service.js';

/**
 * Reads every meal already fed, which is what introduction status needs. Unlike
 * `PrismaHouseholdStateRepository` this read is not windowed: the feeding that verifies an
 * ingredient may be months old. It runs outside a write transaction and is never part of one.
 */
export class PrismaFeedingHistoryRepository implements FeedingHistoryPort {
  constructor(private readonly prisma: PrismaTransaction) {}

  async load(householdId: string): Promise<FeedingHistory> {
    const mealRows = await this.prisma.meal.findMany({
      where: { householdId, status: 'consumed' },
      include: {
        actual: { select: { actualBaseMenuId: true } },
        toppings: { select: { kind: true, position: true, ingredientId: true } },
      },
      orderBy: [{ slot: 'asc' }, { mealOrder: 'asc' }],
    });
    const reactionRows = await this.prisma.feedingReaction.findMany({
      where: { householdId },
      select: { mealId: true, ingredientId: true, result: true },
      orderBy: { createdAt: 'asc' },
    });
    const migratedRows = await this.prisma.ingredient.findMany({
      where: { householdId, verifiedBeforeMigration: true },
      select: { id: true },
    });

    return {
      consumedMeals: mealRows.map(toMeal),
      reactions: reactionRows,
      verifiedBeforeMigrationIds: new Set(migratedRows.map((row) => row.id)),
    };
  }
}
