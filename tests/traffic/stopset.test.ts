import { describe, expect, it } from 'vitest';
import {
  BREAK_OVER,
  BREAK_SHORT,
  SPOT_DROPPED,
  auditStopset,
  demandedLength,
  droppedSpots,
  fillStopset,
  isOver,
  isShort,
  stopsetDrift,
  totalCommercialTime,
  unsold,
} from '../../src/traffic/stopset.js';
import { makeSpot } from '../../src/traffic/spot.js';
import type { Spot } from '../../src/traffic/spot.js';
import { tenths } from '../../src/util/duration.js';
import { expectOk } from '../support/result.js';

const BUDGET = tenths(1200);

function spot(id: string, length: string, priority = 50): Spot {
  return expectOk(makeSpot({ id, orderId: 'ORD-1', cart: 'C0455', length, priority }));
}

const THIRTIES = [spot('SPT-1', '0:30'), spot('SPT-2', '0:30')];

describe('fillStopset', () => {
  it('places everything that fits', () => {
    const filled = fillStopset('break one', BUDGET, THIRTIES);
    expect(filled.spots).toHaveLength(2);
    expect(filled.length).toBe(600);
    expect(filled.dropped).toEqual([]);
  });

  it('fills exactly to the budget', () => {
    const filled = fillStopset('break one', BUDGET, [
      spot('SPT-1', '0:30'),
      spot('SPT-2', '0:30'),
      spot('SPT-3', '1:00'),
    ]);
    expect(filled.length).toBe(1200);
    expect(filled.dropped).toEqual([]);
    expect(stopsetDrift(filled)).toBe(0);
  });

  it('drops what will not fit', () => {
    const filled = fillStopset('break one', BUDGET, [
      spot('SPT-1', '1:00'),
      spot('SPT-2', '1:00'),
      spot('SPT-3', '0:30'),
    ]);
    expect(filled.length).toBe(1200);
    expect(filled.dropped.map((each) => each.id)).toEqual(['SPT-3']);
  });

  it('skips a spot that will not fit and takes a later one that will', () => {
    const filled = fillStopset('break one', BUDGET, [
      spot('SPT-1', '1:00', 10),
      spot('SPT-2', '1:00', 20),
      spot('SPT-3', '0:15', 30),
    ]);
    expect(filled.spots.map((each) => each.id)).toEqual(['SPT-1', 'SPT-2']);
    expect(filled.dropped.map((each) => each.id)).toEqual(['SPT-3']);
  });

  it('places in priority order', () => {
    // Room for one thirty second spot only, so priority decides which.
    const filled = fillStopset('break one', tenths(500), [
      spot('SPT-1', '0:30', 90),
      spot('SPT-2', '0:30', 10),
    ]);
    expect(filled.spots.map((each) => each.id)).toEqual(['SPT-2']);
    expect(filled.dropped.map((each) => each.id)).toEqual(['SPT-1']);
  });

  it('honours a tolerance past the budget', () => {
    const strict = fillStopset('break one', tenths(500), THIRTIES);
    const loose = fillStopset('break one', tenths(500), THIRTIES, { tolerance: tenths(100) });
    expect(strict.dropped).toHaveLength(1);
    expect(loose.dropped).toEqual([]);
  });

  it('fills past the budget when told to, which is how traffic oversells', () => {
    const filled = fillStopset('break one', tenths(300), THIRTIES, { allowOverfill: true });
    expect(filled.spots).toHaveLength(2);
    expect(filled.length).toBe(600);
    expect(isOver(filled)).toBe(true);
  });

  it('fills nothing from nothing due', () => {
    const filled = fillStopset('break one', BUDGET, []);
    expect(filled.spots).toEqual([]);
    expect(filled.length).toBe(0);
    expect(unsold(filled)).toBe(1200);
  });

  it('drops everything into a break with no budget', () => {
    const filled = fillStopset('break one', tenths(0), THIRTIES);
    expect(filled.spots).toEqual([]);
    expect(filled.dropped).toHaveLength(2);
  });
});

describe('how far the break runs from its budget', () => {
  it('is short when it is underfilled', () => {
    const filled = fillStopset('break one', BUDGET, THIRTIES);
    expect(isShort(filled)).toBe(true);
    expect(isOver(filled)).toBe(false);
    expect(stopsetDrift(filled)).toBe(-600);
    expect(unsold(filled)).toBe(600);
  });

  it('is over when it is overfilled', () => {
    const filled = fillStopset('break one', tenths(300), THIRTIES, { allowOverfill: true });
    expect(stopsetDrift(filled)).toBe(300);
    expect(unsold(filled)).toBe(0);
  });

  it('reports what the break would have run had everything fitted', () => {
    const filled = fillStopset('break one', tenths(600), THIRTIES.concat(spot('SPT-3', '0:30')));
    expect(filled.length).toBe(600);
    expect(demandedLength(filled)).toBe(900);
  });
});

describe('auditStopset', () => {
  it('says nothing about a break that came out on budget', () => {
    const filled = fillStopset('break one', tenths(600), THIRTIES);
    expect(auditStopset(filled)).toEqual([]);
  });

  it('notes a short break at info, because unsold time is not an error', () => {
    const problems = auditStopset(fillStopset('break one', BUDGET, THIRTIES));
    expect(problems[0]?.code).toBe(BREAK_SHORT);
    expect(problems[0]?.severity).toBe('info');
    expect(problems[0]?.detail?.['by']).toBe(600);
  });

  it('warns about a break that runs long, because it pushes the hour', () => {
    const filled = fillStopset('break one', tenths(300), THIRTIES, { allowOverfill: true });
    const problems = auditStopset(filled);
    expect(problems[0]?.code).toBe(BREAK_OVER);
    expect(problems[0]?.severity).toBe('warning');
  });

  it('warns once per spot that could not fit', () => {
    const filled = fillStopset('break one', tenths(300), THIRTIES);
    const dropped = auditStopset(filled).filter((each) => each.code === SPOT_DROPPED);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.detail?.['spot']).toBe('SPT-2');
  });
});

describe('across a run of breaks', () => {
  it('totals the commercial time', () => {
    const breaks = [
      fillStopset('one', BUDGET, THIRTIES),
      fillStopset('two', BUDGET, [spot('SPT-3', '1:00')]),
    ];
    expect(totalCommercialTime(breaks)).toBe(600 + 600);
    expect(totalCommercialTime([])).toBe(0);
  });

  it('gathers everything that was dropped', () => {
    const breaks = [
      fillStopset('one', tenths(300), THIRTIES),
      fillStopset('two', tenths(0), [spot('SPT-3', '1:00')]),
    ];
    expect(droppedSpots(breaks).map((each) => each.id)).toEqual(['SPT-2', 'SPT-3']);
  });
});
