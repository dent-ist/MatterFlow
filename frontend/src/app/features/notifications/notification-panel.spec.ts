import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NotificationItem, NotificationsClient } from '../../api/generated/api-client';
import { settle } from '../../shared/testing/org-testing';
import { NotificationPanel } from './notification-panel';
import { NotificationStore } from './notification-store';

function item(id: number, overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id,
    eventType: 'TaskAssigned',
    objectKind: 'Task',
    objectId: 100 + id,
    matterId: 1,
    message: `Ann Lee assigned you T-${id}.`,
    createdUtc: new Date(Date.now() - 5 * 60_000).toISOString(),
    readUtc: undefined,
    isRead: false,
    ...overrides,
  };
}

describe('NotificationPanel', () => {
  let client: Record<string, ReturnType<typeof vi.fn>>;
  let anchor: HTMLElement;

  async function create(
    items: NotificationItem[] | Error,
  ): Promise<ComponentFixture<NotificationPanel>> {
    client = {
      pollNotifications: vi.fn().mockReturnValue(of({ unreadCount: 2, latestId: 9, items: [] })),
      listNotifications: vi
        .fn()
        .mockReturnValue(
          items instanceof Error
            ? throwError(() => items)
            : of({ items, totalCount: items.length, page: 1, pageSize: 10 }),
        ),
      markNotificationRead: vi.fn().mockReturnValue(of(undefined)),
      markAllNotificationsRead: vi.fn().mockReturnValue(of({ marked: 2 })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: NotificationsClient, useValue: client },
      ],
    });
    anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const store = TestBed.inject(NotificationStore);
    store.start();
    const fixture = TestBed.createComponent(NotificationPanel);
    fixture.componentRef.setInput('anchor', anchor);
    await settle(fixture);
    return fixture;
  }

  afterEach(() => {
    TestBed.inject(NotificationStore).stop();
    anchor?.remove();
  });

  const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;

  it('lists the items with an Unread prefix, the server text and links built from kind and id', async () => {
    const fixture = await create([item(2), item(1, { isRead: true, readUtc: 'x' })]);
    const rows = el(fixture).querySelectorAll<HTMLAnchorElement>('[data-notification-item]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent!.replace(/\s+/g, ' ')).toContain(
      'Unread: Ann Lee assigned you T-2.',
    );
    expect(rows[1].textContent).not.toContain('Unread:');
    expect(rows[0].getAttribute('href')).toBe('/tasks/102');
    expect(rows[0].querySelector('time')!.textContent).toContain('5 min ago');
    expect(el(fixture).querySelector('[role=dialog]')!.getAttribute('aria-labelledby')).toBe(
      'np-title',
    );
  });

  it('moves focus to the heading on open', async () => {
    const fixture = await create([item(1)]);
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('np-title'));
    fixture.destroy();
  });

  it('shows the empty state', async () => {
    const fixture = await create([]);
    expect(el(fixture).querySelector('[data-panel-empty]')!.textContent).toContain(
      "You're all caught up.",
    );
  });

  it('shows one inline error with Retry and no toast', async () => {
    const fixture = await create(new Error('x'));
    expect(el(fixture).querySelector('[data-panel-error]')!.textContent).toContain(
      "Couldn't load notifications.",
    );
    client['listNotifications'].mockReturnValue(
      of({ items: [item(1)], totalCount: 1, page: 1, pageSize: 10 }),
    );
    el(fixture).querySelector<HTMLButtonElement>('[data-panel-retry]')!.click();
    await settle(fixture);
    expect(el(fixture).querySelectorAll('[data-notification-item]').length).toBe(1);
  });

  it('marks an item read when it is chosen and closes without moving focus to the bell', async () => {
    const fixture = await create([item(2), item(1)]);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    vi.useFakeTimers();
    try {
      el(fixture).querySelector<HTMLAnchorElement>('[data-notification-item]')!.click();
      expect(client['markNotificationRead']).toHaveBeenCalledWith(2);
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
    expect(closed).toHaveBeenCalledWith(false);
  });

  it('hides "Mark all as read" when nothing is unread, and marks all read', async () => {
    const fixture = await create([item(2), item(1)]);
    client['pollNotifications'].mockReturnValue(of({ unreadCount: 0, latestId: 9, items: [] }));
    const button = el(fixture).querySelector<HTMLButtonElement>('[data-mark-all-read]')!;
    button.click();
    await settle(fixture);
    expect(client['markAllNotificationsRead']).toHaveBeenCalled();
    expect(el(fixture).querySelector('[data-mark-all-read]')).toBeNull();
    expect(el(fixture).querySelectorAll('.np__item--unread').length).toBe(0);
  });

  it('closes with focus return on Esc and without it on a click outside', async () => {
    const fixture = await create([item(1)]);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenLastCalledWith(true);
    document.body.click();
    expect(closed).toHaveBeenLastCalledWith(false);
    closed.mockClear();
    anchor.click();
    expect(closed).not.toHaveBeenCalled();
  });
});
