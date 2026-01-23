/**
 * Checking a filing before it goes out.
 *
 * A rejected filing is not returned with notes. It is refused, the quarter is
 * late, and the station finds out when the money does not arrive. So everything
 * a society is known to reject on is checked here, before anybody sends it.
 *
 * The checks are all cheap and all boring, which is the point. Every one of them
 * exists because a filing was refused over it: a line with no ISRC, a spin count
 * that does not add up, a payee field left blank, a period that does not match
 * the quarter claimed, a report with no lines at all sent in a quarter the
 * station was on air.
 */

import { codeFor, error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { daysFromCivil } from '../util/time.js';
import { balances } from './quarterly.js';
import type { QuarterlyReport, ReportLine } from './quarterly.js';
import { auditSample } from './sampling.js';
import type { Sample } from './sampling.js';

const VAL = (n: number): string => codeFor('royalty', n);

export const MISSING_ISRC = VAL(80);
export const MISSING_PAYEE = VAL(81);
export const MISSING_TITLE = VAL(82);
export const DOES_NOT_BALANCE = VAL(83);
export const EMPTY_FILING = VAL(84);
export const BACKWARDS_PERIOD = VAL(85);
export const ZERO_SPINS = VAL(86);
export const DUPLICATE_LINE = VAL(87);

/** A twelve character ISRC is the only thing a society can match on. */
export const ISRC_LENGTH = 12;

export interface ValidationOutcome {
  readonly problems: readonly Problem[];
  readonly fatal: number;
  readonly filable: boolean;
}

function lineProblems(line: ReportLine, index: number): Problem[] {
  const problems: Problem[] = [];
  const where = `line ${index + 1}`;
  if (line.isrc.length !== ISRC_LENGTH) {
    problems.push(
      error(MISSING_ISRC, where, 'has no usable isrc and will be discarded on receipt', {
        given: line.isrc,
      }),
    );
  }
  if (line.payee.trim().length === 0) {
    problems.push(error(MISSING_PAYEE, where, 'names nobody to pay', { isrc: line.isrc }));
  }
  if (line.title.trim().length === 0) {
    problems.push(warning(MISSING_TITLE, where, 'has no title', { isrc: line.isrc }));
  }
  if (line.spins <= 0) {
    problems.push(
      error(ZERO_SPINS, where, 'claims no spins at all', { isrc: line.isrc, spins: line.spins }),
    );
  }
  return problems;
}

export function validateReport(report: QuarterlyReport, sample?: Sample): ValidationOutcome {
  const problems: Problem[] = [];

  for (const [index, line] of report.lines.entries()) {
    problems.push(...lineProblems(line, index));
  }

  const seen = new Set<string>();
  for (const [index, line] of report.lines.entries()) {
    const key = `${line.isrc}:${line.artist}`;
    if (seen.has(key)) {
      problems.push(
        error(
          DUPLICATE_LINE,
          `line ${index + 1}`,
          'repeats a recording and artist already claimed',
          {
            isrc: line.isrc,
            artist: line.artist,
          },
        ),
      );
    }
    seen.add(key);
  }

  if (!balances(report)) {
    problems.push(
      error(DOES_NOT_BALANCE, 'report', 'has spin counts that do not add up to its total', {
        total: report.totalSpins,
      }),
    );
  }

  if (report.lines.length === 0) {
    problems.push(
      warning(
        EMPTY_FILING,
        'report',
        'claims nothing at all, which a live station cannot have done',
      ),
    );
  }

  const from = daysFromCivil(
    report.period.from.year,
    report.period.from.month,
    report.period.from.day,
  );
  const to = daysFromCivil(report.period.to.year, report.period.to.month, report.period.to.day);
  if (to < from) {
    problems.push(error(BACKWARDS_PERIOD, 'report', 'covers a period that ends before it starts'));
  }

  if (sample !== undefined) {
    problems.push(...auditSample(sample));
  }

  const fatal = problems.filter((problem) => problem.severity === 'error').length;
  return { problems, fatal, filable: fatal === 0 };
}

/** The lines a society would discard, so a director can fix them by hand. */
export function unfilableLines(report: QuarterlyReport): ReportLine[] {
  return report.lines.filter(
    (line) => line.isrc.length !== ISRC_LENGTH || line.payee.trim().length === 0 || line.spins <= 0,
  );
}
