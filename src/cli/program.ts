/**
 * The program.
 *
 * One invocation is one session. The station lives in memory for the life of
 * the process and the journal records what was done to it, which is the right
 * way round for the work this tool actually does: a nightly run loads the
 * library, schedules the day, merges traffic and prints the reports, and none
 * of that wants a process that has been running since Tuesday.
 *
 * That is why `batch` matters more than it looks. A file of requests is a whole
 * run in one session, in order, against one journal, and it is the only way to
 * do a real day's work at the command line. The single commands are for reading
 * and for the one off fix.
 */

import { Command } from 'commander';
import { Router } from '../api/dispatch.js';
import type { BatchOptions } from '../api/dispatch.js';
import { describeRoutes } from '../api/dispatch.js';
import type { ApiResponse } from '../api/envelope.js';
import { libraryRoutes } from '../api/library-handlers.js';
import { clockRoutes } from '../api/clock-handlers.js';
import { ScheduleSession, scheduleRoutes } from '../api/schedule-handlers.js';
import { reportRoutes } from '../api/report-handlers.js';
import { trafficRoutes } from '../api/traffic-handlers.js';
import { airedRoutes } from '../api/aired-handlers.js';
import { ScheduleService } from '../service/schedule-service.js';
import { ReportService } from '../service/report-service.js';
import { StationService } from '../service/station-service.js';
import type { StationState } from '../service/station-service.js';
import type { Journal } from '../store/append.js';
import { exitCode, renderResponse } from './render.js';
import type { Severity } from '../util/problem.js';
import { libraryCommand, categoryCommand, clockCommand } from './station-commands.js';
import type { ReadFile } from './schedule-commands.js';
import { scheduleCommand, trafficCommand } from './schedule-commands.js';
import { reportCommand } from './report-commands.js';
import { airedCommand } from './aired-commands.js';

export const VERSION = '0.15.0';

export interface ProgramInput {
  readonly state: StationState;
  readonly journal: Journal;
  /** Where output goes. One line at a time, so a caller can pipe it. */
  readonly write: (line: string) => void;
  readonly readFile: ReadFile;
  /** The clock every request is stamped with. Injected so a test can hold it. */
  readonly now?: () => number;
}

export interface BuiltProgram {
  readonly program: Command;
  readonly router: Router;
  /** The worst exit code any request in this run produced. */
  readonly status: () => number;
}

interface BatchFile {
  readonly requests: unknown[];
}

/** A batch file is either a bare list of requests or an object holding one. */
function requestsIn(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) {
    return parsed as unknown[];
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as BatchFile).requests)
  ) {
    return (parsed as BatchFile).requests;
  }
  return undefined;
}

export function buildProgram(input: ProgramInput): BuiltProgram {
  const clock = input.now ?? ((): number => Date.now());
  const stationService = new StationService(input.state, input.journal);
  const session = new ScheduleSession();
  const reportService = new ReportService(input.journal);
  const router = new Router([
    ...libraryRoutes(stationService),
    ...clockRoutes(stationService),
    ...scheduleRoutes(stationService, new ScheduleService(input.journal), session),
    ...reportRoutes(stationService, reportService, session),
    ...trafficRoutes(stationService, session),
    ...airedRoutes(stationService, reportService, session),
  ]);

  const program = new Command('cartsleeve')
    .description('music rotation scheduling, traffic merge and royalty reporting')
    .version(VERSION)
    .option('--json', 'print the whole response as json')
    .option('--verbose', 'print the notes as well as the warnings')
    .option('--read-only', 'refuse every operation that would write');

  let worst = 0;
  let sequence = 0;

  const options = (): BatchOptions =>
    program.opts()['readOnly'] === true ? { readOnly: true } : {};

  const floor = (): Severity => (program.opts()['verbose'] === true ? 'info' : 'warning');

  const show = (response: ApiResponse<unknown>): void => {
    for (const line of renderResponse(response, {
      json: program.opts()['json'] === true,
      floor: floor(),
    })) {
      input.write(line);
    }
    worst = Math.max(worst, exitCode(response));
  };

  const run = (op: string, params: Record<string, unknown>): ApiResponse<unknown> => {
    sequence += 1;
    return router.run({ op, id: `cli-${sequence}`, at: clock(), params }, options());
  };

  const fail = (lines: readonly string[]): void => {
    for (const line of lines) {
      input.write(line);
    }
    worst = 1;
  };

  program.addCommand(libraryCommand(run, show));
  program.addCommand(categoryCommand(run, show));
  program.addCommand(clockCommand(run, show, fail));
  program.addCommand(scheduleCommand(run, show, fail));
  program.addCommand(trafficCommand(run, show, fail, input.readFile));
  program.addCommand(reportCommand(run, show, fail));
  program.addCommand(
    airedCommand({ run, out: show, fail, note: input.write, readFile: input.readFile }),
  );

  program
    .command('ops')
    .description('every operation this build knows')
    .action(() => {
      for (const route of describeRoutes(router)) {
        input.write(`${route.writes ? 'w' : 'r'} ${route.op.padEnd(18)} ${route.summary}`);
      }
    });

  program
    .command('batch')
    .description('run a file of requests in order, in one session')
    .argument('<path>', 'a json file holding a list of requests')
    .option('--stop', 'stop at the first refusal')
    .action((path: string, batchOptions: Record<string, unknown>) => {
      let text: string;
      try {
        text = input.readFile(path);
      } catch (thrown: unknown) {
        fail([`cannot read ${path}: ${thrown instanceof Error ? thrown.message : String(thrown)}`]);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        fail([`${path} is not json`]);
        return;
      }
      const requests = requestsIn(parsed);
      if (requests === undefined) {
        fail([`${path} holds no list of requests`]);
        return;
      }
      const responses = router.handleBatch(requests, {
        ...options(),
        ...(batchOptions['stop'] === true ? { stopOnRefusal: true } : {}),
      });
      for (const response of responses) {
        show(response);
      }
      if (responses.length < requests.length) {
        input.write(`stopped after ${responses.length} of ${requests.length} requests`);
      }
    });

  return { program, router, status: (): number => worst };
}
