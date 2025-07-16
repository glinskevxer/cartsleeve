import { beforeEach, describe, expect, it } from 'vitest';
import {
  BAD_CLOSER,
  BAD_OPENER,
  OPENER_MAX_INTRO,
  closerRule,
  couldClose,
  couldOpen,
  endsCold,
  hasLongIntro,
  isSlowOpener,
  openerRule,
} from '../../src/rules/position-rules.js';
import { ruleContext } from '../support/context.js';
import type { ContextSpec } from '../support/context.js';
import { resetFixtures } from '../support/fixtures.js';

beforeEach(() => {
  resetFixtures();
});

const opening = (extra: ContextSpec = {}) => ruleContext({ slot: { opensHour: true }, ...extra });
const closing = (extra: ContextSpec = {}) => ruleContext({ slot: { closesHour: true }, ...extra });

describe('isSlowOpener', () => {
  it('calls a ballad and a slow record slow', () => {
    expect(isSlowOpener(ruleContext({ candidate: { tempo: 'ballad' } }))).toBe(true);
    expect(isSlowOpener(ruleContext({ candidate: { tempo: 'slow' } }))).toBe(true);
  });

  it('calls anything faster fine', () => {
    for (const tempo of ['medium', 'bright', 'up', 'driving']) {
      expect(isSlowOpener(ruleContext({ candidate: { tempo } }))).toBe(false);
    }
  });

  it('says nothing about an uncoded cart', () => {
    expect(isSlowOpener(ruleContext())).toBe(false);
  });
});

describe('hasLongIntro', () => {
  it('reads the ramp off the cart timing', () => {
    expect(hasLongIntro(ruleContext({ candidate: { intro: '0:30' } }))).toBe(true);
    expect(hasLongIntro(ruleContext({ candidate: { intro: '0:10' } }))).toBe(false);
  });

  it('passes exactly on the limit', () => {
    expect(OPENER_MAX_INTRO).toBe(250);
    expect(hasLongIntro(ruleContext({ candidate: { intro: '0:25' } }))).toBe(false);
    expect(hasLongIntro(ruleContext({ candidate: { intro: '0:25.1' } }))).toBe(true);
  });
});

describe('openerRule', () => {
  it('passes any candidate in a slot that does not open the hour', () => {
    expect(openerRule.evaluate(ruleContext({ candidate: { tempo: 'ballad' } })).passed).toBe(true);
  });

  it('rejects a ballad opening the hour and says the tempo was why', () => {
    const verdict = openerRule.evaluate(opening({ candidate: { tempo: 'ballad' } }));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(BAD_OPENER);
      expect(verdict.failure.detail?.['reason']).toBe('tempo');
    }
  });

  it('rejects a long ramp opening the hour and says the intro was why', () => {
    const verdict = openerRule.evaluate(opening({ candidate: { tempo: 'up', intro: '0:35' } }));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.detail?.['reason']).toBe('intro');
      expect(verdict.failure.detail?.['allowed']).toBe(OPENER_MAX_INTRO);
    }
  });

  it('reports the tempo first when both would fire', () => {
    const verdict = openerRule.evaluate(opening({ candidate: { tempo: 'ballad', intro: '0:35' } }));
    if (!verdict.passed) {
      expect(verdict.failure.detail?.['reason']).toBe('tempo');
    }
  });

  it('passes a bright record with a short ramp', () => {
    expect(openerRule.evaluate(opening({ candidate: { tempo: 'up', intro: '0:08' } })).passed).toBe(
      true,
    );
  });

  it('passes an uncoded cart with no ramp', () => {
    expect(openerRule.evaluate(opening()).passed).toBe(true);
  });
});

describe('closerRule', () => {
  it('passes any candidate in a slot that does not close the hour', () => {
    const context = ruleContext({ candidate: { endType: 'fade', tail: '0:06' } });
    expect(closerRule.evaluate(context).passed).toBe(true);
  });

  it('rejects a fade closing the hour into the news', () => {
    const verdict = closerRule.evaluate(closing({ candidate: { endType: 'fade', tail: '0:06' } }));
    expect(verdict.passed).toBe(false);
    if (!verdict.passed) {
      expect(verdict.failure.code).toBe(BAD_CLOSER);
      expect(verdict.failure.detail?.['endType']).toBe('fade');
    }
  });

  it('rejects a sustain closing the hour too', () => {
    const context = closing({ candidate: { endType: 'sustain', tail: '0:06' } });
    expect(closerRule.evaluate(context).passed).toBe(false);
  });

  it('passes a cold ending', () => {
    expect(closerRule.evaluate(closing({ candidate: { endType: 'cold' } })).passed).toBe(true);
    expect(closerRule.evaluate(closing()).passed).toBe(true);
  });

  it('reads the ending off the cart', () => {
    expect(endsCold(ruleContext({ candidate: { endType: 'cold' } }))).toBe(true);
    expect(endsCold(ruleContext({ candidate: { endType: 'fade', tail: '0:06' } }))).toBe(false);
  });
});

describe('couldOpen and couldClose', () => {
  it('answer without caring where the slot is', () => {
    expect(couldOpen(ruleContext({ candidate: { tempo: 'up', intro: '0:08' } }))).toBe(true);
    expect(couldOpen(ruleContext({ candidate: { tempo: 'ballad' } }))).toBe(false);
    expect(couldClose(ruleContext({ candidate: { endType: 'cold' } }))).toBe(true);
    expect(couldClose(ruleContext({ candidate: { endType: 'fade', tail: '0:06' } }))).toBe(false);
  });

  it('agree with the opener rule when the slot does open', () => {
    for (const tempo of ['ballad', 'up']) {
      const context = opening({ candidate: { tempo } });
      expect(couldOpen(context)).toBe(openerRule.evaluate(context).passed);
    }
  });

  it('agree with the closer rule when the slot does close', () => {
    for (const endType of ['cold', 'fade']) {
      const tail = endType === 'cold' ? '0:00' : '0:06';
      const context = closing({ candidate: { endType, tail } });
      expect(couldClose(context)).toBe(closerRule.evaluate(context).passed);
    }
  });

  it('find a cart that can do both', () => {
    const context = ruleContext({ candidate: { tempo: 'up', intro: '0:08', endType: 'cold' } });
    expect(couldOpen(context) && couldClose(context)).toBe(true);
  });
});
