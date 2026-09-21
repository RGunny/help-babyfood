export type DomainErrorCode =
  | 'INVALID_DATE'
  | 'INVALID_TIME'
  | 'DUPLICATE_INGREDIENT_NAME'
  | 'UNKNOWN_INGREDIENT'
  | 'UNKNOWN_MENU'
  | 'UNKNOWN_BATCH'
  | 'INVALID_LEDGER_ENTRY'
  | 'NOTHING_TO_DISCARD'
  | 'ADJUSTMENT_BELOW_ZERO'
  | 'SLOT_NOT_SCHEDULED'
  | 'DUPLICATE_SLOT_SCHEDULE'
  | 'INVALID_MEAL_ORDER'
  | 'NO_FEED_BEFORE_SLOT_START'
  | 'NO_FEED_ALREADY_REGISTERED'
  | 'NO_FEED_NOT_FOUND';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
