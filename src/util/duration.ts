/**
 * Runtimes.
 *
 * Carts are timed to the tenth of a second and logs are printed to the second,
 * so an hour of music that adds up correctly in tenths can print as an hour
 * that is four seconds short. Every duration in cartsleeve is an integer count
 * of tenths, and the truncation to whole seconds happens once, at the printer.
 */

import { err, ok } from './result.js';
import type { Result } from './result.js';

export type Tenths = number & { readonly __brand: 'Tenths' };

export const TENTHS_PER_SECOND = 10;
export const TENTHS_PER_MINUTE = 600;
export const TENTHS_PER_HOUR = 36_000;

export interface DurationProblem {
  readonly given: string;
  readonly reason: string;
}

export function tenths(value: number): Tenths {
  return Math.round(value) as Tenths;
}

export function fromSeconds(seconds: number): Tenths {
  return tenths(seconds * TENTHS_PER_SECOND);
}

export function fromMinutes(minutes: number): Tenths {
  return tenths(minutes * TENTHS_PER_MINUTE);
}

export function toSeconds(value: Tenths): number {
  return value / TENTHS_PER_SECOND;
}

export function toMillis(value: Tenths): number {
  return value * 100;
}

export function fromMillis(millis: number): Tenths {
  return tenths(millis / 100);
}

export function addDuration(a: Tenths, b: Tenths): Tenths {
  return (a + b) as Tenths;
}

export function subtractDuration(a: Tenths, b: Tenths): Tenths {
  return (a - b) as Tenths;
}

export function sumDurations(values: readonly Tenths[]): Tenths {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total as Tenths;
}

export function scaleDuration(value: Tenths, factor: number): Tenths {
  return tenths(value * factor);
}

const CLOCK_PATTERN = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d))?$/;

/**
 * Parse a runtime as it is written on a rack card. Accepts m:ss, m:ss.t and
 * h:mm:ss. A bare number of seconds is rejected on purpose, because a library
 * import that reads 342 as five and a half minutes rather than three forty two
 * is the kind of error nobody catches until it airs.
 */
export function parseDuration(raw: string): Result<Tenths, DurationProblem> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return err({ given: raw, reason: 'is empty' });
  }
  const match = CLOCK_PATTERN.exec(trimmed);
  if (match === null) {
    return err({ given: raw, reason: 'is not written as m:ss, m:ss.t or h:mm:ss' });
  }
  const hours = match[1] === undefined ? 0 : Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2] ?? '0', 10);
  const seconds = Number.parseInt(match[3] ?? '0', 10);
  const fraction = match[4] === undefined ? 0 : Number.parseInt(match[4], 10);
  if (seconds > 59) {
    return err({ given: raw, reason: `has ${seconds} seconds` });
  }
  if (hours > 0 && minutes > 59) {
    return err({ given: raw, reason: `has ${minutes} minutes` });
  }
  return ok(
    (hours * TENTHS_PER_HOUR +
      minutes * TENTHS_PER_MINUTE +
      seconds * TENTHS_PER_SECOND +
      fraction) as Tenths,
  );
}

export interface DurationParts {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly fraction: number;
  readonly negative: boolean;
}

export function durationParts(value: Tenths): DurationParts {
  const negative = value < 0;
  const magnitude = Math.abs(value);
  return {
    hours: Math.floor(magnitude / TENTHS_PER_HOUR),
    minutes: Math.floor((magnitude % TENTHS_PER_HOUR) / TENTHS_PER_MINUTE),
    seconds: Math.floor((magnitude % TENTHS_PER_MINUTE) / TENTHS_PER_SECOND),
    fraction: magnitude % TENTHS_PER_SECOND,
    negative,
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** m:ss, the form printed on a log line. Tenths are dropped, never rounded. */
export function formatDuration(value: Tenths): string {
  const parts = durationParts(value);
  const sign = parts.negative ? '-' : '';
  const minutes = parts.hours * 60 + parts.minutes;
  return `${sign}${minutes}:${pad(parts.seconds)}`;
}

/** m:ss.t, the form shown on a rack card and in the library editor. */
export function formatPrecise(value: Tenths): string {
  const parts = durationParts(value);
  const sign = parts.negative ? '-' : '';
  const minutes = parts.hours * 60 + parts.minutes;
  return `${sign}${minutes}:${pad(parts.seconds)}.${parts.fraction}`;
}

/** h:mm:ss, the form an hour total or a quarterly report uses. */
export function formatLong(value: Tenths): string {
  const parts = durationParts(value);
  const sign = parts.negative ? '-' : '';
  return `${sign}${parts.hours}:${pad(parts.minutes)}:${pad(parts.seconds)}`;
}

/**
 * The gap between what an hour really runs and what its log prints. Summing
 * tenths and then truncating is not the same as truncating each cart and then
 * summing, and the difference is what makes an hour come out of the automation
 * short even though every line looks right.
 */
export function printedDrift(values: readonly Tenths[]): Tenths {
  const exact = sumDurations(values);
  let truncated = 0;
  for (const value of values) {
    truncated += Math.trunc(value / TENTHS_PER_SECOND) * TENTHS_PER_SECOND;
  }
  return (exact - truncated) as Tenths;
}
