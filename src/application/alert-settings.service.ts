import { DomainError } from '../domain/errors.js';
import { IngredientCatalog } from '../domain/ingredient/ingredient-catalog.js';
import { LocalTime } from '../domain/shared/local-time.js';
import { ApplicationError } from './errors.js';
import { AlertSettings } from './household-state.js';
import { Actor, HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';

/** A fallback threshold as a parent says it: "소고기는 3개 밑으로 떨어지면 알려 줘". */
export interface ThresholdInput {
  readonly ingredientName: string;
  readonly thresholdCubes: number;
}

export interface UpdateAlertSettingsCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly briefTime: LocalTime;
  readonly shelfLifeDays: number;
  /** Replaces the stored thresholds as a whole. An ingredient left out has no threshold. */
  readonly thresholds: readonly ThresholdInput[];
}

export interface AlertSettingsView {
  readonly settings: AlertSettings;
  readonly thresholds: readonly ThresholdInput[];
}

/**
 * When the daily brief goes out, how long a cube lasts, and the per-ingredient cube counts that
 * stand in for a forecast while no meals are planned.
 */
export class AlertSettingsService {
  constructor(
    private readonly writer: HouseholdWriter,
    private readonly reader: HouseholdReader,
  ) {}

  async getSettings(householdId: string): Promise<AlertSettingsView> {
    return await this.reader.read(householdId, (state) => ({
      settings: state.alertSettings,
      thresholds: [...state.thresholds].map(([ingredientId, thresholdCubes]) => ({
        ingredientName: state.catalog.getById(ingredientId).name,
        thresholdCubes,
      })),
    }));
  }

  async update(command: UpdateAlertSettingsCommand): Promise<AlertSettingsView> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'update_alert_settings',
        idempotencyKey: command.idempotencyKey,
        payload: {
          briefTime: command.briefTime,
          shelfLifeDays: command.shelfLifeDays,
          thresholds: command.thresholds,
        },
      },
      async (context) => {
        const state = await context.load();
        if (!Number.isInteger(command.shelfLifeDays) || command.shelfLifeDays <= 0) {
          throw new ApplicationError(
            'INVALID_THRESHOLD',
            `임계일은 1 이상의 정수여야 합니다: ${command.shelfLifeDays}`,
          );
        }
        const settings: AlertSettings = {
          briefTime: command.briefTime,
          shelfLifeDays: command.shelfLifeDays,
        };
        const thresholds = resolveThresholds(state.catalog, command.thresholds);
        await context.saveAlertSettings(settings);
        await context.saveThresholds(thresholds);
        return { settings, thresholds: command.thresholds };
      },
    );
  }
}

function resolveThresholds(
  catalog: IngredientCatalog,
  inputs: readonly ThresholdInput[],
): Map<string, number> {
  const byIngredient = new Map<string, number>();
  for (const input of inputs) {
    const ingredient = catalog.findByName(input.ingredientName);
    if (ingredient === null) {
      throw new DomainError('UNKNOWN_INGREDIENT', `등록되지 않은 재료입니다: ${input.ingredientName}`);
    }
    if (ingredient.stockTracking === 'pantry') {
      throw new ApplicationError('INVALID_THRESHOLD', `상비 재료에는 임계개수를 둘 수 없습니다: ${ingredient.name}`);
    }
    if (!Number.isInteger(input.thresholdCubes) || input.thresholdCubes < 0) {
      throw new ApplicationError(
        'INVALID_THRESHOLD',
        `임계개수는 0 이상의 정수여야 합니다: ${input.thresholdCubes}`,
      );
    }
    byIngredient.set(ingredient.id, input.thresholdCubes);
  }
  return byIngredient;
}
