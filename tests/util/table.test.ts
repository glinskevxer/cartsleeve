import { describe, expect, it } from 'vitest';
import {
  centre,
  pad,
  percent,
  renderPairs,
  renderTable,
  rightAlignNumber,
  truncate,
} from '../../src/util/table.js';
import type { Column } from '../../src/util/table.js';

const COLUMNS: Column[] = [
  { heading: 'cart', align: 'left' },
  { heading: 'title', align: 'left' },
  { heading: 'runs', align: 'right' },
];

describe('truncate', () => {
  it('leaves a short value alone', () => {
    expect(truncate('abc', 5, '~')).toBe('abc');
    expect(truncate('abcde', 5, '~')).toBe('abcde');
  });

  it('cuts and marks a long value', () => {
    expect(truncate('abcdefg', 5, '~')).toBe('abcd~');
  });

  it('cuts without a mark when there is no room for one', () => {
    expect(truncate('abcdefg', 1, '~')).toBe('a');
    expect(truncate('abcdefg', 0, '~')).toBe('');
  });

  it('never returns more than the width', () => {
    for (const width of [1, 2, 3, 4, 9]) {
      expect(truncate('a very long title indeed', width, '~').length).toBeLessThanOrEqual(width);
    }
  });
});

describe('pad', () => {
  it('pads left and right', () => {
    expect(pad('ab', 5, 'left')).toBe('ab   ');
    expect(pad('ab', 5, 'right')).toBe('   ab');
  });

  it('leaves an over long value alone rather than cutting it', () => {
    expect(pad('abcdef', 3, 'left')).toBe('abcdef');
  });
});

describe('renderTable', () => {
  it('sizes each column to its widest cell', () => {
    const lines = renderTable(COLUMNS, [
      ['M0001', 'Wichita Lineman', '14'],
      ['M0002', 'Galveston', '9'],
    ]);
    expect(lines[0]).toBe('cart   title            runs');
    expect(lines[1]).toBe('-----  ---------------  ----');
    expect(lines[2]).toBe('M0001  Wichita Lineman    14');
    expect(lines[3]).toBe('M0002  Galveston           9');
  });

  it('lets the heading set the width when it is the widest', () => {
    const lines = renderTable([{ heading: 'category', align: 'left' }], [['A']]);
    expect(lines[0]).toBe('category');
    expect(lines[2]).toBe('A');
  });

  it('honours a hard column cap', () => {
    const lines = renderTable(
      [
        { heading: 'title', align: 'left', width: 10 },
        { heading: 'runs', align: 'right' },
      ],
      [['A Very Long Song Title', '3']],
    );
    expect(lines[2]).toBe('A Very Lo~     3');
  });

  it('can be rendered without the rule', () => {
    const lines = renderTable(COLUMNS, [['M0001', 'x', '1']], { rule: false });
    expect(lines).toHaveLength(2);
  });

  it('honours the gap between columns', () => {
    const row = ['M0001', 'x', '1'];
    const narrow = renderTable(COLUMNS, [row], { gap: 1 })[2] ?? '';
    const wide = renderTable(COLUMNS, [row], { gap: 3 })[2] ?? '';
    // cart is 5 wide, title takes its 5 from the heading, runs takes its 4
    expect(narrow.length).toBe(5 + 1 + 5 + 1 + 4);
    expect(wide.length).toBe(5 + 3 + 5 + 3 + 4);
    expect(narrow.indexOf('x')).toBe(6);
    expect(wide.indexOf('x')).toBe(8);
    expect(narrow.trimEnd().endsWith('1')).toBe(true);
  });

  it('trims the trailing space off every line', () => {
    const lines = renderTable(COLUMNS, [['M0001', 'Wichita Lineman', '14']]);
    for (const line of lines) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('renders a header and rule with no body rows', () => {
    const lines = renderTable(COLUMNS, []);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('cart  title  runs');
  });

  it('treats a short row as blank in the missing columns', () => {
    const lines = renderTable(COLUMNS, [['M0001']]);
    expect(lines[2]).toBe('M0001');
  });
});

describe('report furniture', () => {
  it('aligns a pair block on the colon', () => {
    expect(
      renderPairs([
        ['station', 'KHRT'],
        ['broadcast day', '2025-06-10'],
      ]),
    ).toEqual(['station:       KHRT', 'broadcast day: 2025-06-10']);
  });

  it('centres a title', () => {
    expect(centre('LOG', 11)).toBe('    LOG');
    expect(centre('a title longer than the page', 5)).toBe('a title longer than the page');
  });

  it('right aligns a number to a fixed width', () => {
    expect(rightAlignNumber(7, 5)).toBe('    7');
    expect(rightAlignNumber(7.256, 6, 2)).toBe('  7.26');
  });

  it('renders a percentage and survives a zero denominator', () => {
    expect(percent(1, 4)).toBe('25.0%');
    expect(percent(1, 3, 2)).toBe('33.33%');
    expect(percent(0, 0)).toBe('0.0%');
  });
});
