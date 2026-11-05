import {
  comparisonOf,
  durationText,
  monthLong,
  monthShort,
  onTimeText,
} from './users-history-model';

describe('users history model', () => {
  it('says durations in minutes under an hour and hours above', () => {
    expect(durationText(45)).toBe('45 m');
    expect(durationText(200)).toBe('3 h 20 m');
    expect(durationText(120)).toBe('2 h 00 m');
    expect(durationText(7200)).toBe('5 d 0 h');
    expect(durationText(undefined)).toBe('');
  });

  it('compares with the firm median in neutral words, an icon and the ratio', () => {
    expect(comparisonOf({ ratio: 1.34 })).toMatchObject({
      text: '1.3x firm median',
      word: 'Longer than the firm median',
      icon: 'pi-arrow-up-right',
      tone: 'longer',
    });
    expect(comparisonOf({ ratio: 1.34 }).short).toBe('1.3x longer');
    expect(comparisonOf({ ratio: 0.7 }).short).toBe('0.7x shorter');
    expect(comparisonOf({ ratio: 1 }).short).toBe('About the same');
    expect(comparisonOf({ ratio: 0.7 }).word).toBe('Shorter than the firm median');
    expect(comparisonOf({ ratio: 1 }).word).toBe('About the firm median');
    expect(comparisonOf({ ratio: undefined }).tone).toBe('none');
    for (const r of [0.5, 1, 2])
      expect(comparisonOf({ ratio: r }).word).not.toMatch(/slow|fast|best|worst/i);
  });

  it('names months and the on-time rate', () => {
    expect(monthShort('2026-11')).toBe('Nov');
    expect(monthLong('2026-11')).toBe('Nov 2026');
    expect(onTimeText({ onTime: 18, late: 2, sampleSize: 20, rate: 0.9 })).toBe(
      '18 of 20 tasks on time (90%)',
    );
    expect(onTimeText({ onTime: 1, late: 1, sampleSize: 2, rate: undefined })).toBe(
      'Not enough tasks yet',
    );
  });
});
