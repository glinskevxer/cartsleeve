/**
 * The library, category and clock commands.
 *
 * Commands build a request and hand it to the same dispatcher everything else
 * uses. Nothing here reaches into a service, which is the point: an operation
 * that can be done at the command line can be done in a batch file, and one
 * that cannot be done through the api cannot be smuggled in from here.
 *
 * The only real work in this file is turning command line shapes into request
 * shapes. A clock element on a command line is a comma separated string because
 * that is what fits on a line an operator types, and it is a nested object in a
 * request because that is what fits a schema.
 */

import { Command } from 'commander';
import type { ApiResponse } from '../api/envelope.js';

/** How a command reaches the api. One function, so tests can stand in for it. */
export type Runner = (op: string, params: Record<string, unknown>) => ApiResponse<unknown>;

/** Where a command's output goes. */
export type Sink = (response: ApiResponse<unknown>) => void;

export interface ElementProblem {
  readonly text: string;
  readonly reason: string;
}

const ELEMENT_KINDS = new Set(['music', 'fixed', 'stopset', 'news']);
const ELEMENT_KEYS = new Set(['category', 'cart', 'name', 'budget', 'length']);
const ELEMENT_FLAGS = new Set(['noOpen', 'noClose']);

/**
 * Read one clock element off the command line.
 *
 * The shape is `kind,target` and then any number of `key=value` pairs, so
 * `music,0:00,category=A` and `stopset,10:00,budget=3:00,name=break one` both
 * read. An unknown key is refused rather than dropped, because a typed
 * `catagory=A` that is quietly ignored builds a clock nobody asked for.
 */
export function parseElement(text: string): Record<string, unknown> | ElementProblem {
  const parts = text.split(',').map((part) => part.trim());
  const kind = parts[0] ?? '';
  const target = parts[1] ?? '';
  if (!ELEMENT_KINDS.has(kind)) {
    return { text, reason: `${kind === '' ? 'an element' : kind} is not a kind of element` };
  }
  if (target === '') {
    return { text, reason: 'has no target time' };
  }
  const element: Record<string, unknown> = { kind, target };
  for (const part of parts.slice(2)) {
    if (part === '') {
      continue;
    }
    const split = part.indexOf('=');
    const key = split < 0 ? part : part.slice(0, split);
    const value = split < 0 ? '' : part.slice(split + 1);
    if (ELEMENT_FLAGS.has(key)) {
      element[key] = value === '' || value === 'true';
    } else if (ELEMENT_KEYS.has(key)) {
      element[key] = value;
    } else {
      return { text, reason: `${key} is not something an element carries` };
    }
  }
  return element;
}

export function isElementProblem(value: unknown): value is ElementProblem {
  return typeof value === 'object' && value !== null && 'reason' in value;
}

/** Only the options the caller actually gave, so a schema sees no empty keys. */
function given(options: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of keys) {
    const value = options[key];
    if (value !== undefined) {
      kept[key] = value;
    }
  }
  return kept;
}

const CART_KEYS = ['number', 'title', 'billed', 'runtime', 'category', 'intro', 'endType', 'tail'];

function cartOptions(command: Command): Command {
  return command
    .requiredOption('--number <cart>', 'cart number')
    .requiredOption('--title <title>', 'title as it is billed')
    .requiredOption('--runtime <duration>', 'runtime, as 3:12')
    .option('--billed <artist>', 'artist billing')
    .option('--category <code>', 'category to file it in')
    .option('--intro <duration>', 'intro length')
    .option('--endType <type>', 'cold, fade or segue')
    .option('--tail <duration>', 'tail length');
}

function withRecording(command: Command): Command {
  return command
    .option('--isrc <isrc>', 'recording code, if the cart has one')
    .option('--label <label>', 'label to be paid')
    .option('--payee <payee>', 'payee, if it is not the label')
    .option('--recordingTitle <title>', 'recording title, if it differs from the cart')
    .option('--releaseYear <year>', 'year of release');
}

function recordingFrom(options: Record<string, unknown>): Record<string, unknown> | undefined {
  if (options['isrc'] === undefined) {
    return undefined;
  }
  const year = Number(options['releaseYear']);
  return {
    isrc: options['isrc'],
    title: options['recordingTitle'] ?? options['title'],
    label: options['label'] ?? '',
    releaseYear: Number.isNaN(year) ? 0 : year,
    ...(options['payee'] === undefined ? {} : { payee: options['payee'] }),
  };
}

