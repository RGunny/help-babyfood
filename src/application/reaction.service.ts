import { DomainError } from '../domain/errors.js';
import { Ingredient, StockTracking } from '../domain/ingredient/ingredient.js';
import { FeedingReaction, IntroductionStatus } from '../domain/ingredient/introduction-status.js';
import { Meal } from '../domain/meal-plan/meal.js';
import { LocalDate } from '../domain/shared/local-date.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { ApplicationError } from './errors.js';
import { ingredientIdsOf, introductionStatuses } from './feeding-history.js';
import { HouseholdState, mealAt } from './household-state.js';
import { FeedingHistoryPort } from './ports/feeding-history.port.js';
import { Actor, HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';

export interface RecordReactionCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly date: LocalDate;
  readonly slot: MealSlot;
  readonly ingredientName: string;
  readonly result: FeedingReaction;
  readonly symptomMemo?: string | null;
}

/** What the brief shows per ingredient: the state and the exposure number to announce. */
export interface IngredientIntroduction {
  readonly ingredientId: string;
  readonly name: string;
  readonly status: IntroductionStatus;
  readonly stockTracking: StockTracking;
}

/**
 * Allergy introduction. Solid food doubles as an allergy check, so the server derives each
 * ingredient's state from the feeding history instead of storing it: a reaction recorded late, or a
 * meal corrected afterwards, then changes the state on its own.
 */
export class ReactionService {
  constructor(
    private readonly writer: HouseholdWriter,
    private readonly reader: HouseholdReader,
    private readonly history: FeedingHistoryPort,
  ) {}

  async record(command: RecordReactionCommand): Promise<void> {
    await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'record_feeding_reaction',
        idempotencyKey: command.idempotencyKey,
        payload: {
          date: command.date,
          slot: command.slot,
          ingredientName: command.ingredientName,
          result: command.result,
          symptomMemo: command.symptomMemo,
        },
      },
      async (context) => {
        // 반응은 오래 전 급여에도 붙는다. 그 날짜까지 윈도를 넓힌다.
        const state = await context.load({ sinceDate: command.date });
        const meal = mealFedOn(state, command.slot, command.date);
        const ingredient = requireIngredient(state, command.ingredientName);
        if (!ingredientIdsOf(meal, state.menus).includes(ingredient.id)) {
          throw new ApplicationError(
            'INGREDIENT_NOT_IN_MEAL',
            `그 식단에 없는 재료입니다: ${command.ingredientName}`,
          );
        }
        await context.recordFeedingReaction({
          mealId: meal.id,
          ingredientId: ingredient.id,
          result: command.result,
          symptomMemo: command.symptomMemo ?? null,
        });
      },
    );
  }

  /** 미도입, 검증중 N회, 검증완료, 반응있음. 등록된 모든 재료가 한 줄씩 나온다. */
  async getIntroductionStatus(householdId: string): Promise<IngredientIntroduction[]> {
    const history = await this.history.load(householdId);
    return await this.reader.read(householdId, (state) => {
      const statuses = introductionStatuses(history, state.ingredients, state.menus);
      return state.ingredients.map((ingredient) => ({
        ingredientId: ingredient.id,
        name: ingredient.name,
        status: statuses.get(ingredient.id)!,
        stockTracking: ingredient.stockTracking,
      }));
    });
  }
}

/** Only a meal that was really fed can have a reaction: a plan has nothing to react to yet. */
function mealFedOn(state: HouseholdState, slot: MealSlot, date: LocalDate): Meal {
  const meal = mealAt(state, slot, date);
  if (meal.status !== 'consumed') {
    throw new ApplicationError('MEAL_NOT_FED', `아직 먹이지 않은 식단입니다: ${date} ${slot}`);
  }
  return meal;
}

function requireIngredient(state: HouseholdState, name: string): Ingredient {
  const ingredient = state.catalog.findByName(name);
  if (ingredient === null) {
    throw new DomainError('UNKNOWN_INGREDIENT', `등록되지 않은 재료입니다: ${name}`);
  }
  return ingredient;
}
