import { STALE_AFTER_MS, staleAgeText } from './dash-stale';

describe('staleAgeText (P6)', () => {
  const t0 = 1_000_000_000;
  it('shows nothing in a fresh session or before the first read', () => {
    expect(staleAgeText(null, t0)).toBeNull();
    expect(staleAgeText(t0, t0)).toBeNull();
  });
  it('shows nothing at 9 minutes and the age at 10', () => {
    expect(staleAgeText(t0, t0 + 9 * 60_000)).toBeNull();
    expect(staleAgeText(t0, t0 + STALE_AFTER_MS)).toBe('Updated 10 min ago');
    expect(staleAgeText(t0, t0 + 14 * 60_000 + 59_000)).toBe('Updated 14 min ago');
  });
});
