import { ClockPort } from '../application/ports/clock.port.js';
import { LocalDate, localDate } from '../domain/shared/local-date.js';
import { LocalDateTime, localTime } from '../domain/shared/local-time.js';

export const SERVICE_TIME_ZONE = 'Asia/Seoul';

/**
 * Turns an instant into the Asia/Seoul calendar date and wall-clock time the domain works with.
 * The result does not depend on the process time zone, which is why the integration tests run
 * once under a non-Seoul `TZ`.
 */
export class SeoulClock implements ClockPort {
  private readonly formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: SERVICE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // Without this, midnight comes back as hour 24 on some engines.
    hourCycle: 'h23',
  });

  constructor(private readonly instant: () => Date = () => new Date()) {}

  now(): LocalDateTime {
    const parts = new Map(
      this.formatter.formatToParts(this.instant()).map((part) => [part.type, part.value]),
    );
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.get(type)!;
    return {
      date: localDate(`${part('year')}-${part('month')}-${part('day')}`),
      time: localTime(`${part('hour')}:${part('minute')}`),
    };
  }

  today(): LocalDate {
    return this.now().date;
  }
}

/** A clock pinned to one instant. Used by tests and by any run that must see a single "now". */
export class FixedClock implements ClockPort {
  constructor(private readonly fixed: LocalDateTime) {}

  now(): LocalDateTime {
    return this.fixed;
  }

  today(): LocalDate {
    return this.fixed.date;
  }
}
