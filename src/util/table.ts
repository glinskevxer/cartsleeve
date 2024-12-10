/**
 * Fixed width report rendering.
 *
 * Programme directors read these on paper and on a green screen automation
 * terminal, both of which are eighty columns and neither of which wraps. A
 * column that overflows pushes every column after it out of alignment for the
 * rest of the page, so widths are computed once over the whole body and long
 * values are cut rather than allowed to run.
 */

export type Align = 'left' | 'right';

export interface Column {
  readonly heading: string;
  readonly align: Align;
  /** Hard cap. A value longer than this is cut and marked. */
  readonly width?: number;
}

export interface TableOptions {
  readonly gap?: number;
  readonly rule?: boolean;
  readonly ellipsis?: string;
}

const DEFAULTS = { gap: 2, rule: true, ellipsis: '~' } as const;

export function truncate(value: string, width: number, ellipsis: string): string {
  if (width <= 0) {
    return '';
  }
  if (value.length <= width) {
    return value;
  }
  if (width <= ellipsis.length) {
    return value.slice(0, width);
  }
  return value.slice(0, width - ellipsis.length) + ellipsis;
}

export function pad(value: string, width: number, align: Align): string {
  if (value.length >= width) {
    return value;
  }
  return align === 'right' ? value.padStart(width, ' ') : value.padEnd(width, ' ');
}

function widthsFor(
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
  ellipsis: string,
): number[] {
  return columns.map((column, index) => {
    let widest = column.heading.length;
    for (const row of rows) {
      const cell = row[index] ?? '';
      const capped = column.width === undefined ? cell : truncate(cell, column.width, ellipsis);
      widest = Math.max(widest, capped.length);
    }
    return column.width === undefined ? widest : Math.min(widest, column.width);
  });
}

export function renderTable(
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
  options: TableOptions = {},
): string[] {
  const gap = options.gap ?? DEFAULTS.gap;
  const rule = options.rule ?? DEFAULTS.rule;
  const ellipsis = options.ellipsis ?? DEFAULTS.ellipsis;
  const widths = widthsFor(columns, rows, ellipsis);
  const separator = ' '.repeat(gap);

  const line = (cells: readonly string[]): string => {
    const parts = columns.map((column, index) => {
      const width = widths[index] ?? 0;
      const value = truncate(cells[index] ?? '', width, ellipsis);
      return pad(value, width, column.align);
    });
    return parts.join(separator).trimEnd();
  };

  const out: string[] = [line(columns.map((column) => column.heading))];
  if (rule) {
    out.push(
      widths
        .map((width) => '-'.repeat(width))
        .join(separator)
        .trimEnd(),
    );
  }
  for (const row of rows) {
    out.push(line(row));
  }
  return out;
}

/** A two column key and value block, used for the header of every report. */
export function renderPairs(pairs: readonly (readonly [string, string])[]): string[] {
  const widest = pairs.reduce((max, [key]) => Math.max(max, key.length), 0);
  return pairs.map(([key, value]) => `${pad(`${key}:`, widest + 1, 'left')} ${value}`);
}

/** Centre a title over a page of the given width, for the printed header. */
export function centre(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  const left = Math.floor((width - value.length) / 2);
  return ' '.repeat(left) + value;
}

export function rightAlignNumber(value: number, width: number, decimals = 0): string {
  return pad(value.toFixed(decimals), width, 'right');
}

export function percent(part: number, whole: number, decimals = 1): string {
  if (whole === 0) {
    return '0.0%';
  }
  return `${((part / whole) * 100).toFixed(decimals)}%`;
}
