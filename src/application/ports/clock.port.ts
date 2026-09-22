import { LocalDate } from '../../domain/shared/local-date.js';
import { LocalDateTime } from '../../domain/shared/local-time.js';

/**
 * The domain never reads a clock: every function takes `now` as an argument. This port is where
 * the wall clock enters the application, so that tests can pin it to a fixed instant.
 */
export interface ClockPort {
  now(): LocalDateTime;
  today(): LocalDate;
  /**
   * The instant itself, for the things that are not wall-clock: a token's expiry is an absolute
   * moment, not a Seoul calendar date, and comparing it against `now()` would first throw the
   * offset away and then have to put it back.
   */
  instant(): Date;
}
