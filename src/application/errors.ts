/**
 * A rule the application layer enforces, as opposed to a domain rule. These are about the identity
 * and consistency of stored records: who retried what, which row already exists, whether the meal a
 * record points at was really fed.
 */
export type ApplicationErrorCode =
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'HOUSEHOLD_NOT_FOUND'
  | 'MENU_NAME_TAKEN'
  | 'MEAL_NOT_FED'
  | 'SLOT_NOT_EMPTY'
  | 'INGREDIENT_NOT_IN_MEAL'
  | 'INVALID_WEIGHT'
  | 'INVALID_CUBE_COUNT'
  | 'INVALID_PAIRING'
  | 'INVALID_THRESHOLD'
  | 'PANTRY_WITH_STOCK'
  | 'PANTRY_INGREDIENT'
  | 'BLEND_AS_TOPPING'
  | 'BLEND_HAS_NO_REACTION'
  | 'BLEND_IN_PAIRING';

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
