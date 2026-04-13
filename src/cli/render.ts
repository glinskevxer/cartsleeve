/**
 * Printing an answer.
 *
 * The api answers with a response and the operator wants text, and those are
 * further apart than they look. A response carries three different kinds of
 * body: a report that is already lines and must be printed exactly as it was
 * laid out, a list of rows that wants a table, and a handful of counts that
 * wants a key and value block. Guessing between them here rather than making
 * every handler say which is what keeps the handlers about the domain.
 *
 * Problems print in severity order with the code visible. The code is the only
 * part of a diagnostic an operator can look up, and burying it under prose was
 * the first thing the people using this asked to have changed.
 */

import type { ApiResponse } from '../api/envelope.js';
import type { Problem, Severity } from '../util/problem.js';
import { SEVERITY_ORDER, hasErrors } from '../util/problem.js';
import { renderPairs, renderTable } from '../util/table.js';
import type { Column } from '../util/table.js';
import { compareText } from '../util/ordering.js';

/** Exit codes. A refusal is not a crash and does not read like one. */
export const OK = 0;
export const REFUSED = 1;

export interface RenderOptions {
  /** Print the whole response as json instead, for a caller that is a program. */
  readonly json?: boolean;
  /** Drop problems below this. Defaults to warning, so info stays quiet. */
  readonly floor?: Severity;
}

const MARKS: Record<Severity, string> = {
  info: 'note',
  warning: 'warn',
  error: 'ERR ',
};

export function formatProblem(problem: Problem): string {
  return `${MARKS[problem.severity]} ${problem.code} ${problem.subject}: ${problem.message}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))
  );
}

/**
 * One value as one cell. An object goes in as json rather than through the
 * default stringification, which prints every nested value as the same eight
 * characters and makes a table that looks fine and says nothing.
 */
function cell(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value) ?? '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
    ? String(value)
    : '';
}

/** A list of rows as a table, taking the columns from the first row. */
function rowsOf(rows: readonly Record<string, unknown>[]): string[] {
  const first = rows[0];
  if (first === undefined) {
    return [];
  }
  const headings = Object.keys(first);
  const columns: Column[] = headings.map((heading) => ({
    heading,
    align: rows.every((row) => typeof row[heading] === 'number') ? 'right' : 'left',
  }));
  return renderTable(
    columns,
    rows.map((row) => headings.map((heading) => cell(row[heading]))),
  );
}

export function formatData(data: unknown): string[] {
  if (data === undefined || data === null) {
    return [];
  }
  if (isStringArray(data)) {
    return data;
  }
  if (isRowArray(data)) {
    return rowsOf(data);
  }
  if (Array.isArray(data)) {
    return data.length === 0 ? [] : data.map((item) => cell(item));
  }
  if (typeof data !== 'object') {
    return [cell(data)];
  }
  const entries = Object.entries(data as Record<string, unknown>);
  const lines: string[] = [];
  const pairs: [string, string][] = [];
  for (const [key, value] of entries) {
    if (isStringArray(value)) {
      lines.push(...value);
    } else if (isRowArray(value)) {
      lines.push(...rowsOf(value));
    } else {
      pairs.push([key, cell(value)]);
    }
  }
  return pairs.length === 0
    ? lines
    : [...renderPairs(pairs), ...(lines.length === 0 ? [] : ['']), ...lines];
}

function shown(problems: readonly Problem[], floor: Severity): Problem[] {
  return [...problems]
    .filter((problem) => SEVERITY_ORDER[problem.severity] >= SEVERITY_ORDER[floor])
    .sort(
      (a, b) =>
        SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || compareText(a.code, b.code),
    );
}

/**
 * Everything an operator sees for one request. Problems come first on a
 * refusal, because there is no body and scrolling past an empty answer to find
 * out why is nobody's idea of a tool.
 */
export function renderResponse(
  response: ApiResponse<unknown>,
  options: RenderOptions = {},
): string[] {
  if (options.json === true) {
    return JSON.stringify(response, null, 2).split('\n');
  }
  const problems = shown(response.problems, options.floor ?? 'warning').map(formatProblem);
  if (!response.ok) {
    return problems.length === 0 ? [`${response.op} was refused`] : problems;
  }
  const body = formatData(response.data);
  return problems.length === 0 ? body : [...body, ...(body.length === 0 ? [] : ['']), ...problems];
}

/** What the process should exit with. A warning on a success is still a success. */
export function exitCode(response: ApiResponse<unknown>): number {
  return response.ok && !hasErrors(response.problems) ? OK : REFUSED;
}
