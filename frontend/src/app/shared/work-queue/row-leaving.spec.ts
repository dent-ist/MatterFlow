import { RowLeaving } from './row-leaving';

describe('RowLeaving', () => {
  let removed: number[];
  let busy: boolean;
  let leaving: RowLeaving;

  beforeEach(() => {
    vi.useFakeTimers();
    removed = [];
    busy = false;
    leaving = new RowLeaving(
      (id) => removed.push(id),
      () => busy,
    );
  });
  afterEach(() => {
    leaving.clear();
    vi.useRealTimers();
  });

  it('keeps the row for 4 seconds, marked as leaving, then removes it', () => {
    leaving.start(7);
    expect(leaving.ids().has(7)).toBe(true);
    vi.advanceTimersByTime(3999);
    expect(removed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(removed).toEqual([7]);
    expect(leaving.ids().has(7)).toBe(false);
  });

  it('waits while the person is using the row and removes it once they are done', () => {
    busy = true;
    leaving.start(7);
    vi.advanceTimersByTime(10_000);
    expect(removed).toEqual([]);
    expect(leaving.ids().has(7)).toBe(true);
    busy = false;
    vi.advanceTimersByTime(300);
    expect(removed).toEqual([7]);
  });

  it('starts once per row and runs the start callback once', () => {
    const onStart = vi.fn();
    leaving.start(7, onStart);
    leaving.start(7, onStart);
    expect(onStart).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4000);
    expect(removed).toEqual([7]);
  });

  it('cancel keeps a row whose change was reverted', () => {
    leaving.start(7);
    leaving.cancel(7);
    vi.advanceTimersByTime(5000);
    expect(removed).toEqual([]);
    expect(leaving.ids().size).toBe(0);
  });

  it('clear forgets every pending row (the list was loaded again)', () => {
    leaving.start(7);
    leaving.start(8);
    leaving.clear();
    vi.advanceTimersByTime(5000);
    expect(removed).toEqual([]);
    expect(leaving.ids().size).toBe(0);
  });
});
