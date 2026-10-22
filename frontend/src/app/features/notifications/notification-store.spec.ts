import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NotificationItem, NotificationsClient } from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { Connectivity } from '../../core/http/connectivity';
import { BACKOFF_MS, NotificationStore, POLL_JITTER_MS, POLL_MS } from './notification-store';

function item(id: number, overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id,
    eventType: 'TaskAssigned',
    objectKind: 'Task',
    objectId: 100 + id,
    matterId: 1,
    message: `Message ${id}`,
    createdUtc: '2026-10-22T10:00:00Z',
    readUtc: undefined,
    isRead: false,
    ...overrides,
  };
}

function failure(status: number): ApiError {
  return new ApiError(status, undefined, 'x', undefined, {} as never);
}

describe('NotificationStore', () => {
  let hidden = false;
  let poll: ReturnType<typeof vi.fn>;
  let client: Record<string, ReturnType<typeof vi.fn>>;

  function setup() {
    poll = vi.fn().mockReturnValue(of({ unreadCount: 2, latestId: 5, items: [] }));
    client = {
      pollNotifications: poll,
      listNotifications: vi
        .fn()
        .mockReturnValue(of({ items: [], totalCount: 0, page: 1, pageSize: 10 })),
      markNotificationRead: vi.fn().mockReturnValue(of(undefined)),
      markAllNotificationsRead: vi.fn().mockReturnValue(of({ marked: 2 })),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: NotificationsClient, useValue: client }],
    });
    return TestBed.inject(NotificationStore);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    TestBed.inject(NotificationStore).stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (document as unknown as { hidden?: boolean }).hidden;
  });

  it('first poll uses initial=true, announces nothing and sets the count', async () => {
    const store = setup();
    poll.mockReturnValue(of({ unreadCount: 3, latestId: 9, items: [item(9)] }));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledWith(0, true);
    expect(store.unreadCount()).toBe(3);
    expect(store.announcement()).toBe('');
  });

  it('polls again after 30 s plus jitter with the sinceId cursor, and announces new items once per poll', async () => {
    const store = setup();
    poll.mockReturnValueOnce(of({ unreadCount: 1, latestId: 5, items: [] }));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    poll.mockReturnValueOnce(of({ unreadCount: 3, latestId: 8, items: [item(8), item(7)] }));
    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenLastCalledWith(5, undefined);
    expect(store.unreadCount()).toBe(3);
    expect(store.announcement()).toBe('2 new notifications. Latest: Message 8');
    poll.mockReturnValueOnce(of({ unreadCount: 3, latestId: 8, items: [] }));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(poll).toHaveBeenLastCalledWith(8, undefined);
  });

  it('adds up to 5 s of jitter', async () => {
    const store = setup();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS + POLL_JITTER_MS - 6);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('does not announce items that are already read', async () => {
    const store = setup();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    poll.mockReturnValueOnce(
      of({ unreadCount: 0, latestId: 6, items: [item(6, { isRead: true, readUtc: 'x' })] }),
    );
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(store.announcement()).toBe('');
  });

  it('pauses while the tab is hidden and polls once when it is visible again', async () => {
    const store = setup();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    hidden = true;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(poll).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('is suspended while offline and polls once on Back online', async () => {
    const store = setup();
    const connectivity = TestBed.inject(Connectivity);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    connectivity.unreachable();
    connectivity.unreachable();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(poll).toHaveBeenCalledTimes(1);
    connectivity.reachable();
    window.dispatchEvent(new Event('online'));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('backs off 60 s, then 120 s, and returns to 30 s after a good poll', async () => {
    const store = setup();
    poll.mockReturnValue(throwError(() => failure(500)));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] - 1);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1] - 1);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(3);
    poll.mockReturnValue(of({ unreadCount: 0, latestId: 5, items: [] }));
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1]);
    expect(poll).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(poll).toHaveBeenCalledTimes(5);
  });

  it('stops for good on 401', async () => {
    const store = setup();
    poll.mockReturnValue(throwError(() => failure(401)));
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1] * 3);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('treats a 304 as nothing new and keeps the normal rhythm', async () => {
    const store = setup();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    poll.mockReturnValue(throwError(() => failure(304)));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(store.unreadCount()).toBe(2);
  });

  it('marking read lowers the count at once, survives the next poll and does not announce', async () => {
    const store = setup();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    client['listNotifications'].mockReturnValue(
      of({ items: [item(5), item(4)], totalCount: 2, page: 1, pageSize: 10 }),
    );
    await store.loadRecent();
    poll.mockReturnValue(of({ unreadCount: 1, latestId: 5, items: [] }));
    await store.markRead(store.recent()[0]);
    expect(store.unreadCount()).toBe(1);
    expect(store.recent()[0].isRead).toBe(true);
    expect(client['markNotificationRead']).toHaveBeenCalledWith(5);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.unreadCount()).toBe(1);
    expect(store.announcement()).toBe('');
  });

  it('mark all read zeroes the badge and reads the count again', async () => {
    const store = setup();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    poll.mockReturnValue(of({ unreadCount: 0, latestId: 5, items: [] }));
    await store.markAllRead();
    expect(store.unreadCount()).toBe(0);
    expect(client['markAllNotificationsRead']).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('shows a failed panel load as an error state, never throws', async () => {
    const store = setup();
    client['listNotifications'].mockReturnValue(throwError(() => failure(500)));
    await store.loadRecent();
    expect(store.recentState()).toBe('error');
  });
});
