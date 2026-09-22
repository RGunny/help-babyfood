import { IngredientForecast, forecastShortage } from '../domain/forecast/shortage-forecast.js';
import { LocalDate } from '../domain/shared/local-date.js';
import { HouseholdReader } from './ports/household-write.port.js';

/**
 * Plays the planned meals against current stock and reports what runs out when.
 *
 * A fixed threshold per ingredient cannot tell beef used every day from cucumber used twice, so the
 * plan is the main basis. Nothing is stored: a forecast made yesterday is wrong as soon as a batch
 * is cooked or a meal is postponed.
 */
export class ForecastService {
  constructor(private readonly reader: HouseholdReader) {}

  /** `until` bounds the horizon. Null looks at every planned meal. */
  async forecast(householdId: string, until: LocalDate | null = null): Promise<IngredientForecast[]> {
    return await this.reader.read(householdId, (state) =>
      forecastShortage({
        ingredients: state.ingredients,
        meals: state.meals,
        calendar: state.calendar,
        menus: state.menus,
        batches: state.batches,
        entries: state.entries,
        until,
      }),
    );
  }
}
