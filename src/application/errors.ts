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
  | 'INGREDIENT_NOT_IN_MEAL'
  | 'INVALID_WEIGHT'
  | 'INVALID_CUBE_COUNT'
  | 'INVALID_PAIRING'
  | 'INVALID_THRESHOLD';

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
