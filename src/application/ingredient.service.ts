import { DomainError } from '../domain/errors.js';
import { Ingredient, IngredientCategory, StockTracking } from '../domain/ingredient/ingredient.js';
import { remainingByBatch } from '../domain/stock/ledger.js';
import { IngredientCatalog } from '../domain/ingredient/ingredient-catalog.js';
import { ApplicationError } from './errors.js';
import { Actor, HouseholdWriter } from './ports/household-write.port.js';

export interface RegisterIngredientCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly category: IngredientCategory;
  readonly servingWeightGram: number;
  /** Set at migration for ingredients the baby had already tolerated before the service existed. */
  readonly verifiedBeforeMigration?: boolean;
}

export interface AddIngredientAliasCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly name: string;
  readonly alias: string;
}

export interface UpdateServingWeightCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly name: string;
  readonly servingWeightGram: number;
}

export interface UpdateStockTrackingCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly name: string;
  readonly stockTracking: StockTracking;
}

/**
 * The ingredient master. Every deduction resolves a name through it, so a name that is not
 * registered here cannot be cooked into a batch or planned into a meal.
 */
export class IngredientService {
  constructor(private readonly writer: HouseholdWriter) {}

  async register(command: RegisterIngredientCommand): Promise<Ingredient> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'register_ingredient',
        idempotencyKey: command.idempotencyKey,
        payload: {
          name: command.name,
          aliases: command.aliases,
          category: command.category,
          servingWeightGram: command.servingWeightGram,
          verifiedBeforeMigration: command.verifiedBeforeMigration,
        },
      },
      async (context) => {
        const state = await context.load();
        const draft = {
          name: command.name,
          aliases: command.aliases ?? [],
          category: command.category,
          servingWeightGram: requirePositiveWeight(command.servingWeightGram),
          stockTracking: 'cubes' as const,
          verifiedBeforeMigration: command.verifiedBeforeMigration ?? false,
        };
        // 카탈로그 생성자가 이름·별칭 충돌을 던진다. 같은 규칙을 애플리케이션에 다시 쓰지 않는다.
        new IngredientCatalog([...state.ingredients, { ...draft, id: 'candidate' }]);
        return await context.insertIngredient(draft);
      },
    );
  }

  /** "브로컬리"를 "브로콜리"에 붙여 같은 재료로 취급한다. */
  async addAlias(command: AddIngredientAliasCommand): Promise<Ingredient> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'add_ingredient_alias',
        idempotencyKey: command.idempotencyKey,
        payload: { name: command.name, alias: command.alias },
      },
      async (context) => {
        const state = await context.load();
        const ingredient = requireIngredient(state.catalog, command.name);
        const updated: Ingredient = { ...ingredient, aliases: [...ingredient.aliases, command.alias] };
        new IngredientCatalog(
          state.ingredients.map((candidate) => (candidate.id === ingredient.id ? updated : candidate)),
        );
        await context.addIngredientAlias(ingredient.id, command.alias);
        return updated;
      },
    );
  }

  /**
   * The baby grew, so one serving is now a different weight. Batches cooked at the old weight stay
   * in stock but stop being deductible, which `summarizeStock` reports as weight-mismatched.
   */
  async updateServingWeight(command: UpdateServingWeightCommand): Promise<Ingredient> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'update_ingredient_serving_weight',
        idempotencyKey: command.idempotencyKey,
        payload: { name: command.name, servingWeightGram: command.servingWeightGram },
      },
      async (context) => {
        const state = await context.load();
        const ingredient = requireIngredient(state.catalog, command.name);
        const servingWeightGram = requirePositiveWeight(command.servingWeightGram);
        await context.updateServingWeight(ingredient.id, servingWeightGram);
        return { ...ingredient, servingWeightGram };
      },
    );
  }

  /**
   * Eggs are bought, not cooked into cubes, so they leave the stock table. Cubes still in the
   * freezer would vanish from it with them, which is why those have to be used or discarded first.
   */
  async updateStockTracking(command: UpdateStockTrackingCommand): Promise<Ingredient> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'update_ingredient_stock_tracking',
        idempotencyKey: command.idempotencyKey,
        payload: { name: command.name, stockTracking: command.stockTracking },
      },
      async (context) => {
        const state = await context.load();
        const ingredient = requireIngredient(state.catalog, command.name);
        if (command.stockTracking === 'pantry') {
          const remaining = remainingByBatch(state.entries);
          const cubesLeft = state.batches
            .filter((batch) => batch.ingredientId === ingredient.id)
            .reduce((cubes, batch) => cubes + (remaining.get(batch.id) ?? 0), 0);
          if (cubesLeft > 0) {
            throw new ApplicationError(
              'PANTRY_WITH_STOCK',
              `잔여 큐브가 있는 재료는 상비로 바꿀 수 없습니다: ${ingredient.name} ${cubesLeft}개`,
            );
          }
        }
        await context.updateStockTracking(ingredient.id, command.stockTracking);
        return { ...ingredient, stockTracking: command.stockTracking };
      },
    );
  }
}

function requireIngredient(catalog: IngredientCatalog, name: string): Ingredient {
  const ingredient = catalog.findByName(name);
  if (ingredient === null) {
    throw new DomainError('UNKNOWN_INGREDIENT', `등록되지 않은 재료입니다: ${name}`);
  }
  return ingredient;
}

function requirePositiveWeight(gram: number): number {
  if (!Number.isInteger(gram) || gram <= 0) {
    throw new ApplicationError('INVALID_WEIGHT', `1회분 중량은 1 이상의 정수여야 합니다: ${gram}`);
  }
  return gram;
}
