import { describe, expect, it } from 'vitest';
import {
  advance,
  dealPackets,
  drawOrder,
  isSpent,
  packetCount,
  packetOf,
  peek,
  startCursor,
  totalCarts,
} from '../../src/rotation/packet.js';
import type { CartNumber, CategoryCode } from '../../src/util/ids.js';

const code = (value: string): CategoryCode => value as CategoryCode;
const A = code('A');

function carts(count: number): CartNumber[] {
  return Array.from(
    { length: count },
    (_, index) => `M${String(index + 1).padStart(4, '0')}` as CartNumber,
  );
}

describe('dealPackets', () => {
  it('deals round robin so the best rested spread across packets', () => {
    const packets = dealPackets(A, carts(6), 3);
    expect(packets.groups).toEqual([
      ['M0001', 'M0004'],
      ['M0002', 'M0005'],
      ['M0003', 'M0006'],
    ]);
  });

  it('keeps every cart exactly once', () => {
    const packets = dealPackets(A, carts(10), 4);
    expect(totalCarts(packets)).toBe(10);
    expect(new Set(packets.groups.flat()).size).toBe(10);
  });

  it('deals unevenly when the count does not divide', () => {
    const packets = dealPackets(A, carts(7), 3);
    expect(packets.groups.map((group) => group.length)).toEqual([3, 2, 2]);
  });

  it('treats one packet as no packeting at all', () => {
    expect(dealPackets(A, carts(4), 1).groups).toEqual([carts(4)]);
  });

  it('never deals fewer than one packet', () => {
    expect(packetCount(dealPackets(A, carts(4), 0))).toBe(1);
    expect(packetCount(dealPackets(A, carts(4), -3))).toBe(1);
  });

  it('deals an empty category into empty packets', () => {
    const packets = dealPackets(A, [], 3);
    expect(packetCount(packets)).toBe(3);
    expect(totalCarts(packets)).toBe(0);
  });

  it('has more packets than carts without losing any', () => {
    const packets = dealPackets(A, carts(2), 5);
    expect(totalCarts(packets)).toBe(2);
    expect(packets.groups.map((g) => g.length)).toEqual([1, 1, 0, 0, 0]);
  });

  it('finds which packet a cart landed in', () => {
    const packets = dealPackets(A, carts(6), 3);
    expect(packetOf(packets, 'M0001' as CartNumber)).toBe(0);
    expect(packetOf(packets, 'M0005' as CartNumber)).toBe(1);
    expect(packetOf(packets, 'M9999' as CartNumber)).toBeUndefined();
  });

  it('deals deterministically, so a rerun gives the same packets', () => {
    expect(dealPackets(A, carts(9), 4)).toEqual(dealPackets(A, carts(9), 4));
  });
});

describe('drawing through the packets', () => {
  it('takes one from each packet before coming back round', () => {
    const packets = dealPackets(A, carts(6), 3);
    expect(drawOrder(packets)).toEqual(['M0001', 'M0002', 'M0003', 'M0004', 'M0005', 'M0006']);
  });

  it('interleaves rather than emptying a packet first', () => {
    const packets = dealPackets(A, carts(6), 2);
    expect(packets.groups).toEqual([
      ['M0001', 'M0003', 'M0005'],
      ['M0002', 'M0004', 'M0006'],
    ]);
    expect(drawOrder(packets)).toEqual(['M0001', 'M0002', 'M0003', 'M0004', 'M0005', 'M0006']);
  });

  it('skips a packet that has run out and keeps drawing the rest', () => {
    const packets = dealPackets(A, carts(7), 3);
    expect(drawOrder(packets)).toHaveLength(7);
    expect(new Set(drawOrder(packets)).size).toBe(7);
    expect(drawOrder(packets)[6]).toBe('M0007');
  });

  it('draws every cart when the packets are very uneven', () => {
    const packets = dealPackets(A, carts(5), 4);
    expect(drawOrder(packets)).toEqual(['M0001', 'M0002', 'M0003', 'M0004', 'M0005']);
  });

  it('peeks without moving', () => {
    const packets = dealPackets(A, carts(6), 3);
    const cursor = startCursor(A);
    expect(peek(packets, cursor)).toBe('M0001');
    expect(peek(packets, cursor)).toBe('M0001');
  });

  it('moves one draw at a time', () => {
    const packets = dealPackets(A, carts(6), 3);
    let cursor = startCursor(A);
    cursor = advance(packets, cursor);
    expect(peek(packets, cursor)).toBe('M0002');
    cursor = advance(packets, cursor);
    cursor = advance(packets, cursor);
    expect(peek(packets, cursor)).toBe('M0004');
  });

  it('is spent once every cart has been drawn', () => {
    const packets = dealPackets(A, carts(4), 2);
    let cursor = startCursor(A);
    for (let step = 0; step < 4; step += 1) {
      expect(isSpent(packets, cursor)).toBe(false);
      cursor = advance(packets, cursor);
    }
    expect(isSpent(packets, cursor)).toBe(true);
    expect(peek(packets, cursor)).toBeUndefined();
  });

  it('is spent immediately on an empty category', () => {
    const packets = dealPackets(A, [], 3);
    expect(isSpent(packets, startCursor(A))).toBe(true);
    expect(drawOrder(packets)).toEqual([]);
  });

  it('changes the draw order when the rest order changes', () => {
    const forward = drawOrder(dealPackets(A, carts(6), 3));
    const reversed = drawOrder(dealPackets(A, [...carts(6)].reverse(), 3));
    expect(reversed).not.toEqual(forward);
    expect(new Set(reversed)).toEqual(new Set(forward));
  });

  it('spreads a cart differently for a different packet count', () => {
    const two = dealPackets(A, carts(6), 2);
    const three = dealPackets(A, carts(6), 3);
    expect(packetOf(two, 'M0003' as CartNumber)).toBe(0);
    expect(packetOf(three, 'M0003' as CartNumber)).toBe(2);
  });
});
