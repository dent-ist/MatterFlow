import { queueParams } from './dashboard-links';

describe('queueParams', () => {
  it('turns repeated keys into arrays and single keys into strings', () => {
    expect(queueParams('status=NEW&status=IN_PROGRESS&unassigned=true')).toEqual({
      status: ['NEW', 'IN_PROGRESS'],
      unassigned: 'true',
    });
  });

  it('keeps three or more repeats in order and decodes values', () => {
    expect(queueParams('status=NEW&status=IN_PROGRESS&status=ON_HOLD&dueTo=2026-10-16')).toEqual({
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
      dueTo: '2026-10-16',
    });
    expect(queueParams('q=a%20b')).toEqual({ q: 'a b' });
  });

  it('returns no parameters for an empty query', () => {
    expect(queueParams('')).toEqual({});
    expect(queueParams(undefined)).toEqual({});
  });
});
