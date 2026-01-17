import { describe, expect, it } from 'vitest';
import { PAGE_WIDTH, fitsPage, printedSections, renderFrame } from '../../src/report/frame.js';
import type { ReportFrame } from '../../src/report/frame.js';
import type { Column } from '../../src/util/table.js';

const COLUMNS: readonly Column[] = [
  { heading: 'cart', align: 'left' },
  { heading: 'note', align: 'left' },
];

const frame = (over: Partial<ReportFrame> = {}): ReportFrame => ({
  title: 'A REPORT',
  heading: [
    ['station', 'KHRT'],
    ['day', '2025-06-10'],
  ],
  sections: [],
  ...over,
});

describe('renderFrame', () => {
  it('centres the title and prints the heading', () => {
    const lines = renderFrame(frame());
    expect(lines[0]?.trim()).toBe('A REPORT');
    expect(lines.join('\n')).toContain('station:');
    expect(lines.join('\n')).toContain('KHRT');
  });

  it('prints a summary block when there is one', () => {
    const lines = renderFrame(frame({ summary: [['verdict', 'clean']] }));
    expect(lines.join('\n')).toContain('verdict:');
  });

  it('leaves the summary out when it is empty', () => {
    expect(renderFrame(frame({ summary: [] })).join('\n')).not.toContain('verdict');
  });

  it('prints a section that has rows', () => {
    const lines = renderFrame(
      frame({ sections: [{ title: 'THINGS', columns: COLUMNS, rows: [['M0001', 'a note']] }] }),
    );
    expect(lines).toContain('THINGS');
    expect(lines.join('\n')).toContain('M0001');
  });

  it('drops a section with no rows rather than printing an empty table', () => {
    const lines = renderFrame(
      frame({ sections: [{ title: 'THINGS', columns: COLUMNS, rows: [] }] }),
    );
    expect(lines).not.toContain('THINGS');
  });

  it('prints several sections in order', () => {
    const lines = renderFrame(
      frame({
        sections: [
          { title: 'FIRST', columns: COLUMNS, rows: [['M0001', 'x']] },
          { title: 'SECOND', columns: COLUMNS, rows: [['M0002', 'y']] },
        ],
      }),
    );
    expect(lines.indexOf('FIRST')).toBeLessThan(lines.indexOf('SECOND'));
  });

  it('never runs a line past the page width', () => {
    const wide = 'x'.repeat(200);
    const lines = renderFrame(
      frame({
        heading: [['a very long key indeed', wide]],
        sections: [{ title: 'THINGS', columns: COLUMNS, rows: [[wide, wide]] }],
      }),
    );
    expect(fitsPage(lines)).toBe(true);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(PAGE_WIDTH);
    }
  });

  it('never leaves trailing space', () => {
    const lines = renderFrame(
      frame({ sections: [{ title: 'THINGS', columns: COLUMNS, rows: [['M0001', '']] }] }),
    );
    expect(lines.every((line) => line === line.trimEnd())).toBe(true);
  });

  it('renders a frame with nothing but a title and heading', () => {
    expect(renderFrame(frame()).length).toBeGreaterThan(2);
  });
});

describe('printedSections', () => {
  it('names only the sections that would print', () => {
    const built = frame({
      sections: [
        { title: 'FULL', columns: COLUMNS, rows: [['M0001', 'x']] },
        { title: 'EMPTY', columns: COLUMNS, rows: [] },
      ],
    });
    expect(printedSections(built)).toEqual(['FULL']);
  });

  it('names nothing when nothing would print', () => {
    expect(printedSections(frame())).toEqual([]);
  });
});

describe('fitsPage', () => {
  it('rejects a line that is too wide or has trailing space', () => {
    expect(fitsPage(['x'.repeat(PAGE_WIDTH + 1)])).toBe(false);
    expect(fitsPage(['ok '])).toBe(false);
    expect(fitsPage(['ok'])).toBe(true);
    expect(fitsPage([])).toBe(true);
  });
});
