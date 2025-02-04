/**
 * A station.
 *
 * Everything downstream is parameterised on one of these. Two stations in the
 * same group sharing a library will schedule differently because their day
 * starts at a different hour, their spot ceiling is different, and one of them
 * counts featured artists for separation while the other does not.
 */

import { parseCallSign } from '../util/ids.js';
import type { CallSign } from '../util/ids.js';
import { fromMinutes } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { collect, err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';
import { Check, take } from '../util/check.js';
import { MOUNTAIN } from '../util/time.js';
import type { ZoneRule } from '../util/time.js';
import { codeFor } from '../util/problem.js';
import type { Problem } from '../util/problem.js';

/**
 * Whether a featured credit counts as a play by that artist for separation.
 *
 * This is the single most consequential switch on the record. Royalty always
 * splits a collaboration across every credited artist, so under `strict` the
 * separation rules and the performance report agree about what a play is, and
 * under `billed` they do not. Stations choose `billed` because strict credit
 * makes a heavy feature artist unschedulable, and then wonder why the report
 * and the log disagree.
 */
export type CreditPolicy = 'billed' | 'strict';

export type ReportingMode = 'census' | 'sampled';

export interface Station {
  readonly callSign: CallSign;
  readonly name: string;
  readonly format: string;
  readonly zone: ZoneRule;
  /** The hour the broadcast day starts, 0 to 23. */
  readonly dayStartHour: number;
  /** The most commercial time an hour may carry. */
  readonly spotCeiling: Tenths;
  readonly creditPolicy: CreditPolicy;
  readonly reportingMode: ReportingMode;
}

export interface StationInput {
  readonly callSign: string;
  readonly name: string;
  readonly format: string;
  readonly zone?: ZoneRule;
  readonly dayStartHour?: number;
  readonly spotMinutes?: number;
  readonly creditPolicy?: CreditPolicy;
  readonly reportingMode?: ReportingMode;
}

const STATION = (n: number): string => codeFor('library', n);

export function makeStation(input: StationInput): Result<Station, Problem[]> {
  const check = new Check();
  const sign = check.require(
    parseCallSign(input.callSign),
    STATION(1),
    input.callSign,
    (problem) => problem.reason,
  );
  const name = input.name.trim();
  check.ensure(name.length > 0, STATION(2), input.callSign, 'has no name');
  const dayStartHour = input.dayStartHour ?? 0;
  check.ensure(
    Number.isInteger(dayStartHour) && dayStartHour >= 0 && dayStartHour <= 23,
    STATION(3),
    input.callSign,
    'has a day start hour outside 0 to 23',
    { given: dayStartHour },
  );
  const spotMinutes = input.spotMinutes ?? 12;
  check.ensure(
    spotMinutes >= 0 && spotMinutes <= 60,
    STATION(4),
    input.callSign,
    'has a spot ceiling outside an hour',
    { given: spotMinutes },
  );
  return check.result(() => ({
    callSign: take(sign, 'callSign'),
    name,
    format: input.format.trim(),
    zone: input.zone ?? MOUNTAIN,
    dayStartHour,
    spotCeiling: fromMinutes(spotMinutes),
    creditPolicy: input.creditPolicy ?? 'billed',
    reportingMode: input.reportingMode ?? 'census',
  }));
}

/** Build a whole group, keeping every problem across every station. */
export function makeStations(inputs: readonly StationInput[]): Result<Station[], Problem[]> {
  const gathered = collect(inputs.map((input) => makeStation(input)));
  return gathered.ok ? ok(gathered.value) : err(gathered.error.flat());
}

export function countsFeatured(station: Station): boolean {
  return station.creditPolicy === 'strict';
}

export function describeStation(station: Station): string {
  return `${station.callSign} ${station.name} (${station.format}, day starts ${String(station.dayStartHour).padStart(2, '0')}:00 ${station.zone.label})`;
}
