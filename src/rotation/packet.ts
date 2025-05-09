/**
 * Packets.
 *
 * A gold category of four hundred carts rotated purely on rest plays them in a
 * strict cycle, which is the one thing rotation is meant to avoid: the same four
 * hundred records in the same order, every fortnight, forever. Regular listeners
 * notice within a month.
 *
 * A packet is a slice of the category. The scheduler draws from one packet until
 * it is spent, then moves to the next, and the packets are dealt round robin by
 * rest rather than cut into contiguous blocks. So the cycle length is unchanged
 * but the order inside it moves every time round, because which packet a cart
 * lands in depends on where it sat in the rest order when the packets were dealt.
 *
 * The assignment is deterministic given the same rest order, which matters: a
 * rerun of the same day has to produce the same log.
 */

import type { CartNumber, CategoryCode } from '../util/ids.js';

export interface Packets {
  readonly category: CategoryCode;
  /** One list per packet, in draw order inside each. */
  readonly groups: readonly (readonly CartNumber[])[];
}

export interface PacketCursor {
  readonly category: CategoryCode;
  /** Which packet is being drawn from. */
  readonly packet: number;
  /** How far into that packet the draw has reached. */
  readonly offset: number;
}

/**
 * Deal the rest ordered carts into packets round robin, so the best rested
 * carts are spread one per packet rather than piled into the first.
 */
export function dealPackets(
  category: CategoryCode,
  ordered: readonly CartNumber[],
  count: number,
): Packets {
  const size = Math.max(1, Math.trunc(count));
  const groups: CartNumber[][] = Array.from({ length: size }, () => []);
  for (const [index, cart] of ordered.entries()) {
    const bucket = groups[index % size];
    if (bucket !== undefined) {
      bucket.push(cart);
    }
  }
  return { category, groups };
}

export function packetCount(packets: Packets): number {
  return packets.groups.length;
}

export function packetOf(packets: Packets, cart: CartNumber): number | undefined {
  for (const [index, group] of packets.groups.entries()) {
    if (group.includes(cart)) {
      return index;
    }
  }
  return undefined;
}

export function totalCarts(packets: Packets): number {
  return packets.groups.reduce((sum, group) => sum + group.length, 0);
}

export function startCursor(category: CategoryCode): PacketCursor {
  return { category, packet: 0, offset: 0 };
}

/**
 * Move a cursor forward to the next position that actually holds a cart.
 *
 * Packets are rarely the same size, so a cursor can land past the end of a short
 * packet while longer ones still have carts. Walking the interleaved sequence
 * forward is the only way to skip those without also skipping a cart, and doing
 * it in one place is what keeps `peek`, `advance` and `isSpent` agreeing.
 */
function normalise(packets: Packets, cursor: PacketCursor): PacketCursor | undefined {
  const size = packetCount(packets);
  const deepest = packets.groups.reduce((max, group) => Math.max(max, group.length), 0);
  let packet = cursor.packet;
  let offset = cursor.offset;
  while (offset < deepest) {
    if ((packets.groups[packet] ?? [])[offset] !== undefined) {
      return { category: cursor.category, packet, offset };
    }
    packet += 1;
    if (packet >= size) {
      packet = 0;
      offset += 1;
    }
  }
  return undefined;
}

/** The cart the cursor points at, or nothing once the category is spent. */
export function peek(packets: Packets, cursor: PacketCursor): CartNumber | undefined {
  const at = normalise(packets, cursor);
  if (at === undefined) {
    return undefined;
  }
  return (packets.groups[at.packet] ?? [])[at.offset];
}

/**
 * Move the cursor on by one draw. Advancing off the end of a packet moves to the
 * next packet rather than deeper into this one, which is what spreads the
 * category, and wrapping past the last packet starts the next lap one deeper.
 */
export function advance(packets: Packets, cursor: PacketCursor): PacketCursor {
  const at = normalise(packets, cursor) ?? cursor;
  const size = packetCount(packets);
  const nextPacket = at.packet + 1;
  const raw: PacketCursor =
    nextPacket >= size
      ? { category: cursor.category, packet: 0, offset: at.offset + 1 }
      : { category: cursor.category, packet: nextPacket, offset: at.offset };
  return normalise(packets, raw) ?? raw;
}

/** Whether the cursor has been drawn past every cart in the category. */
export function isSpent(packets: Packets, cursor: PacketCursor): boolean {
  return normalise(packets, cursor) === undefined;
}

/** The draw order a full cycle produces, which is the packet interleaving. */
export function drawOrder(packets: Packets): CartNumber[] {
  const out: CartNumber[] = [];
  let cursor = startCursor(packets.category);
  while (!isSpent(packets, cursor)) {
    const cart = peek(packets, cursor);
    if (cart === undefined) {
      break;
    }
    out.push(cart);
    cursor = advance(packets, cursor);
  }
  return out;
}
