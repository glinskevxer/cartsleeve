/**
 * Diagnostics.
 *
 * Everything that can go wrong in cartsleeve is reported as a problem rather
 * than a string, because the same finding is printed on a validation report,
 * counted in a summary, filtered by severity on the command line and compared
 * between two scheduling passes. A free text message can do none of that.
 *
 * A code is a three letter area and a three digit number. The area says which
 * stage found it, not which stage caused it, and those are often different.
 */

export type Severity = 'info' | 'warning' | 'error';

export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

export interface Problem {
  readonly code: string;
  readonly severity: Severity;
  /** What the problem is about: a cart number, a slot, a clock element. */
  readonly subject: string;
  readonly message: string;
  readonly detail?: Readonly<Record<string, string | number>>;
}

export function problem(
  code: string,
  severity: Severity,
  subject: string,
  message: string,
  detail?: Readonly<Record<string, string | number>>,
): Problem {
  return detail === undefined
    ? { code, severity, subject, message }
    : { code, severity, subject, message, detail };
}

export function info(
  code: string,
  subject: string,
  message: string,
  detail?: Readonly<Record<string, string | number>>,
): Problem {
  return problem(code, 'info', subject, message, detail);
}

export function warning(
  code: string,
  subject: string,
  message: string,
  detail?: Readonly<Record<string, string | number>>,
): Problem {
  return problem(code, 'warning', subject, message, detail);
}

export function error(
  code: string,
  subject: string,
  message: string,
  detail?: Readonly<Record<string, string | number>>,
): Problem {
  return problem(code, 'error', subject, message, detail);
}

export function isAtLeast(severity: Severity, floor: Severity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[floor];
}

export function atLeast(problems: readonly Problem[], floor: Severity): Problem[] {
  return problems.filter((item) => isAtLeast(item.severity, floor));
}

export function hasErrors(problems: readonly Problem[]): boolean {
  return problems.some((item) => item.severity === 'error');
}

export function worstSeverity(problems: readonly Problem[]): Severity | undefined {
  let worst: Severity | undefined;
  for (const item of problems) {
    if (worst === undefined || SEVERITY_ORDER[item.severity] > SEVERITY_ORDER[worst]) {
      worst = item.severity;
    }
  }
  return worst;
}

export function countBySeverity(problems: readonly Problem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { info: 0, warning: 0, error: 0 };
  for (const item of problems) {
    counts[item.severity] += 1;
  }
  return counts;
}

export function countByCode(problems: readonly Problem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of problems) {
    counts.set(item.code, (counts.get(item.code) ?? 0) + 1);
  }
  return counts;
}

export function formatProblem(item: Problem): string {
  const detail = item.detail;
  if (detail === undefined) {
    return `${item.code} ${item.severity} ${item.subject}: ${item.message}`;
  }
  const pairs = Object.keys(detail)
    .sort()
    .map((key) => `${key}=${String(detail[key])}`)
    .join(' ');
  return `${item.code} ${item.severity} ${item.subject}: ${item.message} [${pairs}]`;
}

/** The areas that raise codes, kept here so a code cannot be invented ad hoc. */
export const AREAS = {
  library: 'LIB',
  clock: 'CLK',
  rotation: 'ROT',
  rule: 'RUL',
  schedule: 'SCH',
  traffic: 'TRF',
  aired: 'AIR',
  royalty: 'ROY',
  store: 'STO',
} as const;

export type Area = keyof typeof AREAS;

export function codeFor(area: Area, number: number): string {
  return `${AREAS[area]}-${String(number).padStart(3, '0')}`;
}

export function areaOf(code: string): Area | undefined {
  const prefix = code.slice(0, 3);
  for (const [name, value] of Object.entries(AREAS)) {
    if (value === prefix) {
      return name as Area;
    }
  }
  return undefined;
}
