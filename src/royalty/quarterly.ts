/**
 * The quarterly performance report.
 *
 * What the station files. One line per recording per artist credited on it,
 * carrying the ISRC, the payee, the number of spins and the time performed.
 * A society reads it, matches the ISRCs against its own registry, and pays.
 *
 * Two things about the format are not negotiable and both are easy to get wrong.
 * Every line must carry an ISRC, because a line without one cannot be matched
 * and is simply discarded on receipt with no notice to the station. And the
 * spin counts must be whole numbers at the recording level even though the
 * credit splits are fractions, so the rounding happens once, at the end, on the
 * total rather than on each share.
 */

import { codeFor } from '../util/problem.js';
import { compareText } from '../util/ordering.js';
import { formatIsrc } from '../util/ids.js';
import type { Isrc } from '../util/ids.js';
import type { BroadcastDay } from '../util/time.js';
import { payeeOf } from './payee.js';
import type { Spin } from './spin.js';
import { splitAll } from './split.js';

export const REPORT_CODE = codeFor('royalty', 50);

export interface ReportPeriod {
  readonly from: BroadcastDay;
  readonly to: BroadcastDay;
  readonly label: string;
}

export interface ReportLine {
  readonly isrc: Isrc;
  /** As it goes on the wire, hyphenated. */
  readonly formattedIsrc: string;
  readonly title: string;
  readonly artist: string;
  readonly featured: boolean;
  readonly label: string;
  readonly payee: string;
  /** Whole spins of the recording, not of this artist's share. */
  readonly spins: number;
  /** This artist's share of those spins, as parts over a denominator. */
  readonly parts: number;
  readonly of: number;
  /** Total measured seconds performed. */
  readonly seconds: number;
}

export interface QuarterlyReport {
  readonly station: string;
  readonly period: ReportPeriod;
  readonly lines: readonly ReportLine[];
  readonly totalSpins: number;
  readonly totalSeconds: number;
  readonly recordings: number;
}

export interface QuarterlyInput {
  readonly station: string;
  readonly period: ReportPeriod;
  readonly spins: readonly Spin[];
}

interface Accumulated {
  readonly isrc: Isrc;
  spins: number;
  millis: number;
  title: string;
  label: string;
  payee: string;
}

/**
 * Build the report.
 *
 * Spins are totalled per recording first, then the credit shares are attached,
 * so the recording level count is a whole number and each artist line carries
 * its share of it rather than a rounded fraction of its own.
 */
export function buildQuarterly(input: QuarterlyInput): QuarterlyReport {
  const byRecording = new Map<Isrc, Accumulated>();
  for (const spin of input.spins) {
    const found = byRecording.get(spin.isrc);
    if (found === undefined) {
      byRecording.set(spin.isrc, {
        isrc: spin.isrc,
        spins: 1,
        millis: spin.length ?? 0,
        title: spin.recording.titleKey,
        label: spin.recording.label,
        payee: payeeOf(spin),
      });
      continue;
    }
    found.spins += 1;
    found.millis += spin.length ?? 0;
  }

  const shares = splitAll(input.spins);
  const seen = new Set<string>();
  const lines: ReportLine[] = [];
  for (const share of shares) {
    const key = `${share.isrc}:${share.artistKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const totals = byRecording.get(share.isrc);
    if (totals === undefined) {
      continue;
    }
    lines.push({
      isrc: share.isrc,
      formattedIsrc: formatIsrc(share.isrc),
      title: totals.title,
      artist: share.artistName,
      featured: share.featured,
      label: totals.label,
      payee: totals.payee,
      spins: totals.spins,
      parts: share.parts,
      of: share.of,
      seconds: Math.round(totals.millis / 1000),
    });
  }

  lines.sort(
    (a, b) =>
      compareText(a.payee, b.payee) ||
      compareText(a.title, b.title) ||
      Number(a.featured) - Number(b.featured) ||
      compareText(a.artist, b.artist),
  );

  return {
    station: input.station,
    period: input.period,
    lines,
    totalSpins: [...byRecording.values()].reduce((sum, each) => sum + each.spins, 0),
    totalSeconds: Math.round(
      [...byRecording.values()].reduce((sum, each) => sum + each.millis, 0) / 1000,
    ),
    recordings: byRecording.size,
  };
}

/** Lines owed to one payee, for a per company statement. */
export function linesFor(report: QuarterlyReport, payee: string): ReportLine[] {
  return report.lines.filter((line) => line.payee === payee);
}

/** Every payee named in the report, in the order the lines run. */
export function payees(report: QuarterlyReport): string[] {
  return [...new Set(report.lines.map((line) => line.payee))];
}

/**
 * Whether the recording level spin counts add up to the total.
 *
 * A report where they do not has double counted a recording, which is the
 * failure a society notices and rejects the whole filing over.
 */
export function balances(report: QuarterlyReport): boolean {
  const perRecording = new Map<Isrc, number>();
  for (const line of report.lines) {
    perRecording.set(line.isrc, line.spins);
  }
  const summed = [...perRecording.values()].reduce((sum, spins) => sum + spins, 0);
  return summed === report.totalSpins;
}

export function describePeriod(period: ReportPeriod): string {
  const format = (day: BroadcastDay): string =>
    `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
  return `${period.label} (${format(period.from)} to ${format(period.to)})`;
}
