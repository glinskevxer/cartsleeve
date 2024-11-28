import { describe, expect, it } from 'vitest';
import {
  TENTHS_PER_HOUR,
  TENTHS_PER_MINUTE,
  addDuration,
  durationParts,
  formatDuration,
  formatLong,
  formatPrecise,
  fromMillis,
  fromMinutes,
  fromSeconds,
  parseDuration,
  printedDrift,
  scaleDuration,
  subtractDuration,
  sumDurations,
  tenths,
  toMillis,
  toSeconds,
} from '../../src/util/duration.js';
import { expectErr, expectOk } from '../support/result.js';

describe('constructing a duration', () => {
  it('converts from seconds and minutes', () => {
    expect(fromSeconds(30)).toBe(300);
    expect(fromMinutes(3.5)).toBe(2100);
    expect(toSeconds(fromSeconds(42))).toBe(42);
  });

  it('rounds a fractional tenth rather than truncating it', () => {
    expect(tenths(4.4)).toBe(4);
    expect(tenths(4.5)).toBe(5);
    expect(fromSeconds(0.26)).toBe(3);
  });

  it('round trips through milliseconds', () => {
    expect(toMillis(fromSeconds(3))).toBe(3000);
    expect(fromMillis(3000)).toBe(30);
    expect(fromMillis(3049)).toBe(30);
  });
});

describe('duration arithmetic', () => {
  it('adds, subtracts and scales', () => {
    expect(addDuration(fromSeconds(30), fromSeconds(12))).toBe(420);
    expect(subtractDuration(fromSeconds(30), fromSeconds(12))).toBe(180);
    expect(scaleDuration(fromSeconds(30), 2)).toBe(600);
    expect(scaleDuration(fromSeconds(30), 0.5)).toBe(150);
  });

  it('sums a list and treats an empty one as zero', () => {
    expect(sumDurations([fromSeconds(30), fromSeconds(12), fromSeconds(1)])).toBe(430);
    expect(sumDurations([])).toBe(0);
  });

  it('lets a subtraction go negative rather than clamping', () => {
    expect(subtractDuration(fromSeconds(10), fromSeconds(25))).toBe(-150);
  });
});

describe('parseDuration', () => {
  it('reads the m:ss form off a rack card', () => {
    expect(expectOk(parseDuration('3:42'))).toBe(2220);
    expect(expectOk(parseDuration('0:29'))).toBe(290);
  });

  it('reads the tenth when it is written', () => {
    expect(expectOk(parseDuration('3:42.5'))).toBe(2225);
    expect(expectOk(parseDuration('3:42.0'))).toBe(2220);
  });

  it('reads the h:mm:ss form used for an hour total', () => {
    expect(expectOk(parseDuration('1:02:30'))).toBe(TENTHS_PER_HOUR + 2 * TENTHS_PER_MINUTE + 300);
  });

  it('tolerates surrounding space', () => {
    expect(expectOk(parseDuration('  4:01  '))).toBe(2410);
  });

  it('rejects a bare second count so an import cannot misread it', () => {
    expect(expectErr(parseDuration('342')).reason).toContain('m:ss');
  });

  it('rejects an empty entry', () => {
    expect(expectErr(parseDuration('')).reason).toContain('empty');
  });

  it('rejects sixty or more seconds', () => {
    expect(expectErr(parseDuration('3:60')).reason).toContain('60 seconds');
  });

  it('rejects sixty or more minutes once hours are written', () => {
    expect(expectErr(parseDuration('1:60:00')).reason).toContain('60 minutes');
  });

  it('allows minutes past sixty when no hour field is written', () => {
    expect(expectOk(parseDuration('75:00'))).toBe(75 * TENTHS_PER_MINUTE);
  });
});

describe('formatting', () => {
  it('prints m:ss and drops the tenth rather than rounding it', () => {
    expect(formatDuration(tenths(2229))).toBe('3:42');
    expect(formatDuration(tenths(2220))).toBe('3:42');
  });

  it('prints the tenth when asked for it', () => {
    expect(formatPrecise(tenths(2225))).toBe('3:42.5');
    expect(formatPrecise(tenths(2220))).toBe('3:42.0');
  });

  it('prints an hour total in h:mm:ss', () => {
    expect(formatLong(tenths(TENTHS_PER_HOUR + 2 * TENTHS_PER_MINUTE + 305))).toBe('1:02:30');
  });

  it('carries minutes past sixty into the m:ss form', () => {
    expect(formatDuration(tenths(TENTHS_PER_HOUR + 300))).toBe('60:30');
  });

  it('keeps the sign on a negative duration', () => {
    expect(formatDuration(tenths(-150))).toBe('-0:15');
    expect(formatPrecise(tenths(-155))).toBe('-0:15.5');
    expect(formatLong(tenths(-TENTHS_PER_HOUR))).toBe('-1:00:00');
  });

  it('splits a duration into its parts', () => {
    expect(durationParts(tenths(TENTHS_PER_HOUR + 2 * TENTHS_PER_MINUTE + 305))).toEqual({
      hours: 1,
      minutes: 2,
      seconds: 30,
      fraction: 5,
      negative: false,
    });
    expect(durationParts(tenths(-300)).negative).toBe(true);
  });
});

describe('printedDrift', () => {
  it('is zero when every cart is a whole number of seconds', () => {
    expect(printedDrift([fromSeconds(30), fromSeconds(12)])).toBe(0);
  });

  it('accumulates the dropped tenths across an hour of music', () => {
    const carts = [2225, 1987, 2043, 1756].map(tenths);
    expect(printedDrift(carts)).toBe(21);
  });

  it('shows why an hour of fourteen carts can print four seconds short', () => {
    const carts = Array.from({ length: 14 }, () => tenths(2229));
    expect(printedDrift(carts)).toBe(126);
    expect(formatDuration(printedDrift(carts))).toBe('0:12');
  });
});
