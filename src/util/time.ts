/**
 * Station local time.
 *
 * A log is written in the station's own wall clock and a spin is reported in
 * it, so every timestamp in the system is a UTC instant plus the zone rule that
 * turns it into what the jock saw on the studio clock. Two nights a year that
 * mapping is not a bijection, and the scheduler has to survive both of them.
 */

export interface ZoneRule {
  readonly label: string;
  readonly standardOffsetMinutes: number;
  readonly daylightOffsetMinutes: number;
  readonly observesDaylight: boolean;
}

export interface CivilDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return MONTH_LENGTHS[month - 1] ?? 30;
}

/** Days since the epoch for a civil date, by the usual civil_from_days inverse. */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146_096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/** 0 is Sunday, matching the way dayparts are written on a programming grid. */
export function weekdayOf(year: number, month: number, day: number): number {
  const days = daysFromCivil(year, month, day);
  return (((days + 4) % 7) + 7) % 7;
}

/** Day of month for the nth given weekday, 1 based. Negative n counts back. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = weekdayOf(year, month, 1);
    const offset = (weekday - first + 7) % 7;
    return 1 + offset + (n - 1) * 7;
  }
  const length = daysInMonth(year, month);
  const last = weekdayOf(year, month, length);
  const offset = (last - weekday + 7) % 7;
  return length - offset + (n + 1) * 7;
}

/**
 * Daylight saving runs from 02:00 local standard on the second Sunday in March
 * to 02:00 local daylight on the first Sunday in November. Both boundaries are
 * returned as UTC instants so a comparison never has to think about which side
 * of the transition it is on.
 */
export function daylightWindow(rule: ZoneRule, year: number): { start: number; end: number } {
  const startDay = nthWeekdayOfMonth(year, 3, 0, 2);
  const endDay = nthWeekdayOfMonth(year, 11, 0, 1);
  const start =
    daysFromCivil(year, 3, startDay) * DAY_MS +
    2 * HOUR_MS -
    rule.standardOffsetMinutes * MINUTE_MS;
  const end =
    daysFromCivil(year, 11, endDay) * DAY_MS + 2 * HOUR_MS - rule.daylightOffsetMinutes * MINUTE_MS;
  return { start, end };
}

export function offsetAt(rule: ZoneRule, instant: number): number {
  if (!rule.observesDaylight) {
    return rule.standardOffsetMinutes;
  }
  const { year } = civilFromDays(Math.floor(instant / DAY_MS));
  const window = daylightWindow(rule, year);
  return instant >= window.start && instant < window.end
    ? rule.daylightOffsetMinutes
    : rule.standardOffsetMinutes;
}

export function isDaylight(rule: ZoneRule, instant: number): boolean {
  return offsetAt(rule, instant) === rule.daylightOffsetMinutes && rule.observesDaylight;
}

export function toCivil(rule: ZoneRule, instant: number): CivilDateTime {
  const local = instant + offsetAt(rule, instant) * MINUTE_MS;
  const days = Math.floor(local / DAY_MS);
  const rest = local - days * DAY_MS;
  const { year, month, day } = civilFromDays(days);
  return {
    year,
    month,
    day,
    hour: Math.floor(rest / HOUR_MS),
    minute: Math.floor((rest % HOUR_MS) / MINUTE_MS),
    second: Math.floor((rest % MINUTE_MS) / 1000),
  };
}

export type CivilResolution =
  | { readonly kind: 'exact'; readonly instant: number }
  | { readonly kind: 'gap'; readonly instant: number }
  | { readonly kind: 'ambiguous'; readonly instant: number; readonly later: number };

/**
 * Turn a station wall clock reading into an instant.
 *
 * On the spring forward night the hour between 02:00 and 03:00 does not exist,
 * and a clock that says 02:30 is a log entry nobody could have aired. On the
 * fall back night 01:30 happens twice. Both are reported rather than guessed,
 * because a spin logged in the repeated hour is a real performance that has to
 * be reported once, and picking the wrong side moves it into the wrong day.
 */
