import type { RuleContext, Slot } from '../../src/rules/rule.js';
import { makeScheduleView } from '../../src/rules/schedule-view.js';
import type { ScheduleView } from '../../src/rules/schedule-view.js';
import type { Placed } from '../../src/rules/rule.js';
import { STANDARD_CATEGORIES, makeCategory } from '../../src/domain/category.js';
import type { Category } from '../../src/domain/category.js';
import { COUNTRY_BANDS, makeEraMap } from '../../src/library/era.js';
import { STANDARD_FAMILIES, makeSoundIndex } from '../../src/library/sounds.js';
import type { CategoryCode } from '../../src/util/ids.js';
import { tenths } from '../../src/util/duration.js';
import { cellOf } from '../../src/domain/daypart.js';
import type { LibraryEntry } from '../../src/library/library.js';
import type { StationInput } from '../../src/domain/station.js';
import { entry, station } from './fixtures.js';
import type { EntrySpec } from './fixtures.js';
import { expectOk } from './result.js';

export const CATEGORIES = new Map<CategoryCode, Category>(
  STANDARD_CATEGORIES.map((input) => {
    const built = expectOk(makeCategory(input));
    return [built.code, built];
  }),
);

export interface ContextSpec {
  readonly placed?: readonly Placed[];
  readonly candidate?: LibraryEntry | EntrySpec;
  readonly slot?: Partial<Slot>;
  readonly stationOptions?: Partial<StationInput>;
  readonly categories?: ReadonlyMap<CategoryCode, Category>;
}

function isEntry(value: LibraryEntry | EntrySpec): value is LibraryEntry {
  return 'cart' in value;
}

/** Build a rule context around a candidate and a partly filled log. */
export function ruleContext(spec: ContextSpec = {}): RuleContext {
  const view: ScheduleView = makeScheduleView(spec.placed ?? []);
  const candidate = spec.candidate ?? {};
  return {
    station: station(spec.stationOptions ?? {}),
    categories: spec.categories ?? CATEGORIES,
    sounds: expectOk(makeSoundIndex(STANDARD_FAMILIES)),
    eras: expectOk(makeEraMap(COUNTRY_BANDS)),
    schedule: view,
    slot: {
      position: 9,
      at: tenths(12_000),
      category: 'A' as CategoryCode,
      cell: cellOf(1, 7),
      day: { year: 2025, month: 6, day: 10 },
      opensHour: false,
      closesHour: false,
      ...spec.slot,
    },
    candidate: isEntry(candidate) ? candidate : entry(candidate),
  };
}
