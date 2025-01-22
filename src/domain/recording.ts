/**
 * Recordings.
 *
 * A cart is a thing on a rack. A recording is the master behind it, and they
 * are not the same thing, which matters in both directions.
 *
 * One recording can sit behind several carts. A station cards the same master
 * twice when it wants it in two categories, a gold copy and a Christmas copy,
 * and the automation treats those as two carts. Royalty does not: both fire the
 * same ISRC and both are the same performance to a rights society. So a
 * recording separation rule that compares cart numbers will happily play the
 * same master twice in an hour.
 *
 * One cart can also carry a recording that is not unique. A cover is a different
 * recording of the same title, and the title separation rule has to see them as
 * the same while the recording rule sees them as different.
 */

import { formatIsrc, parseIsrc } from '../util/ids.js';
import type { Isrc } from '../util/ids.js';
import { compareText } from '../util/ordering.js';
import { codeFor, error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';

export interface Recording {
  readonly isrc: Isrc;
  /** The label that owns the master and is paid for it. */
  readonly label: string;
  /** Who the money actually goes to, which is often not the label. */
  readonly payee: string;
  readonly releaseYear: number;
  /** Normalised title, used by the title separation rule across covers. */
  readonly titleKey: string;
}

export interface RecordingInput {
  readonly isrc: string;
  readonly title: string;
  readonly label: string;
  readonly payee?: string;
  readonly releaseYear: number;
}

const REC = (n: number): string => codeFor('royalty', n);

/** The earliest year a commercially released recording could plausibly carry. */
export const EARLIEST_RELEASE_YEAR = 1900;

/**
 * Normalise a title so a cover matches the original. Bracketed qualifiers go,
 * because "Jolene (Single Edit)" and "Jolene" are the same title even though
 * they are different recordings, and it is the recording rule's job to tell
 * them apart, not the title rule's.
 */
export function titleKey(title: string): string {
  return title
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(/\s*[-/]\s*(?:single|radio|album|live|remaster(?:ed)?)\b.*$/i, ' ')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function makeRecording(
  input: RecordingInput,
  currentYear: number,
): Result<Recording, Problem[]> {
  const problems: Problem[] = [];
  const isrc = parseIsrc(input.isrc);
  if (!isrc.ok) {
    problems.push(error(REC(1), input.isrc, isrc.error.reason));
  }
  const label = input.label.trim();
  if (label.length === 0) {
    problems.push(error(REC(2), input.isrc, 'has no label, so nobody can be paid'));
  }
  const key = titleKey(input.title);
  if (key.length === 0) {
    problems.push(error(REC(3), input.isrc, 'has a title that normalises to nothing'));
  }
  if (
    !Number.isInteger(input.releaseYear) ||
    input.releaseYear < EARLIEST_RELEASE_YEAR ||
    input.releaseYear > currentYear
  ) {
    problems.push(
      error(REC(4), input.isrc, 'has a release year outside anything plausible', {
        given: input.releaseYear,
      }),
    );
  }
  if (problems.length > 0 || !isrc.ok) {
    return err(problems);
  }
  return ok({
    isrc: isrc.value,
    label,
    payee: (input.payee ?? label).trim(),
    releaseYear: input.releaseYear,
    titleKey: key,
  });
}

/**
 * The ISRC carries a year of reference of its own, and it disagreeing with the
 * release year is not an error. A reissue keeps the original ISRC, so the gap
 * is normal on gold and suspicious on a current.
 */
export function auditRecording(recording: Recording, currentYear: number): Problem[] {
  const problems: Problem[] = [];
  if (recording.payee !== recording.label) {
    problems.push(
      warning(REC(10), recording.isrc, 'pays somebody other than the label', {
        label: recording.label,
        payee: recording.payee,
      }),
    );
  }
  if (currentYear - recording.releaseYear <= 2) {
    const reference = Number.parseInt(recording.isrc.slice(5, 7), 10);
    const referenceYear = reference >= 40 ? 1900 + reference : 2000 + reference;
    if (Math.abs(referenceYear - recording.releaseYear) > 2) {
      problems.push(
        warning(REC(11), recording.isrc, 'is a current whose isrc year is far from its release', {
          isrcYear: referenceYear,
          releaseYear: recording.releaseYear,
        }),
      );
    }
  }
  return problems;
}

export function isSameRecording(a: Recording, b: Recording): boolean {
  return a.isrc === b.isrc;
}

/** Same song, different master. This is what a cover is. */
export function isCover(a: Recording, b: Recording): boolean {
  return a.titleKey === b.titleKey && a.isrc !== b.isrc;
}

export function describeRecording(recording: Recording): string {
  return `${formatIsrc(recording.isrc)} ${recording.titleKey} (${recording.label}, ${recording.releaseYear})`;
}

export function compareRecordings(a: Recording, b: Recording): number {
  const byTitle = compareText(a.titleKey, b.titleKey);
  return byTitle !== 0 ? byTitle : compareText(a.isrc, b.isrc);
}
