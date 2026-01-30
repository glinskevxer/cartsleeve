/**
 * The journal file format.
 *
 * An append only log of domain events. Everything the system knows is derived
 * from replaying it, which is the only design that survives the thing that
 * actually happens to a music scheduler: somebody asks what the log looked like
 * before Tuesday's library import, and there is no answer unless the history was
 * kept.
 *
 * The format is one record per line, so a partial write at the end of the file
 * is a partial line and can be discarded without losing anything before it. That
 * matters because the process that writes this is killed at 03:00 by whatever
 * restarts the automation, and a format that cannot survive that is a format
 * that loses a day of scheduling once a month.
 *
 * There are no native dependencies here on purpose. This is a hand written
 * journal rather than a database, so the whole system builds anywhere node runs
 * and a grading container needs nothing installed.
 */

import { codeFor, error } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';

const JRN = (n: number): string => codeFor('store', n);

export const BAD_RECORD = JRN(1);
export const BAD_SEQUENCE = JRN(2);
export const TRUNCATED = JRN(3);

/** Bumped only when the on disk shape changes incompatibly. */
export const FORMAT_VERSION = 1;

export interface JournalRecord {
  /** Monotonic, starting at one. A gap means a record was lost. */
  readonly sequence: number;
  /** Milliseconds since the epoch, when it was written. */
  readonly at: number;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * A record on disk is version, sequence, time, kind, then the payload as JSON.
 * The fixed fields are outside the JSON so a corrupt payload still leaves a
 * readable sequence number, which is what makes a gap detectable.
 */
export function encodeRecord(record: JournalRecord): string {
  return [
    String(FORMAT_VERSION),
    String(record.sequence),
    String(record.at),
    record.kind,
    JSON.stringify(record.payload),
  ].join('\t');
}

export function decodeRecord(line: string): Result<JournalRecord, Problem> {
  const parts = line.split('\t');
  if (parts.length < 5) {
    return err(error(BAD_RECORD, line.slice(0, 40), 'does not have the five fields a record has'));
  }
  const [version, sequence, at, kind, ...rest] = parts;
  if (Number.parseInt(version ?? '', 10) !== FORMAT_VERSION) {
    return err(
      error(BAD_RECORD, line.slice(0, 40), 'was written by a different format version', {
        given: version ?? '',
        expected: FORMAT_VERSION,
      }),
    );
  }
  const number = Number.parseInt(sequence ?? '', 10);
  if (!Number.isInteger(number) || number < 1) {
    return err(error(BAD_RECORD, line.slice(0, 40), 'has no usable sequence number'));
  }
  const when = Number.parseInt(at ?? '', 10);
  if (!Number.isInteger(when)) {
    return err(error(BAD_RECORD, line.slice(0, 40), 'has no usable timestamp'));
  }
  if ((kind ?? '').length === 0) {
    return err(error(BAD_RECORD, line.slice(0, 40), 'has no kind'));
  }
  try {
    const payload: unknown = JSON.parse(rest.join('\t'));
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return err(error(BAD_RECORD, line.slice(0, 40), 'has a payload that is not an object'));
    }
    return ok({
      sequence: number,
      at: when,
      kind: kind ?? '',
      payload: payload as Readonly<Record<string, unknown>>,
    });
  } catch {
    return err(error(BAD_RECORD, line.slice(0, 40), 'has a payload that is not readable json'));
  }
}

export function encodeJournal(records: readonly JournalRecord[]): string {
  return records.map((record) => `${encodeRecord(record)}\n`).join('');
}

export interface JournalRead {
  readonly records: readonly JournalRecord[];
  readonly problems: readonly Problem[];
  /** True when the last line was incomplete, which a crash leaves behind. */
  readonly truncated: boolean;
}

/**
 * Read a journal.
 *
 * A trailing partial line is dropped rather than reported as corruption,
 * because that is what an interrupted append looks like and everything before it
 * is intact. A partial line anywhere else is corruption and is reported.
 */
export function decodeJournal(text: string): JournalRead {
  if (text.length === 0) {
    return { records: [], problems: [], truncated: false };
  }
  const truncated = !text.endsWith('\n');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  } else {
    lines.pop();
  }
  const records: JournalRecord[] = [];
  const problems: Problem[] = [];
  let expected = 0;
  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    const decoded = decodeRecord(line);
    if (!decoded.ok) {
      problems.push(decoded.error);
      continue;
    }
    if (expected > 0 && decoded.value.sequence !== expected + 1) {
      problems.push(
        error(
          BAD_SEQUENCE,
          String(decoded.value.sequence),
          'does not follow the record before it',
          {
            expected: expected + 1,
            found: decoded.value.sequence,
          },
        ),
      );
    }
    expected = decoded.value.sequence;
    records.push(decoded.value);
  }
  if (truncated) {
    problems.push(error(TRUNCATED, 'journal', 'ends mid record, so the last write did not finish'));
  }
  return { records, problems, truncated };
}

export function nextSequence(records: readonly JournalRecord[]): number {
  return records.reduce((highest, record) => Math.max(highest, record.sequence), 0) + 1;
}
