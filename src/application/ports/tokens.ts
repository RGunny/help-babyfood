/**
 * Injection tokens for the ports. The ports are interfaces and leave no runtime value behind, so a
 * container needs a symbol to bind them to. Only symbols live here: keeping the framework out of
 * `src/application` is what lets the services be built with `new` in tests.
 */
export const HOUSEHOLD_WRITER = Symbol('HouseholdWriter');
export const HOUSEHOLD_READER = Symbol('HouseholdReader');
export const CLOCK = Symbol('ClockPort');
export const FEEDING_HISTORY = Symbol('FeedingHistoryPort');
export const HOUSEHOLD_DIRECTORY = Symbol('HouseholdDirectoryPort');
