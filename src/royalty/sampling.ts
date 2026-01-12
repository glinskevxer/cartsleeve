/**
 * Census and sampled reporting.
 *
 * A society either wants every performance in the quarter, or it wants a sample
 * of named days and scales the result up itself. Small stations file sampled
 * because a census is a lot of lines; large ones file census because the scaling
 * error on a sample costs them more than the paperwork.
 *
 * Sampling is where a report quietly goes wrong. The scale factor is days in the
 * period over days in the sample, which is right only if the sample is
 * representative, and a sample that happens to fall on a bank holiday week is
 * not. So the sample is chosen by rule rather than by convenience, the factor is
 * carried on the report rather than applied silently, and the report says which
 * days it covered so a society can check.
 *
 * Scaling is also why a sampled report must never round per line. A recording
 * with one spin in a two week sample scales to six and a half spins over a
 * quarter, and rounding each of two hundred such lines up loses the station a
 * hundred spins it did not perform.
 */

import { codeFor, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { daysFromCivil } from '../util/time.js';
import type { BroadcastDay } from '../util/time.js';
import type { ReportingMode } from '../domain/station.js';
import type { Spin } from './spin.js';

const SAM = (n: number): string => codeFor('royalty', n);

export const SAMPLE_TOO_SMALL = SAM(70);
export const SAMPLE_EMPTY = SAM(71);
export const SAMPLE_UNEVEN = SAM(72);

/** Below this share of the period a sample cannot carry a quarter. */
export const MINIMUM_SAMPLE_SHARE = 0.05;

export interface Sample {
  readonly mode: ReportingMode;
  /** The days the sample covers, as day ordinals. */
  readonly days: readonly number[];
  readonly periodDays: number;
  /** What a sampled figure is multiplied by. One for a census. */
  readonly factor: number;
}

function ordinal(day: BroadcastDay): number {
  return daysFromCivil(day.year, day.month, day.day);
}

export function periodLength(from: BroadcastDay, to: BroadcastDay): number {
  return ordinal(to) - ordinal(from) + 1;
}

export function censusSample(from: BroadcastDay, to: BroadcastDay): Sample {
  const length = periodLength(from, to);
  return {
    mode: 'census',
    days: Array.from({ length }, (_, index) => ordinal(from) + index),
    periodDays: length,
    factor: 1,
  };
}

/**
 * A sample of whole weeks, evenly spaced through the period.
 *
 * Whole weeks rather than scattered days, because airplay has a weekly shape and
 * a sample of Tuesdays reports a station that never plays the weekend rotation.
 */
export function weeklySample(from: BroadcastDay, to: BroadcastDay, weeks: number): Sample {
  const length = periodLength(from, to);
  const start = ordinal(from);
  const wanted = Math.max(0, Math.trunc(weeks));
  const days: number[] = [];
  if (wanted > 0 && length > 0) {
    const stride = Math.max(7, Math.floor(length / wanted));
    for (let index = 0; index < wanted; index += 1) {
      const weekStart = start + index * stride;
      for (let day = 0; day < 7; day += 1) {
        const at = weekStart + day;
        if (at < start + length) {
          days.push(at);
        }
      }
    }
  }
  const sampled = [...new Set(days)].sort((a, b) => a - b);
  return {
    mode: 'sampled',
    days: sampled,
    periodDays: length,
    factor: sampled.length === 0 ? 0 : length / sampled.length,
  };
}

/** Whether a spin falls inside the sample, by the day it started on. */
export function inSample(sample: Sample, day: BroadcastDay): boolean {
  return sample.days.includes(ordinal(day));
}

export function spinsInSample(
  spins: readonly Spin[],
  sample: Sample,
  dayOf: (spin: Spin) => BroadcastDay,
): Spin[] {
  if (sample.mode === 'census') {
    return [...spins];
  }
  return spins.filter((spin) => inSample(sample, dayOf(spin)));
}

/**
 * Scale a sampled figure up to the period. Never rounded here: the caller
 * rounds once, on the total, or the error compounds across every line.
 */
export function scaled(sample: Sample, value: number): number {
  return value * sample.factor;
}

export function auditSample(sample: Sample): Problem[] {
  if (sample.mode === 'census') {
    return [];
  }
  const problems: Problem[] = [];
  if (sample.days.length === 0) {
    problems.push(
      warning(SAMPLE_EMPTY, 'sample', 'covers no days at all, so nothing can be filed'),
    );
    return problems;
  }
  const share = sample.days.length / sample.periodDays;
  if (share < MINIMUM_SAMPLE_SHARE) {
    problems.push(
      warning(SAMPLE_TOO_SMALL, 'sample', 'covers too little of the period to carry it', {
        days: sample.days.length,
        period: sample.periodDays,
        share: Math.round(share * 100),
      }),
    );
  }
  if (sample.days.length % 7 !== 0) {
    problems.push(
      warning(
        SAMPLE_UNEVEN,
        'sample',
        'is not whole weeks, so it misses part of the weekly shape',
        {
          days: sample.days.length,
        },
      ),
    );
  }
  return problems;
}

/** The days the sample covers, back as broadcast days, for the report header. */
export function describeSample(sample: Sample): string {
  if (sample.mode === 'census') {
    return `census of ${sample.periodDays} days`;
  }
  return `sample of ${sample.days.length} days in ${sample.periodDays}, scaled by ${sample.factor.toFixed(2)}`;
}
