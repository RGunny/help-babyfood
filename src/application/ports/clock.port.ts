import { LocalDate } from '../../domain/shared/local-date.js';
import { LocalDateTime } from '../../domain/shared/local-time.js';

/**
 * The domain never reads a clock: every function takes `now` as an argument. This port is where
 * the wall clock enters the application, so that tests can pin it to a fixed instant.
 */
export interface ClockPort {
  now(): LocalDateTime;
  today(): LocalDate;
}
