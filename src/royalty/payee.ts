/**
 * Who the money goes to.
 *
 * The label owns the master and the payee receives the cheque, and they are
 * often different: a catalogue gets sold, a distributor collects on behalf of an
 * imprint, an artist buys their masters back. The recording carries both, and
 * every figure that leaves the building is grouped by payee rather than by
 * label, because the payee is who the society pays.
 *
 * Reporting by label instead is the mistake this module exists to prevent. It
 * produces a report that balances, reads correctly, names the right recordings,
 * and sends the money to a company that sold the catalogue two years ago.
 */

import { codeFor, info, warning } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { compareText, groupBy } from '../util/ordering.js';
import type { Isrc } from '../util/ids.js';
import type { Spin } from './spin.js';

const PAY = (n: number): string => codeFor('royalty', n);

export const PAYEE_DIFFERS = PAY(40);
export const PAYEE_MISSING = PAY(41);
export const SPLIT_CATALOGUE = PAY(42);

export interface PayeeTotal {
  readonly payee: string;
  /** Labels that pay through this payee, which is often more than one. */
  readonly labels: readonly string[];
  readonly spins: number;
  readonly recordings: number;
  /** Total time performed, counting only what was measured. */
  readonly performed: number;
}

export function payeeOf(spin: Spin): string {
  const payee = spin.recording.payee.trim();
  return payee.length > 0 ? payee : spin.recording.label.trim();
}

export function totalsByPayee(spins: readonly Spin[]): PayeeTotal[] {
  const grouped = groupBy(spins, (spin) => payeeOf(spin));
  const totals: PayeeTotal[] = [];
  for (const [payee, list] of grouped) {
    const labels = [...new Set(list.map((spin) => spin.recording.label))].sort(compareText);
    const recordings = new Set(list.map((spin) => spin.isrc));
    totals.push({
      payee,
      labels,
      spins: list.length,
      recordings: recordings.size,
      performed: list.reduce((sum, spin) => sum + (spin.length ?? 0), 0),
    });
  }
  return totals.sort((a, b) => b.spins - a.spins || compareText(a.payee, b.payee));
}

export function totalsByLabel(spins: readonly Spin[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const spin of spins) {
    const label = spin.recording.label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

export function auditPayees(spins: readonly Spin[]): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (const spin of spins) {
    if (payeeOf(spin).length === 0) {
      problems.push(
        warning(PAYEE_MISSING, spin.isrc, 'has neither a payee nor a label, so nobody can be paid'),
      );
      continue;
    }
    const key = `${spin.recording.label}=>${spin.recording.payee}`;
    if (spin.recording.payee !== spin.recording.label && !seen.has(key)) {
      seen.add(key);
      problems.push(
        info(PAYEE_DIFFERS, spin.recording.label, 'pays through a different company', {
          payee: spin.recording.payee,
        }),
      );
    }
  }
  problems.push(...splitCatalogues(spins));
  return problems;
}

/**
 * One label paying through two payees. Legitimate when a catalogue was split by
 * territory or by era, and a data error the rest of the time, so it is reported
 * either way and decided by somebody who knows.
 */
export function splitCatalogues(spins: readonly Spin[]): Problem[] {
  const payeesByLabel = new Map<string, Set<string>>();
  for (const spin of spins) {
    const payees = payeesByLabel.get(spin.recording.label);
    if (payees === undefined) {
      payeesByLabel.set(spin.recording.label, new Set([payeeOf(spin)]));
    } else {
      payees.add(payeeOf(spin));
    }
  }
  const problems: Problem[] = [];
  for (const [label, payees] of payeesByLabel) {
    if (payees.size > 1) {
      problems.push(
        warning(SPLIT_CATALOGUE, label, 'pays through more than one company', {
          payees: [...payees].sort().join(' and '),
        }),
      );
    }
  }
  return problems;
}

/** Recordings owed to a payee, for the detail pages of the report. */
export function recordingsFor(spins: readonly Spin[], payee: string): Isrc[] {
  const isrcs = new Set<Isrc>();
  for (const spin of spins) {
    if (payeeOf(spin) === payee) {
      isrcs.add(spin.isrc);
    }
  }
  return [...isrcs].sort();
}

/** The share of the whole quarter one payee accounts for. */
export function shareOf(totals: readonly PayeeTotal[], payee: string): number {
  const all = totals.reduce((sum, total) => sum + total.spins, 0);
  if (all === 0) {
    return 0;
  }
  const found = totals.find((total) => total.payee === payee);
  return (found?.spins ?? 0) / all;
}
