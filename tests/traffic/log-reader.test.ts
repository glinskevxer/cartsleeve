import { describe, expect, it } from 'vitest';
import {
  LOG_BAD_HOUR,
  LOG_MISSING_COLUMN,
  LOG_UNREADABLE,
  breakNames,
  hoursUsed,
  orphaned,
  readTrafficLog,
  resolveLogColumns,
  spotsFor,
} from '../../src/traffic/log-reader.js';
import { PIPE } from '../../src/util/delimited.js';
import { expectErr, expectOk } from '../support/result.js';

const HEADER = 'Spot #,Contract,Cart #,Len,Hr,Stopset,Pri';

const LOG = [
  HEADER,
  'SPT-1,ORD-1041,C0455,0:30,7,break one,10',
  'SPT-2,ORD-1041,C0456,0:30,7,break one,20',
  'SPT-3,ORD-2200,C0900,1:00,7,break two,10',
  'SPT-4,ORD-2200,C0901,0:15,14,break one,50',
].join('\n');

describe('resolveLogColumns', () => {
  it('matches a column whatever traffic called it', () => {
    const resolved = resolveLogColumns(HEADER.split(','));
    expect(resolved.get('spot')).toBe('Spot #');
    expect(resolved.get('order')).toBe('Contract');
    expect(resolved.get('length')).toBe('Len');
    expect(resolved.get('hour')).toBe('Hr');
    expect(resolved.get('break')).toBe('Stopset');
  });

  it('leaves out a field the file does not carry', () => {
    expect(resolveLogColumns(['spot', 'cart']).has('priority')).toBe(false);
  });
});

describe('readTrafficLog', () => {
  it('reads every line into a scheduled spot', () => {
    const log = expectOk(readTrafficLog(LOG));
    expect(log.linesRead).toBe(4);
    expect(log.spots).toHaveLength(4);
    expect(log.problems).toEqual([]);
  });

  it('reads the hour and the break off each line', () => {
    const log = expectOk(readTrafficLog(LOG));
    expect(log.spots[0]?.clockHour).toBe(7);
    expect(log.spots[0]?.breakName).toBe('break one');
    expect(log.spots[3]?.clockHour).toBe(14);
  });

  it('reads the spot itself, including its priority', () => {
    const log = expectOk(readTrafficLog(LOG));
    expect(log.spots[0]?.spot.cart).toBe('C0455');
    expect(log.spots[0]?.spot.length).toBe(300);
    expect(log.spots[0]?.spot.priority).toBe(10);
  });

  it('defaults the priority when the file has no column for it', () => {
    const text = ['spot,order,cart,length,hour,break', 'SPT-1,ORD-1,C0455,0:30,7,break one'].join(
      '\n',
    );
    expect(expectOk(readTrafficLog(text)).spots[0]?.spot.priority).toBe(50);
  });

  it('reads a pipe delimited log', () => {
    const piped = LOG.split('\n')
      .map((line) => line.split(',').join('|'))
      .join('\n');
    expect(expectOk(readTrafficLog(piped, { delimiter: PIPE })).spots).toHaveLength(4);
  });

  it('rejects a file the reader cannot parse', () => {
    expect(expectErr(readTrafficLog('a\n"unterminated\n'))[0]?.code).toBe(LOG_UNREADABLE);
  });

  it('rejects a header missing something it cannot work without', () => {
    const problems = expectErr(readTrafficLog('spot,cart\nSPT-1,C0455\n'));
    expect(problems.every((each) => each.code === LOG_MISSING_COLUMN)).toBe(true);
    expect(problems.map((each) => each.message)).toContain('has no column for hour');
  });

  it('skips a line whose hour is outside the day and says so', () => {
    const text = [HEADER, 'SPT-1,ORD-1,C0455,0:30,25,break one,10'].join('\n');
    const log = expectOk(readTrafficLog(text));
    expect(log.spots).toEqual([]);
    expect(log.problems[0]?.code).toBe(LOG_BAD_HOUR);
    expect(log.problems[0]?.detail?.['given']).toBe('25');
  });

  it('accepts both ends of the day', () => {
    const text = [
      HEADER,
      'SPT-1,ORD-1,C0455,0:30,0,break one,10',
      'SPT-2,ORD-1,C0456,0:30,23,break one,10',
    ].join('\n');
    expect(expectOk(readTrafficLog(text)).spots).toHaveLength(2);
  });

  it('keeps going past a bad line and names it', () => {
    const text = [
      HEADER,
      'SPT-1,ORD-1,C0455,0:30,7,break one,10',
      ',ORD-1,nope,x,7,break one,10',
      'SPT-3,ORD-1,C0457,0:30,7,break one,10',
    ].join('\n');
    const log = expectOk(readTrafficLog(text));
    expect(log.spots).toHaveLength(2);
    expect(log.problems[0]?.subject).toBe('line 3');
  });

  it('reads a header with no lines as an empty log', () => {
    const log = expectOk(readTrafficLog(`${HEADER}\n`));
    expect(log.linesRead).toBe(0);
    expect(log.spots).toEqual([]);
  });
});

describe('reading a log back', () => {
  const log = () => expectOk(readTrafficLog(LOG));

  it('finds the spots of one break of one hour', () => {
    expect(spotsFor(log(), 7, 'break one').map((each) => each.id)).toEqual(['SPT-1', 'SPT-2']);
    expect(spotsFor(log(), 7, 'break two').map((each) => each.id)).toEqual(['SPT-3']);
  });

  it('does not confuse the same break name in two hours', () => {
    expect(spotsFor(log(), 14, 'break one').map((each) => each.id)).toEqual(['SPT-4']);
  });

  it('finds nothing for a break nobody sold into', () => {
    expect(spotsFor(log(), 7, 'break nine')).toEqual([]);
    expect(spotsFor(log(), 3, 'break one')).toEqual([]);
  });

  it('lists the break names and hours traffic used', () => {
    expect(breakNames(log())).toEqual(['break one', 'break two']);
    expect(hoursUsed(log())).toEqual([7, 14]);
  });

  it('finds spots sold into a break no clock defines', () => {
    expect(orphaned(log(), ['break one']).map((each) => each.spot.id)).toEqual(['SPT-3']);
    expect(orphaned(log(), ['break one', 'break two'])).toEqual([]);
  });

  it('calls everything orphaned when no break is defined', () => {
    expect(orphaned(log(), [])).toHaveLength(4);
  });
});
