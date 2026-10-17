import { YESTERDAY, previousBasis, tileDelta, yesterdayHint } from './dashboard-deltas';

describe('tile deltas (S3)', () => {
  it('reads "+8 vs yesterday" with the glyph and attention for Overdue going up', () => {
    const d = tileDelta(152, 144, YESTERDAY, true);
    expect(d).toEqual({
      direction: 'up',
      glyph: '▲',
      text: '+8 vs yesterday',
      spoken: '8 more than yesterday',
      attention: true,
    });
  });

  it('is neutral for a fall, and for a rise of any tile other than Overdue', () => {
    expect(tileDelta(141, 144, YESTERDAY, true)).toMatchObject({
      direction: 'down',
      glyph: '▼',
      text: '-3 vs yesterday',
      spoken: '3 fewer than yesterday',
      attention: false,
    });
    expect(tileDelta(112, 100, YESTERDAY)?.attention).toBe(false);
  });

  it('says "no change" for a zero delta, never "+0"', () => {
    const d = tileDelta(7, 7, YESTERDAY, true);
    expect(d).toMatchObject({ direction: 'same', glyph: '=', text: 'no change vs yesterday' });
    expect(d?.attention).toBe(false);
    expect(d?.text).not.toContain('+0');
    expect(d?.spoken).toBe('No change compared with yesterday');
  });

  it('shows nothing without a baseline or a basis (null, undefined, NaN)', () => {
    expect(tileDelta(5, null, YESTERDAY)).toBeNull();
    expect(tileDelta(5, undefined, YESTERDAY)).toBeNull();
    expect(tileDelta(5, 3, null)).toBeNull();
    expect(tileDelta(5, Number.NaN, YESTERDAY)).toBeNull();
    expect(tileDelta(Number.NaN, 3, YESTERDAY)).toBeNull();
  });

  it('names the previous period by its length, or as the same days of last month', () => {
    const prev = { kind: 'previous', from: '2026-08-16', to: '2026-09-14' };
    const basis = previousBasis(prev, 30);
    expect(basis).toEqual({
      short: 'previous 30 days',
      spoken: 'in the previous 30 days',
      against: 'the previous 30 days',
    });
    expect(tileDelta(73, 59, basis)).toMatchObject({
      text: '+14 vs previous 30 days',
      spoken: '14 more than in the previous 30 days',
    });
    expect(previousBasis({ kind: 'previous', from: 'a', to: 'b' }, 1)?.short).toBe('previous day');
    expect(
      previousBasis({ kind: 'same-days-last-month', from: '2026-09-01', to: '2026-09-14' }, 14),
    ).toEqual({
      short: 'same days last month',
      spoken: 'in the same days last month',
      against: 'the same days last month',
    });
    expect(previousBasis(undefined, 30)).toBeNull();
  });

  it('repeats the Trends caveat in the tooltip', () => {
    expect(yesterdayHint(144)).toContain('At the end of yesterday: 144');
    expect(yesterdayHint(144)).toContain('Trends tab');
    expect(yesterdayHint(null)).toBeNull();
  });
});
