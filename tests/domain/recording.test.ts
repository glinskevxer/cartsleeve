import { describe, expect, it } from 'vitest';
import {
  EARLIEST_RELEASE_YEAR,
  auditRecording,
  compareRecordings,
  describeRecording,
  isCover,
  isSameRecording,
  makeRecording,
  titleKey,
} from '../../src/domain/recording.js';
import type { RecordingInput } from '../../src/domain/recording.js';
import { expectErr, expectOk } from '../support/result.js';

const NOW = 2025;

const JOLENE: RecordingInput = {
  isrc: 'USRC17607839',
  title: 'Jolene',
  label: 'RCA Victor',
  releaseYear: 1973,
};

describe('titleKey', () => {
  it('upper cases and strips punctuation', () => {
    expect(titleKey('Jolene')).toBe('JOLENE');
    expect(titleKey("Don't Come Home A-Drinkin'")).toBe('DONT COME HOME ADRINKIN');
  });

  it('drops a bracketed qualifier so a single edit matches the album cut', () => {
    expect(titleKey('Jolene (Single Edit)')).toBe('JOLENE');
    expect(titleKey('Jolene [Remastered 2015]')).toBe('JOLENE');
    expect(titleKey('Jolene (Live at the Ryman)')).toBe('JOLENE');
  });

  it('drops a trailing dash qualifier too', () => {
    expect(titleKey('Jolene - Single Version')).toBe('JOLENE');
    expect(titleKey('Jolene / Radio Edit')).toBe('JOLENE');
    expect(titleKey('Jolene - Remastered')).toBe('JOLENE');
  });

  it('keeps a dash that is part of the title', () => {
    expect(titleKey('Ring of Fire - Live')).toBe('RING OF FIRE');
    expect(titleKey('Sixteen Tons')).toBe('SIXTEEN TONS');
  });

  it('collapses space', () => {
    expect(titleKey('  Blue   Eyes  ')).toBe('BLUE EYES');
  });
});

describe('makeRecording', () => {
  it('builds from an isrc, a title, a label and a year', () => {
    const recording = expectOk(makeRecording(JOLENE, NOW));
    expect(recording.isrc).toBe('USRC17607839');
    expect(recording.label).toBe('RCA Victor');
    expect(recording.releaseYear).toBe(1973);
    expect(recording.titleKey).toBe('JOLENE');
  });

  it('pays the label when no payee is named', () => {
    expect(expectOk(makeRecording(JOLENE, NOW)).payee).toBe('RCA Victor');
  });

  it('takes a payee that is not the label', () => {
    const recording = expectOk(
      makeRecording({ ...JOLENE, payee: 'Sony Music Entertainment' }, NOW),
    );
    expect(recording.payee).toBe('Sony Music Entertainment');
    expect(recording.label).toBe('RCA Victor');
  });

  it('rejects a bad isrc', () => {
    expect(expectErr(makeRecording({ ...JOLENE, isrc: 'nope' }, NOW))[0]?.code).toBe('ROY-001');
  });

  it('rejects a missing label because nobody could be paid', () => {
    expect(expectErr(makeRecording({ ...JOLENE, label: '  ' }, NOW))[0]?.code).toBe('ROY-002');
  });

  it('rejects a title that normalises to nothing', () => {
    expect(expectErr(makeRecording({ ...JOLENE, title: '(Live)' }, NOW))[0]?.code).toBe('ROY-003');
  });

  it('rejects a release year in the future or before recording existed', () => {
    expect(expectErr(makeRecording({ ...JOLENE, releaseYear: NOW + 1 }, NOW))[0]?.code).toBe(
      'ROY-004',
    );
    expect(
      expectErr(makeRecording({ ...JOLENE, releaseYear: EARLIEST_RELEASE_YEAR - 1 }, NOW))[0]?.code,
    ).toBe('ROY-004');
  });

  it('accepts the current year and the earliest year', () => {
    expect(expectOk(makeRecording({ ...JOLENE, releaseYear: NOW }, NOW)).releaseYear).toBe(NOW);
    expect(
      expectOk(makeRecording({ ...JOLENE, releaseYear: EARLIEST_RELEASE_YEAR }, NOW)).releaseYear,
    ).toBe(EARLIEST_RELEASE_YEAR);
  });
});

describe('auditRecording', () => {
  it('passes a plain gold recording', () => {
    expect(auditRecording(expectOk(makeRecording(JOLENE, NOW)), NOW)).toEqual([]);
  });

  it('notes a payee that is not the label', () => {
    const recording = expectOk(makeRecording({ ...JOLENE, payee: 'Sony' }, NOW));
    const problems = auditRecording(recording, NOW);
    expect(problems[0]?.code).toBe('ROY-010');
    expect(problems[0]?.detail?.['payee']).toBe('Sony');
  });

  it('leaves an old isrc year alone on a gold cut', () => {
    expect(auditRecording(expectOk(makeRecording(JOLENE, NOW)), NOW)).toEqual([]);
  });

  it('flags a current whose isrc year is far from its release year', () => {
    const current = expectOk(
      makeRecording({ ...JOLENE, isrc: 'USRC19907839', releaseYear: NOW }, NOW),
    );
    const problems = auditRecording(current, NOW);
    expect(problems[0]?.code).toBe('ROY-011');
    expect(problems[0]?.detail?.['isrcYear']).toBe(1999);
  });

  it('accepts a current whose isrc year is close enough', () => {
    const current = expectOk(
      makeRecording({ ...JOLENE, isrc: 'USRC12407839', releaseYear: NOW }, NOW),
    );
    expect(auditRecording(current, NOW)).toEqual([]);
  });
});

describe('telling recordings apart', () => {
  const original = expectOk(makeRecording(JOLENE, NOW));
  const edit = expectOk(
    makeRecording({ ...JOLENE, isrc: 'USRC17607840', title: 'Jolene (Single Edit)' }, NOW),
  );
  const cover = expectOk(
    makeRecording({ isrc: 'GBAYE0601498', title: 'Jolene', label: 'XL', releaseYear: 2006 }, NOW),
  );
  const other = expectOk(
    makeRecording(
      { isrc: 'USRC17600001', title: 'Ring of Fire', label: 'Columbia', releaseYear: 1963 },
      NOW,
    ),
  );

  it('matches a recording only against itself', () => {
    expect(isSameRecording(original, original)).toBe(true);
    expect(isSameRecording(original, edit)).toBe(false);
    expect(isSameRecording(original, cover)).toBe(false);
  });

  it('calls a different master of the same title a cover', () => {
    expect(isCover(original, cover)).toBe(true);
    expect(isCover(original, edit)).toBe(true);
    expect(isCover(original, other)).toBe(false);
    expect(isCover(original, original)).toBe(false);
  });

  it('lets the two rules disagree, which is the point of having both', () => {
    expect(isSameRecording(original, cover)).toBe(false);
    expect(original.titleKey).toBe(cover.titleKey);
  });

  it('orders by title then by isrc', () => {
    const sorted = [other, cover, original].sort(compareRecordings);
    expect(sorted.map((r) => r.isrc)).toEqual(['GBAYE0601498', 'USRC17607839', 'USRC17600001']);
  });

  it('describes a recording for a report line', () => {
    expect(describeRecording(original)).toBe('US-RC1-76-07839 JOLENE (RCA Victor, 1973)');
  });
});
