import { DomainError } from '../domain/errors.js';
import { IngredientCatalog } from '../domain/ingredient/ingredient-catalog.js';
import { ForbiddenPairing, MealPlanningRules } from '../domain/rules/meal-rules.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { ApplicationError } from './errors.js';
import { Actor, HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';

/** A forbidden pairing as a parent says it: two ingredient names and where the ban applies. */
export interface ForbiddenPairingInput {
  readonly ingredientNames: readonly [string, string];
  readonly scope: ForbiddenPairing['scope'];
}

export interface UpdateRulesCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly forbiddenPairings: readonly ForbiddenPairingInput[];
  readonly maxFirstIntroductionsPerDay: number | null;
  readonly firstIntroductionSlot: MealSlot | null;
  /** Free text the agent reads when it proposes meals. The server never checks it. */
  readonly textGuidance: string | null;
}

export interface MealPlanningRulesView {
  readonly rules: MealPlanningRules;
  readonly textGuidance: string | null;
}

/**
 * The two kinds of meal rules: constraints the server checks on every plan read, and guidance the
 * agent reads when it proposes the next days.
 */
export class RulesService {
  constructor(
    private readonly writer: HouseholdWriter,
    private readonly reader: HouseholdReader,
  ) {}

  async getRules(householdId: string): Promise<MealPlanningRulesView> {
    return await this.reader.read(householdId, (state) => ({
      rules: state.rules,
      textGuidance: state.textGuidance,
    }));
  }

  async update(command: UpdateRulesCommand): Promise<MealPlanningRulesView> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'update_meal_planning_rules',
        idempotencyKey: command.idempotencyKey,
        payload: {
          forbiddenPairings: command.forbiddenPairings,
          maxFirstIntroductionsPerDay: command.maxFirstIntroductionsPerDay,
          firstIntroductionSlot: command.firstIntroductionSlot,
          textGuidance: command.textGuidance,
        },
      },
      async (context) => {
        const state = await context.load();
        const rules: MealPlanningRules = {
          forbiddenPairings: normalizePairings(state.catalog, command.forbiddenPairings),
          maxFirstIntroductionsPerDay: command.maxFirstIntroductionsPerDay,
          firstIntroductionSlot: command.firstIntroductionSlot,
        };
        await context.saveRules(rules, command.textGuidance);
        return { rules, textGuidance: command.textGuidance };
      },
    );
  }
}

/**
 * Resolves the names and puts each pair in one canonical order, so that "소고기와 고구마" and
 * "고구마와 소고기" are the same rule. The stored ids are compared as the `ingredient_a_id <
 * ingredient_b_id` CHECK does, which is the backstop if this is ever skipped.
 */
export function normalizePairings(
  catalog: IngredientCatalog,
  inputs: readonly ForbiddenPairingInput[],
): ForbiddenPairing[] {
  const byKey = new Map<string, ForbiddenPairing>();
  for (const input of inputs) {
    const [first, second] = input.ingredientNames.map((name) => {
      const ingredient = catalog.findByName(name);
      if (ingredient === null) {
        throw new DomainError('UNKNOWN_INGREDIENT', `등록되지 않은 재료입니다: ${name}`);
      }
      return ingredient.id;
    });
    if (first === second) {
      throw new ApplicationError(
        'INVALID_PAIRING',
        `같은 재료를 조합 금지로 둘 수 없습니다: ${input.ingredientNames[0]}`,
      );
    }
    const ordered: [string, string] = first < second ? [first, second] : [second, first];
    byKey.set(`${ordered[0]}#${ordered[1]}#${input.scope}`, { ingredientIds: ordered, scope: input.scope });
  }
  return [...byKey.values()];
}
