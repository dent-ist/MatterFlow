import { emptyState } from './queue-filters';
import { forgetLastView, isBareState, loadLastView, saveLastView } from './last-view';

describe('last view memory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('forgets the view of one screen and user, and leaves the other preferences', () => {
    const state = { ...emptyState(), view: 'dueSoon' };
    saveLastView('my-work', 7, state);
    saveLastView('queue', 7, { ...emptyState(), sort: 'due' });
    localStorage.setItem('mf.work-table.v3.my-work.7', '{"columns":[],"density":"compact"}');
    forgetLastView('my-work', 7);
    expect(loadLastView('my-work', 7)).toBeNull();
    expect(loadLastView('queue', 7)).not.toBeNull();
    expect(localStorage.getItem('mf.work-table.v3.my-work.7')).toContain('compact');
  });

  it('remembers filters, sort, page size and tab per user and screen, but not the search text or page', () => {
    const state = {
      ...emptyState(),
      filters: { ...emptyState().filters, q: 'secret', status: ['NEW'], overdue: true },
      sort: 'due',
      dir: 'desc' as const,
      pageSize: 25,
      page: 4,
      view: 'dueSoon',
    };
    saveLastView('my-work', 7, state);

    const back = loadLastView('my-work', 7)!;
    expect(back.filters.status).toEqual(['NEW']);
    expect(back.filters.overdue).toBe(true);
    expect(back.filters.q).toBe('');
    expect(back.sort).toBe('due');
    expect(back.dir).toBe('desc');
    expect(back.pageSize).toBe(25);
    expect(back.page).toBe(1);
    expect(back.view).toBe('dueSoon');
    expect(loadLastView('my-work', 8)).toBeNull();
    expect(loadLastView('queue', 7)).toBeNull();
  });

  it('treats the default view as nothing to restore', () => {
    saveLastView('queue', 1, emptyState());
    expect(loadLastView('queue', 1)).toBeNull();
    expect(isBareState(emptyState())).toBe(true);
  });

  it('survives blocked storage and damaged values', () => {
    localStorage.setItem('mf.work-view.v1.queue.1', '{not json');
    expect(loadLastView('queue', 1)).toBeNull();
    localStorage.setItem('mf.work-view.v1.queue.1', '[1,2]');
    expect(loadLastView('queue', 1)).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveLastView('queue', 1, emptyState())).not.toThrow();
  });

  describe('on a screen whose plain link starts on a default status', () => {
    const OPEN = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];
    const view = (status: string[], rest: Partial<ReturnType<typeof emptyState>> = {}) => ({
      ...emptyState(),
      ...rest,
      filters: { ...emptyState().filters, ...(rest.filters ?? {}), status },
    });

    it('does not call the default status a remembered view', () => {
      saveLastView('queue', 1, view(OPEN), { explicitStatus: true });
      expect(loadLastView('queue', 1, OPEN)).toBeNull();
    });

    it('remembers "every status" as a view of its own', () => {
      saveLastView('queue', 1, view([]), { explicitStatus: true });
      const back = loadLastView('queue', 1, OPEN)!;
      expect(back.filters.status).toEqual([]);
    });

    it('remembers a status, a filter beside the default status, and a sort', () => {
      saveLastView('queue', 1, view(['NEW']), { explicitStatus: true });
      expect(loadLastView('queue', 1, OPEN)!.filters.status).toEqual(['NEW']);

      saveLastView(
        'queue',
        1,
        view(OPEN, { filters: { ...emptyState().filters, overdue: true } }),
        {
          explicitStatus: true,
        },
      );
      const back = loadLastView('queue', 1, OPEN)!;
      expect(back.filters.status).toEqual(OPEN);
      expect(back.filters.overdue).toBe(true);

      saveLastView('queue', 1, view(OPEN, { sort: 'due', dir: 'asc' }), { explicitStatus: true });
      expect(loadLastView('queue', 1, OPEN)!.sort).toBe('due');
    });

    it('reads a view saved before the default existed (no status key) as the default status', () => {
      localStorage.setItem('mf.work-view.v1.queue.1', JSON.stringify({ priority: ['2'] }));
      const back = loadLastView('queue', 1, OPEN)!;
      expect(back.filters.status).toEqual(OPEN);
      expect(back.filters.priority).toEqual([2]);
    });
  });
});
