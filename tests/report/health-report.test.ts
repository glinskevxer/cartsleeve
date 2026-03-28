import { describe, expect, it } from 'vitest';
import {
  CLUMP_THRESHOLD,
  SECTION_LIMIT,
  STUCK_THRESHOLD,
  describeReturn,
  firstRemedy,
  isHealthy,
  measureHealth,
  renderHealth,
} from '../../src/report/health-report.js';
import type { CycleLength, HealthInput } from '../../src/report/health-report.js';
import { fitsPage } from '../../src/report/frame.js';
import { WEEKDAYS, cellOf, makeDaypart } from '../../src/domain/daypart.js';
import type { Play } from '../../src/rotation/rest.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';
import { expectOk } from '../support/result.js';

const cart = (value: string): CartNumber => value as CartNumber;
const category = (value: string): CategoryCode => value as CategoryCode;

const AMD = expectOk(makeDaypart('AMD', [{ days: [...WEEKDAYS], fromHour: 6, toHour: 10 }]));
const MID = expectOk(makeDaypart('MID', [{ days: [...WEEKDAYS], fromHour: 10, toHour: 15 }]));
const PMD = expectOk(makeDaypart('PMD', [{ days: [...WEEKDAYS], fromHour: 15, toHour: 19 }]));
const DAYPARTS = [AMD, MID, PMD];

let clock = 0;
function play(number: string, day: number, hour: number): Play {
  clock += 1;
  return { cart: cart(number), at: clock, cell: cellOf(day, hour) };
}

/**
 * One cart of each kind. M0001 is stuck and clumped, M0002 is healthy, M0003
 * is clumped on an overnight hour no daypart covers, and M0004 is spread over
 * morning drive but never leaves it.
 */
const PLAYS: Play[] = [
  play('M0001', 1, 8),
  play('M0001', 2, 8),
  play('M0001', 3, 8),
  play('M0001', 4, 8),
  play('M0002', 1, 7),
  play('M0002', 2, 12),
  play('M0002', 3, 16),
  play('M0002', 4, 18),
  play('M0003', 1, 2),
  play('M0003', 2, 2),
  play('M0003', 3, 2),
  play('M0004', 1, 6),
  play('M0004', 2, 7),
  play('M0004', 3, 8),
  play('M0004', 4, 9),
];

const CARTS = [cart('M0001'), cart('M0002'), cart('M0003'), cart('M0004')];

const CYCLES: CycleLength[] = [
  { category: category('A'), hours: 24 },
  { category: category('B'), hours: 5 },
];

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    plays: PLAYS,
    dayparts: DAYPARTS,
    carts: CARTS,
    cycles: CYCLES,
    station: 'KRTQ',
    period: 'week of 3 March',
    ...overrides,
  };
}

describe('measureHealth', () => {
  it('finds the cart that never leaves morning drive', () => {
    const stuck = measureHealth(input()).stuck.map((row) => row.cart);
    expect(stuck).toContain(cart('M0001'));
    expect(stuck).toContain(cart('M0004'));
    expect(stuck).not.toContain(cart('M0002'));
  });

  it('finds the cart that lands on the same hour every day', () => {
    const clumped = measureHealth(input()).clumped.map((row) => row.cart);
    expect(clumped).toContain(cart('M0001'));
    expect(clumped).toContain(cart('M0003'));
    expect(clumped).not.toContain(cart('M0002'));
  });

  it('does not call a cart stuck when no daypart covers the hour it lands on', () => {
    const health = measureHealth(input());
    expect(health.clumped.map((row) => row.cart)).toContain(cart('M0003'));
    expect(health.stuck.map((row) => row.cart)).not.toContain(cart('M0003'));
  });

  it('separates out the carts that are stuck and clumped at the same time', () => {
    const health = measureHealth(input());
    expect(health.both).toEqual([cart('M0001')]);
  });

  it('never lists a cart in both without listing it in each', () => {
    const health = measureHealth(input());
    for (const number of health.both) {
      expect(health.stuck.some((row) => row.cart === number)).toBe(true);
      expect(health.clumped.some((row) => row.cart === number)).toBe(true);
    }
  });

  it('orders the stuck carts worst first', () => {
    const spreads = measureHealth(input()).stuck.map((row) => row.imbalance);
    expect([...spreads].sort((a, b) => b - a)).toEqual(spreads);
    expect(spreads.every((value) => value >= STUCK_THRESHOLD)).toBe(true);
  });

  it('orders the clumped carts worst first', () => {
    const shares = measureHealth(input()).clumped.map((row) => row.heaviestCount / row.plays);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
    expect(shares.every((value) => value >= CLUMP_THRESHOLD)).toBe(true);
  });

  it('ignores a cart with too few plays to judge', () => {
    const once = [play('M0009', 1, 8)];
    const health = measureHealth(input({ plays: once, carts: [cart('M0009')] }));
    expect(health.clumped).toHaveLength(0);
    expect(health.stuck).toHaveLength(0);
  });

  it('reads nothing at all out of an empty week', () => {
    const health = measureHealth(input({ plays: [], carts: [] }));
    expect(health.stuck).toHaveLength(0);
    expect(health.clumped).toHaveLength(0);
    expect(health.both).toHaveLength(0);
    expect(health.daypartSpread).toBe(0);
  });
});

