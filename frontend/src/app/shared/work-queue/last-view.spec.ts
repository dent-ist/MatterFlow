import { emptyState } from './queue-filters';
import { isBareState, loadLastView, saveLastView } from './last-view';

describe('last view memory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
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
});
