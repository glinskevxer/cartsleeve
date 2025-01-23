/**
 * Clocks.
 *
 * A clock is an hour template. It is an ordered list of elements, each of which
 * is either a category slot the scheduler fills or a fixed item that is always
 * the same cart. Every station runs a handful of clocks and assigns one to each
 * hour of the week.
 *
 * The order is the hour. Element three follows element two whatever their
 * target times say, and the target times are goals rather than commitments,
 * because music does not come in convenient lengths.
 */

import { parseCategoryCode } from '../util/ids.js';
import type { CartNumber, CategoryCode } from '../util/ids.js';
import { parseCartNumber } from '../util/ids.js';
import { fromMinutes, parseDuration } from '../util/duration.js';
import type { Tenths } from '../util/duration.js';
import { codeFor, error } from '../util/problem.js';
import type { Problem } from '../util/problem.js';
import { err, ok } from '../util/result.js';
import type { Result } from '../util/result.js';

export type ElementKind = 'music' | 'fixed' | 'stopset' | 'news';

/** A slot the scheduler fills from a category. */
export interface MusicElement {
  readonly kind: 'music';
  readonly position: number;
  readonly category: CategoryCode;
  /** Where in the hour this element is meant to land. */
  readonly target: Tenths;
  /** Element may not be the first or last music in the hour. */
  readonly noOpen?: boolean;
  readonly noClose?: boolean;
}

/** A named cart that always airs here. */
export interface FixedElement {
  readonly kind: 'fixed';
  readonly position: number;
  readonly cart: CartNumber;
  readonly target: Tenths;
}

/** A commercial break. What goes in it comes from the traffic log. */
export interface StopsetElement {
  readonly kind: 'stopset';
  readonly position: number;
  readonly name: string;
  readonly target: Tenths;
  /** How much commercial time this break is built to hold. */
  readonly budget: Tenths;
}

export interface NewsElement {
  readonly kind: 'news';
  readonly position: number;
  readonly target: Tenths;
  readonly length: Tenths;
}

export type ClockElement = MusicElement | FixedElement | StopsetElement | NewsElement;

export interface Clock {
  readonly name: string;
  readonly elements: readonly ClockElement[];
}

export interface ElementInput {
  readonly kind: ElementKind;
  readonly target: string;
  readonly category?: string;
  readonly cart?: string;
  readonly name?: string;
  readonly budget?: string;
  readonly length?: string;
  readonly noOpen?: boolean;
  readonly noClose?: boolean;
}

const CLK = (n: number): string => codeFor('clock', n);

export const HOUR_TENTHS = fromMinutes(60);

function buildElement(
  input: ElementInput,
  position: number,
  problems: Problem[],
): ClockElement | undefined {
  const where = `element ${position}`;
  const target = parseDuration(input.target);
  if (!target.ok) {
    problems.push(error(CLK(30), where, `target ${target.error.reason}`));
    return undefined;
  }
  if (target.value >= HOUR_TENTHS) {
    problems.push(error(CLK(31), where, 'has a target past the end of the hour'));
    return undefined;
  }
  switch (input.kind) {
    case 'music': {
      const category = parseCategoryCode(input.category ?? '');
      if (!category.ok) {
        problems.push(error(CLK(32), where, 'is a music element with no usable category'));
        return undefined;
      }
      const base = {
        kind: 'music',
        position,
        category: category.value,
        target: target.value,
      } as const;
      return {
        ...base,
        ...(input.noOpen === undefined ? {} : { noOpen: input.noOpen }),
        ...(input.noClose === undefined ? {} : { noClose: input.noClose }),
      };
    }
    case 'fixed': {
      const cart = parseCartNumber(input.cart ?? '');
      if (!cart.ok) {
        problems.push(error(CLK(33), where, 'is a fixed element with no usable cart number'));
        return undefined;
      }
      return { kind: 'fixed', position, cart: cart.value, target: target.value };
    }
    case 'stopset': {
      const name = (input.name ?? '').trim();
      if (name.length === 0) {
        problems.push(error(CLK(34), where, 'is a stopset with no name'));
        return undefined;
      }
      const budget = parseDuration(input.budget ?? '2:00');
      if (!budget.ok) {
        problems.push(error(CLK(35), where, `stopset budget ${budget.error.reason}`));
        return undefined;
      }
      return { kind: 'stopset', position, name, target: target.value, budget: budget.value };
    }
    case 'news': {
      const length = parseDuration(input.length ?? '3:00');
      if (!length.ok) {
        problems.push(error(CLK(36), where, `news length ${length.error.reason}`));
        return undefined;
      }
      return { kind: 'news', position, target: target.value, length: length.value };
    }
    default:
      problems.push(error(CLK(37), where, 'has an element kind nothing understands'));
      return undefined;
  }
}

export function makeClock(name: string, inputs: readonly ElementInput[]): Result<Clock, Problem[]> {
  const problems: Problem[] = [];
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    problems.push(error(CLK(38), name, 'has no name'));
  }
  if (inputs.length === 0) {
    problems.push(error(CLK(39), trimmed, 'has no elements'));
  }
  const elements: ClockElement[] = [];
  for (const [position, input] of inputs.entries()) {
    const element = buildElement(input, position, problems);
    if (element !== undefined) {
      elements.push(element);
    }
  }
  for (let index = 1; index < elements.length; index += 1) {
    const previous = elements[index - 1];
    const current = elements[index];
    if (previous !== undefined && current !== undefined && current.target < previous.target) {
      problems.push(
        error(
          CLK(40),
          `${trimmed} element ${index}`,
          'has a target earlier than the one before it',
          {
            target: current.target,
            previous: previous.target,
          },
        ),
      );
    }
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ name: trimmed, elements });
}

export function musicElements(clock: Clock): MusicElement[] {
  return clock.elements.filter((element): element is MusicElement => element.kind === 'music');
}

export function stopsets(clock: Clock): StopsetElement[] {
  return clock.elements.filter((element): element is StopsetElement => element.kind === 'stopset');
}

export function musicCount(clock: Clock): number {
  return musicElements(clock).length;
}

/** How many music slots the clock gives each category. */
export function categoryDemand(clock: Clock): Map<CategoryCode, number> {
  const demand = new Map<CategoryCode, number>();
  for (const element of musicElements(clock)) {
    demand.set(element.category, (demand.get(element.category) ?? 0) + 1);
  }
  return demand;
}

/** Commercial time the clock is built to carry, before traffic sells into it. */
export function stopsetBudget(clock: Clock): Tenths {
  let total = 0;
  for (const element of stopsets(clock)) {
    total += element.budget;
  }
  return total as Tenths;
}

export function elementAt(clock: Clock, position: number): ClockElement | undefined {
  return clock.elements[position];
}

/** The first and last music elements, which the open and close rules need. */
export function musicBounds(clock: Clock): { first?: number; last?: number } {
  const music = musicElements(clock);
  const first = music[0]?.position;
  const last = music[music.length - 1]?.position;
  return {
    ...(first === undefined ? {} : { first }),
    ...(last === undefined ? {} : { last }),
  };
}

export function describeElement(element: ClockElement): string {
  switch (element.kind) {
    case 'music':
      return `${element.position} music ${element.category}`;
    case 'fixed':
      return `${element.position} fixed ${element.cart}`;
    case 'stopset':
      return `${element.position} stopset ${element.name}`;
    case 'news':
      return `${element.position} news`;
  }
}