describe('describeReturn', () => {
  it('reads a whole day cycle as the same hour every day', () => {
    expect(describeReturn(24)).toBe('same hour every day');
  });

  it('reads a half day cycle the same way, because it comes round twice', () => {
    expect(describeReturn(12)).toBe('same hour every day');
  });

  it('counts the days a cycle takes to come back round', () => {
    expect(describeReturn(5)).toBe('same hour every 5 days');
    expect(describeReturn(7)).toBe('same hour every 7 days');
  });

  it('says a fractional cycle never returns', () => {
    expect(describeReturn(4.5)).toBe('never to the same hour');
  });
});

describe('renderHealth', () => {
  const lines = renderHealth(input());

  it('fits the page', () => {
    expect(fitsPage(lines)).toBe(true);
  });

  it('names the station and the period in the heading', () => {
    expect(lines[0]).toContain('ROTATION HEALTH');
    expect(lines.some((line) => line.includes('KRTQ'))).toBe(true);
    expect(lines.some((line) => line.includes('week of 3 March'))).toBe(true);
  });

  it('prints a section for each kind of trouble', () => {
    for (const title of [
      'STUCK IN ONE DAYPART',
      'CLUMPED ON ONE HOUR',
      'BOTH AT ONCE',
      'CATEGORY CYCLES',
    ]) {
      expect(lines).toContain(title);
    }
  });

  it('shows the hour a clumped cart keeps landing on', () => {
    const start = lines.indexOf('CLUMPED ON ONE HOUR');
    const rows = lines.slice(start + 3, start + 5);
    expect(rows.some((row) => row.includes('M0001') && row.includes('08:00'))).toBe(true);
  });

  it('names the dayparts a stuck cart is never heard in', () => {
    const start = lines.indexOf('STUCK IN ONE DAYPART');
    const section = lines.slice(start).join('\n');
    expect(section).toContain('MID');
    expect(section).toContain('PMD');
  });

  it('drops a section that has no rows rather than printing an empty table', () => {
    const healthy = renderHealth(
      input({ plays: [], carts: [], cycles: [{ category: category('A'), hours: 7 }] }),
    );
    expect(healthy).not.toContain('STUCK IN ONE DAYPART');
    expect(healthy).not.toContain('BOTH AT ONCE');
    expect(healthy).toContain('CATEGORY CYCLES');
  });

  it('cuts a long section at the limit', () => {
    const many: Play[] = [];
    const carts: CartNumber[] = [];
    for (let index = 0; index < SECTION_LIMIT + 6; index += 1) {
      const number = `M${String(9000 + index)}`;
      carts.push(cart(number));
      for (let day = 1; day <= 4; day += 1) {
        many.push(play(number, day, 8));
      }
    }
    const wide = renderHealth(input({ plays: many, carts }));
    const start = wide.indexOf('CLUMPED ON ONE HOUR');
    const next = wide.indexOf('BOTH AT ONCE');
    // Title, then a heading row and a rule, then the rows, then a blank line.
    expect(next - start - 4).toBe(SECTION_LIMIT);
  });
});

describe('isHealthy', () => {
  it('says no while a cart is stuck', () => {
    expect(isHealthy(input())).toBe(false);
  });

  it('says yes for a week with nothing wrong in it', () => {
    const even = [
      play('M0100', 1, 7),
      play('M0100', 2, 12),
      play('M0100', 3, 16),
      play('M0100', 4, 18),
    ];
    const clean = input({
      plays: even,
      carts: [cart('M0100')],
      cycles: [{ category: category('A'), hours: 5 }],
    });
    expect(isHealthy(clean)).toBe(true);
  });

  it('says no on a locking cycle even when every cart looks fine', () => {
    const even = [
      play('M0101', 1, 7),
      play('M0101', 2, 12),
      play('M0101', 3, 16),
      play('M0101', 4, 18),
    ];
    const locked = input({
      plays: even,
      carts: [cart('M0101')],
      cycles: [{ category: category('A'), hours: 24 }],
    });
    expect(measureHealth(locked).stuck).toHaveLength(0);
    expect(measureHealth(locked).clumped).toHaveLength(0);
    expect(isHealthy(locked)).toBe(false);
  });
});

describe('firstRemedy', () => {
  it('sends the cycle length back before any hand spreading', () => {
    expect(firstRemedy(input())).toBe('change the cycle length for A');
  });

  it('falls to the carts that are wrong both ways once the cycles are sound', () => {
    const remedy = firstRemedy(input({ cycles: [{ category: category('B'), hours: 5 }] }));
    expect(remedy).toBe('spread 1 cart stuck and clumped at once');
  });

  it('has nothing to say about a healthy rotation', () => {
    const clean = input({ plays: [], carts: [], cycles: [] });
    expect(firstRemedy(clean)).toBe('nothing, the rotation is healthy');
  });
});
