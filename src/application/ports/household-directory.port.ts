/**
 * The households a periodic run has to visit.
 *
 * Every other port takes a household id from the caller, because a tool call carries one in its
 * token. The scheduler has no caller and no token, so this is the one place that asks the store
 * which households exist.
 */
export interface HouseholdDirectoryPort {
  listIds(): Promise<string[]>;
}
