/**
 * Snapshots.
 *
 * A journal that is never summarised has to be replayed from the beginning every
 * time the process starts, and after two years of scheduling that is a minute of
 * startup before the station can be told what plays next.
 *
 * A snapshot is the derived state as it stood at one sequence number, plus that
 * number. Replay then loads the newest snapshot and applies only the records
 * after it. The journal is never truncated, so the whole history stays available
 * for the question that made an event log worth having.
 *
 * The one rule that makes this safe is that a snapshot is written to a new name
 * and never over an old one. A snapshot half written over a good one is a store
 * with no valid state at all, and the failure only shows up on the next restart,
 * which may be weeks later.
 */

import { codeFor, error, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';
import type { Storage } from './storage.js';

const SNP = (n: number): string => codeFor('store', n);

export const BAD_SNAPSHOT = SNP(10);
export const AHEAD_OF_JOURNAL = SNP(11);

export const SNAPSHOT_PREFIX = 'snapshot-';
export const SNAPSHOT_SUFFIX = '.json';

export interface Snapshot<T> {
  /** The journal sequence this state includes up to, inclusive. */
  readonly throughSequence: number;
  readonly at: number;
  readonly state: T;
}

export function snapshotName(sequence: number): string {
  return `${SNAPSHOT_PREFIX}${String(sequence).padStart(12, '0')}${SNAPSHOT_SUFFIX}`;
}

export function sequenceOfName(name: string): number | undefined {
  if (!name.startsWith(SNAPSHOT_PREFIX) || !name.endsWith(SNAPSHOT_SUFFIX)) {
    return undefined;
  }
  const digits = name.slice(SNAPSHOT_PREFIX.length, name.length - SNAPSHOT_SUFFIX.length);
  const parsed = Number.parseInt(digits, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function encodeSnapshot<T>(snapshot: Snapshot<T>): string {
  return JSON.stringify(snapshot);
}

export function decodeSnapshot<T>(text: string): Result<Snapshot<T>, Problem> {
  if (text.length === 0) {
    return err(error(BAD_SNAPSHOT, 'snapshot', 'is empty'));
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') {
      return err(error(BAD_SNAPSHOT, 'snapshot', 'is not an object'));
    }
    const candidate = parsed as Partial<Snapshot<T>>;
    if (!Number.isInteger(candidate.throughSequence) || !Number.isInteger(candidate.at)) {
      return err(error(BAD_SNAPSHOT, 'snapshot', 'has no usable sequence or timestamp'));
    }
    if (candidate.state === undefined) {
      return err(error(BAD_SNAPSHOT, 'snapshot', 'carries no state'));
    }
    return ok(candidate as Snapshot<T>);
  } catch {
    return err(error(BAD_SNAPSHOT, 'snapshot', 'is not readable json'));
  }
}

/**
 * Write a snapshot under its own name. Never over an existing one, so a write
 * that is interrupted leaves every earlier snapshot intact.
 */
export function writeSnapshot<T>(storage: Storage, snapshot: Snapshot<T>): string {
  const name = snapshotName(snapshot.throughSequence);
  storage.write(name, encodeSnapshot(snapshot));
  return name;
}

/** Snapshot names in the store, oldest first. */
export function snapshotNames(storage: Storage): string[] {
  return storage
    .names()
    .filter((name) => sequenceOfName(name) !== undefined)
    .sort((a, b) => (sequenceOfName(a) ?? 0) - (sequenceOfName(b) ?? 0));
}

/** The newest readable snapshot, skipping any that will not decode. */
export function latestSnapshot<T>(storage: Storage): {
  snapshot?: Snapshot<T>;
  problems: Problem[];
} {
  const problems: Problem[] = [];
  const names = snapshotNames(storage).reverse();
  for (const name of names) {
    const decoded = decodeSnapshot<T>(storage.read(name));
    if (decoded.ok) {
      return { snapshot: decoded.value, problems };
    }
    problems.push({ ...decoded.error, subject: name });
  }
  return { problems };
}

/**
 * A snapshot claiming to include records the journal does not have is a store
 * that lost its journal tail, which needs a person rather than a fallback.
 */
export function checkAgainstJournal<T>(
  snapshot: Snapshot<T>,
  journalLength: number,
): Problem | undefined {
  if (snapshot.throughSequence > journalLength) {
    return warning(
      AHEAD_OF_JOURNAL,
      snapshotName(snapshot.throughSequence),
      'includes records the journal does not have',
      { snapshot: snapshot.throughSequence, journal: journalLength },
    );
  }
  return undefined;
}

/** Old snapshots, so a caller can decide whether to keep them. */
export function supersededNames(storage: Storage, keep: number): string[] {
  const names = snapshotNames(storage);
  return names.slice(0, Math.max(0, names.length - Math.max(0, keep)));
}
