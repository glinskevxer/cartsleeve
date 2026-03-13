/**
 * Reporting operations.
 *
 * The read side. Nothing here changes anything, and that is worth enforcing
 * rather than assuming: a report that quietly recorded having been run would
 * make two runs of the same report give different answers, which is the one
 * thing a report must never do.
 *
 * It does write to the journal, but only that a report was produced and with
 * what inputs, never anything a later replay would apply. That record exists so
 * a question about a filing six months later can be answered with the figures
 * that were actually sent rather than with today's recomputation of them.
 */

import { codeFor, info } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import type { BroadcastDay } from '../util/time.js';
import type { Library } from '../library/library.js';
import type { CreditPolicy } from '../domain/station.js';
import type { Airing } from '../aired/rebuild.js';
import { rebuildAired } from '../aired/rebuild.js';
import type { EventStream } from '../aired/event.js';
import { reconcile } from '../aired/reconcile.js';
import type { Reconciliation } from '../aired/reconcile.js';
import type { PlannedStart } from '../aired/timing.js';
import { renderReconciliation } from '../aired/report.js';
import { spinsFrom } from '../royalty/spin.js';
import type { SpinOutcome } from '../royalty/spin.js';
import { buildQuarterly } from '../royalty/quarterly.js';
import type { QuarterlyReport, ReportPeriod } from '../royalty/quarterly.js';
import { renderQuarterly } from '../royalty/render.js';
import { validateReport } from '../royalty/validate.js';
import type { ValidationOutcome } from '../royalty/validate.js';
import { measureAgreement } from '../royalty/agreement.js';
import type { Agreement } from '../royalty/agreement.js';
import type { Sample } from '../royalty/sampling.js';
import { auditSample } from '../royalty/sampling.js';
import type { Journal } from '../store/append.js';
import { readNumber, readString } from '../store/journal.js';

const RPT = (n: number): string => codeFor('store', n);

export const REPORT_RUN = RPT(40);

export interface ReconcileRequest {
  readonly planned: readonly PlannedStart[];
  readonly stream: EventStream;
  readonly library: Library;
  readonly station: string;
  readonly day: BroadcastDay;
  readonly hour: string;
}

export interface ReconcileResult {
  readonly reconciliation: Reconciliation;
  readonly lines: readonly string[];
  readonly problems: readonly Problem[];
}

export interface FilingRequest {
  readonly airings: readonly Airing[];
  readonly library: Library;
  readonly station: string;
  readonly period: ReportPeriod;
  readonly policy: CreditPolicy;
  readonly sample?: Sample;
}

export interface FilingResult {
  readonly report: QuarterlyReport;
  readonly spins: SpinOutcome;
  readonly agreement: Agreement;
  readonly validation: ValidationOutcome;
  readonly lines: readonly string[];
  readonly problems: readonly Problem[];
}

export class ReportService {
  constructor(private readonly journal: Journal) {}

  /** Reconcile one hour and render it. */
  reconcileHour(request: ReconcileRequest): ReconcileResult {
    const rebuild = rebuildAired(request.stream);
    const reconciliation = reconcile({
      planned: request.planned,
      stream: request.stream,
      rebuild,
      library: request.library,
    });
    const lines = renderReconciliation(reconciliation, {
      station: request.station,
      day: `${request.day.year}-${request.day.month}-${request.day.day}`,
      hour: request.hour,
    });
    this.journal.append(
      'report.reconciled',
      {
        day: `${request.day.year}-${request.day.month}-${request.day.day}`,
        hour: request.hour,
        dropped: reconciliation.dropped.length,
        unscheduled: reconciliation.unscheduled.length,
      },
      Date.now(),
    );
    return { reconciliation, lines, problems: rebuild.problems };
  }

  /**
   * Build a filing, check it, and render it.
   *
   * Everything is returned rather than only the rendered page, because the
   * caller deciding whether to send it needs the validation and the caller
   * explaining it to an auditor needs the agreement.
   */
  buildFiling(request: FilingRequest): FilingResult {
    const spins = spinsFrom(request.airings, request.library);
    const report = buildQuarterly({
      station: request.station,
      period: request.period,
      spins: spins.spins,
    });
    const agreement = measureAgreement(spins.spins, request.policy);
    const validation = validateReport(report, request.sample);
    const lines = renderQuarterly(report, request.sample);
    this.journal.append(
      'report.filed',
      {
        period: request.period.label,
        recordings: report.recordings,
        spins: report.totalSpins,
        filable: validation.filable ? 'yes' : 'no',
      },
      Date.now(),
    );
    return {
      report,
      spins,
      agreement,
      validation,
      lines,
      problems: [
        ...spins.problems,
        ...validation.problems,
        ...(request.sample === undefined ? [] : auditSample(request.sample)),
        info(REPORT_RUN, request.period.label, 'was produced', {
          lines: report.lines.length,
          filable: validation.filable ? 'yes' : 'no',
        }),
      ],
    };
  }

  /** What was filed and when, for a question asked six months later. */
  filingHistory(): { period: string; spins: number; filable: string }[] {
    return this.journal.ofKind('report.filed').map((record) => ({
      period: readString(record.payload, 'period'),
      spins: readNumber(record.payload, 'spins'),
      filable: readString(record.payload, 'filable'),
    }));
  }
}