function cartRequest(options: Record<string, unknown>): Record<string, unknown> {
  const recording = recordingFrom(options);
  return {
    cart: given(options, CART_KEYS),
    ...(recording === undefined ? {} : { recording }),
  };
}

export function libraryCommand(run: Runner, out: Sink): Command {
  const library = new Command('library').description('carts and what is on them');

  withRecording(cartOptions(library.command('add').description('add a cart'))).action(
    (options: Record<string, unknown>) => {
      out(run('library.add', cartRequest(options)));
    },
  );

  withRecording(cartOptions(library.command('update').description('replace a cart'))).action(
    (options: Record<string, unknown>) => {
      out(run('library.update', cartRequest(options)));
    },
  );

  library
    .command('remove')
    .description('take a cart out')
    .argument('<cart>', 'cart number')
    .action((cart: string) => {
      out(run('library.remove', { cart }));
    });

  library
    .command('card')
    .description('move a cart into another category')
    .argument('<cart>', 'cart number')
    .argument('<to>', 'category to move it to')
    .option('--note <note>', 'why it moved')
    .action((cart: string, to: string, options: Record<string, unknown>) => {
      out(run('library.card', { cart, to, ...given(options, ['note']) }));
    });

  library
    .command('get')
    .description('read one cart')
    .argument('<cart>', 'cart number')
    .action((cart: string) => {
      out(run('library.get', { cart }));
    });

  library
    .command('count')
    .description('count the carts')
    .option('--category <code>', 'count one category')
    .action((options: Record<string, unknown>) => {
      out(run('library.count', given(options, ['category'])));
    });

  return library;
}

export function categoryCommand(run: Runner, out: Sink): Command {
  const category = new Command('category').description('rotation categories');

  category
    .command('add')
    .description('define a category')
    .argument('<code>', 'category code')
    .argument('<name>', 'what it is called')
    .option('--packets <n>', 'how many groups it rotates in', Number)
    .option('--priority <n>', 'lower runs first', Number)
    .option('--artistMinutes <n>', 'artist separation', Number)
    .option('--titleMinutes <n>', 'title separation', Number)
    .action((code: string, name: string, options: Record<string, unknown>) => {
      out(
        run('category.add', {
          code,
          name,
          ...given(options, ['packets', 'priority', 'artistMinutes', 'titleMinutes']),
        }),
      );
    });

  return category;
}

function collectElement(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function clockRequest(
  name: string,
  texts: readonly string[],
): { request: Record<string, unknown> } | { problems: ElementProblem[] } {
  const elements: Record<string, unknown>[] = [];
  const problems: ElementProblem[] = [];
  for (const text of texts) {
    const parsed = parseElement(text);
    if (isElementProblem(parsed)) {
      problems.push(parsed);
    } else {
      elements.push(parsed);
    }
  }
  return problems.length > 0 ? { problems } : { request: { name, elements } };
}

/**
 * A bad element never becomes a request. The api would refuse it too, but it
 * would refuse it as a schema issue on `elements.3.kind`, and the operator
 * typed a string, not an array index.
 */
export function clockCommand(run: Runner, out: Sink, fail: (lines: string[]) => void): Command {
  const clock = new Command('clock').description('the hour templates the day runs on');

  const writing = (op: string, verb: string): void => {
    clock
      .command(verb)
      .description(`${verb} a clock`)
      .argument('<name>', 'clock name')
      .requiredOption(
        '--element <spec>',
        'kind,target,key=value, repeatable',
        collectElement,
        [] as string[],
      )
      .action((name: string, options: Record<string, unknown>) => {
        const built = clockRequest(name, (options['element'] as string[] | undefined) ?? []);
        if ('problems' in built) {
          fail(built.problems.map((problem) => `bad element "${problem.text}": ${problem.reason}`));
          return;
        }
        out(run(op, built.request));
      });
  };

  writing('clock.add', 'add');
  writing('clock.replace', 'replace');

  clock
    .command('get')
    .description('read one clock')
    .argument('<name>', 'clock name')
    .action((name: string) => {
      out(run('clock.get', { name }));
    });

  clock
    .command('list')
    .description('list the clocks')
    .action(() => {
      out(run('clock.list', {}));
    });

  return clock;
}
