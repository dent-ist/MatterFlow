import { ACTIVITY_STEP_MS, VISIT_GAP_MS, touchVisit } from './last-visit';

const KEY = 'mf.my-work.visit.v2.7';
const stored = () => JSON.parse(localStorage.getItem(KEY)!);
const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 14, 9, 0);

describe('touchVisit', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('marks nothing on the first use and records it', () => {
    expect(touchVisit(7, T0)).toBeNull();
    expect(stored()).toEqual({ lastActiveAt: T0, visitSince: null });
  });

  it('keeps the same visit through activity with gaps of up to 30 minutes', () => {
    touchVisit(7, T0);
    expect(touchVisit(7, T0 + 20 * MIN)).toBeNull();
    expect(touchVisit(7, T0 + 50 * MIN)).toBeNull();
    expect(stored().visitSince).toBeNull();
    expect(stored().lastActiveAt).toBe(T0 + 50 * MIN);
  });

  it('starts a new visit after a gap of more than 30 minutes, at the last activity', () => {
    touchVisit(7, T0);
    expect(touchVisit(7, T0 + VISIT_GAP_MS + 1)).toBe(T0);
    // Fixed for the rest of the visit, reloads and other screens included.
    expect(touchVisit(7, T0 + VISIT_GAP_MS + 5 * MIN)).toBe(T0);
    expect(touchVisit(7, T0 + VISIT_GAP_MS + 20 * MIN)).toBe(T0);
    // The next visit begins when that one was last active.
    const last = T0 + VISIT_GAP_MS + 20 * MIN;
    expect(touchVisit(7, last + 31 * MIN)).toBe(last);
  });

  it('writes activity at most once a minute and a gap of exactly 30 minutes is the same visit', () => {
    touchVisit(7, T0);
    touchVisit(7, T0 + ACTIVITY_STEP_MS - 1);
    expect(stored().lastActiveAt).toBe(T0);
    touchVisit(7, T0 + ACTIVITY_STEP_MS);
    expect(stored().lastActiveAt).toBe(T0 + ACTIVITY_STEP_MS);
    expect(touchVisit(7, T0 + ACTIVITY_STEP_MS + VISIT_GAP_MS)).toBeNull();
  });

  it('is shared by every browser tab (one record per user) and separate per user', () => {
    touchVisit(7, T0);
    touchVisit(7, T0 + 31 * MIN);
    expect(touchVisit(7, T0 + 32 * MIN)).toBe(T0);
    expect(touchVisit(8, T0 + 32 * MIN)).toBeNull();
  });

  it('degrades to no New markers when storage is blocked or holds garbage', () => {
    localStorage.setItem(KEY, '{not json');
    expect(touchVisit(7, T0)).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(touchVisit(7, T0)).toBeNull();
  });
});
