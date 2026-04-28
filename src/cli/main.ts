#!/usr/bin/env node
/**
 * The entry point.
 *
 * Two things happen here that cannot happen anywhere else, and nothing else
 * does. The journal directory is read off the argument list before commander
 * sees it, because the router cannot be built without a journal and commander
 * does not parse until the router exists. And the station is built from the
 * environment, because a call sign is not a thing to type on every command.
 */

import { readFileSync } from 'node:fs';
import { buildProgram } from './program.js';
import { emptyState } from '../service/station-service.js';
import { Journal } from '../store/append.js';
import { FileStorage } from '../store/storage.js';
import { STANDARD_CATEGORIES, makeCategory } from '../domain/category.js';
import { makeStation } from '../domain/station.js';
import type { StationState } from '../service/station-service.js';

/** Read an option out of the argument list before commander gets to it. */
function early(argv: readonly string[], flag: string, fallback: string): string {
  const at = argv.indexOf(flag);
  return at >= 0 ? (argv[at + 1] ?? fallback) : fallback;
}

function startingState(): StationState {
  const built = makeStation({
    callSign: process.env['CARTSLEEVE_CALLSIGN'] ?? 'KHRT',
    name: process.env['CARTSLEEVE_NAME'] ?? 'Heart Country',
    format: process.env['CARTSLEEVE_FORMAT'] ?? 'country',
    dayStartHour: Number(process.env['CARTSLEEVE_DAY_START'] ?? '5'),
  });
  if (!built.ok) {
    for (const problem of built.error) {
      process.stderr.write(`${problem.code} ${problem.subject}: ${problem.message}\n`);
    }
    process.exit(2);
  }
  let state = emptyState(built.value);
  for (const input of STANDARD_CATEGORIES) {
    const category = makeCategory(input);
    if (category.ok) {
      const categories = new Map(state.categories);
      categories.set(category.value.code, category.value);
      state = { ...state, categories };
    }
  }
  return state;
}

const argv = process.argv.slice(2);
const journal = Journal.open(new FileStorage(early(argv, '--journal', 'journal')));
const built = buildProgram({
  state: startingState(),
  journal,
  write: (line) => process.stdout.write(`${line}\n`),
  readFile: (path) => readFileSync(path, 'utf8'),
});

built.program.option('--journal <dir>', 'where the journal is kept', 'journal');
built.program.parse(argv, { from: 'user' });
process.exitCode = built.status();
