import { describe, expect, it } from 'vitest';
import {
  batesRange,
  directionLabel,
  formatCount,
  historyText,
  parseCount,
  partyLabel,
} from './production-ui';

describe('production-ui', () => {
  it('names the direction and the party', () => {
    expect(directionLabel('OUT')).toBe('Produced by Us');
    expect(directionLabel('IN')).toBe('Received');
    expect(partyLabel('OUT')).toBe('Produced to');
    expect(partyLabel('IN')).toBe('Produced by');
  });

  it('writes the Bates range from what is known', () => {
    expect(batesRange('ABC000001', 'ABC000250')).toBe('ABC000001 to ABC000250');
    expect(batesRange('ABC000001', 'ABC000001')).toBe('ABC000001');
    expect(batesRange('ABC000001', '')).toBe('ABC000001');
    expect(batesRange(null, 'ABC000250')).toBe('ABC000250');
    expect(batesRange(null, undefined)).toBe('');
  });

  it('reads a count: empty is none, text is not a number', () => {
    expect(parseCount('')).toBeNull();
    expect(parseCount(' 12 ')).toBe(12);
    expect(parseCount('0')).toBe(0);
    expect(Number.isNaN(parseCount('-3'))).toBe(true);
    expect(Number.isNaN(parseCount('1.5'))).toBe(true);
    expect(Number.isNaN(parseCount('12a'))).toBe(true);
    expect(formatCount(48210)).toBe('48,210');
    expect(formatCount(null)).toBe('');
  });

  it('puts history lines in words', () => {
    expect(
      historyText({
        eventType: 'FIELD_CHANGED',
        fieldKey: 'BatesEnd',
        oldValue: 'A1',
        newValue: 'A9',
      }),
    ).toBe('changed Bates end from A1 to A9');
    expect(
      historyText({ eventType: 'FIELD_CHANGED', fieldKey: 'Notes', oldValue: null, newValue: 'x' }),
    ).toBe('changed the notes from empty to x');
    expect(historyText({ eventType: 'PRODUCTION_CREATED' })).toBe('created the production');
    expect(historyText({ eventType: 'PRODUCTION_COMMENT_ADDED', summary: 'Hi' })).toBe(
      'added a comment: Hi',
    );
    expect(historyText({ eventType: 'SOMETHING_ELSE' })).toBe('something else');
  });
});