export function resolveCivil(rule: ZoneRule, civil: CivilDateTime): CivilResolution {
  const localMs =
    daysFromCivil(civil.year, civil.month, civil.day) * DAY_MS +
    civil.hour * HOUR_MS +
    civil.minute * MINUTE_MS +
    civil.second * 1000;
  if (!rule.observesDaylight) {
    return { kind: 'exact', instant: localMs - rule.standardOffsetMinutes * MINUTE_MS };
  }
  const standard = localMs - rule.standardOffsetMinutes * MINUTE_MS;
  const daylight = localMs - rule.daylightOffsetMinutes * MINUTE_MS;
  const standardValid = offsetAt(rule, standard) === rule.standardOffsetMinutes;
  const daylightValid = offsetAt(rule, daylight) === rule.daylightOffsetMinutes;
  if (standardValid && daylightValid) {
    const first = Math.min(standard, daylight);
    const second = Math.max(standard, daylight);
    return { kind: 'ambiguous', instant: first, later: second };
  }
  if (daylightValid) {
    return { kind: 'exact', instant: daylight };
  }
  if (standardValid) {
    return { kind: 'exact', instant: standard };
  }
  return { kind: 'gap', instant: daylight };
}

export function toInstant(rule: ZoneRule, civil: CivilDateTime): number {
  return resolveCivil(rule, civil).instant;
}

/**
 * The broadcast day.
 *
 * Logs do not run midnight to midnight. A station whose day starts at 05:00
 * files the 02:00 hour of Tuesday morning against Monday, because that is the
 * shift that aired it and the daypart it was sold in. Every rotation figure in
 * the system counts hours this way, so getting it wrong moves turnover as well
 * as the log.
 */
export interface BroadcastDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export function broadcastDayOf(
  rule: ZoneRule,
  instant: number,
  dayStartHour: number,
): BroadcastDay {
  const civil = toCivil(rule, instant);
  if (civil.hour >= dayStartHour) {
    return { year: civil.year, month: civil.month, day: civil.day };
  }
  const previous = civilFromDays(daysFromCivil(civil.year, civil.month, civil.day) - 1);
  return previous;
}

/** Hours are numbered from the start of the broadcast day, not from midnight. */
export function broadcastHourOf(rule: ZoneRule, instant: number, dayStartHour: number): number {
  const civil = toCivil(rule, instant);
  return (civil.hour - dayStartHour + 24) % 24;
}

export function startOfBroadcastDay(
  rule: ZoneRule,
  day: BroadcastDay,
  dayStartHour: number,
): number {
  return toInstant(rule, {
    year: day.year,
    month: day.month,
    day: day.day,
    hour: dayStartHour,
    minute: 0,
    second: 0,
  });
}

/**
 * How many hours the broadcast day holds. Twenty three on the spring forward
 * day and twenty five on the fall back day, and a clock grid that assumes
 * twenty four silently loses or duplicates an hour of music on both.
 */
export function broadcastDayLength(
  rule: ZoneRule,
  day: BroadcastDay,
  dayStartHour: number,
): number {
  const start = startOfBroadcastDay(rule, day, dayStartHour);
  const next = civilFromDays(daysFromCivil(day.year, day.month, day.day) + 1);
  const end = startOfBroadcastDay(rule, next, dayStartHour);
  return Math.round((end - start) / HOUR_MS);
}

export function formatCivil(civil: CivilDateTime): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(civil.year, 4)}-${pad(civil.month)}-${pad(civil.day)} ${pad(civil.hour)}:${pad(civil.minute)}:${pad(civil.second)}`;
}

export function formatBroadcastDay(day: BroadcastDay): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(day.year, 4)}-${pad(day.month)}-${pad(day.day)}`;
}

export const MOUNTAIN: ZoneRule = {
  label: 'US/Mountain',
  standardOffsetMinutes: -420,
  daylightOffsetMinutes: -360,
  observesDaylight: true,
};

export const ARIZONA: ZoneRule = {
  label: 'US/Arizona',
  standardOffsetMinutes: -420,
  daylightOffsetMinutes: -420,
  observesDaylight: false,
};
