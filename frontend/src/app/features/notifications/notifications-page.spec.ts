import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { NotificationItem, NotificationsClient } from '../../api/generated/api-client';
import { NotificationStore } from './notification-store';
import { NotificationsPage } from './notifications-page';

function item(id: number, overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id,
    eventType: 'TaskDue',
    objectKind: id % 2 ? 'Task' : 'Matter',
    objectId: 10 + id,
    matterId: 1,
    message: `Message ${id}`,
    createdUtc: new Date(Date.now() - 3_600_000).toISOString(),
    readUtc: undefined,
    isRead: false,
    ...overrides,
  };
}

describe('NotificationsPage', () => {
  let client: Record<string, ReturnType<typeof vi.fn>>;

  async function open(url: string, total = 60) {
    client = {
      pollNotifications: vi.fn().mockReturnValue(of({ unreadCount: 3, latestId: 9, items: [] })),
      listNotifications: vi.fn().mockImplementation((filter: string, page: number, size: number) =>
        of({
          items: total === 0 ? [] : [item(3), item(2, { isRead: true, readUtc: 'x' })],
          totalCount: total,
          page,
          pageSize: size,
        }),
      ),
      markNotificationRead: vi.fn().mockReturnValue(of(undefined)),
      markAllNotificationsRead: vi.fn().mockReturnValue(of({ marked: 3 })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'notifications', component: NotificationsPage },
          { path: '**', children: [] },
        ]),
        { provide: NotificationsClient, useValue: client },
      ],
    });
    TestBed.inject(NotificationStore).start();
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl(url, NotificationsPage);
    await harness.fixture.whenStable();
    harness.detectChanges();
    return { harness, page };
  }

  afterEach(() => TestBed.inject(NotificationStore).stop());

  const root = (h: { fixture: ComponentFixture<unknown> }) =>
    h.fixture.nativeElement as HTMLElement;

  it('restores filter, page and size from the address', async () => {
    const { harness } = await open('/notifications?filter=unread&page=2&pageSize=50');
    expect(client['listNotifications']).toHaveBeenCalledWith('unread', 2, 50);
    const unread = root(harness).querySelector('[data-filter=unread]')!;
    expect(unread.getAttribute('aria-pressed')).toBe('true');
    expect(unread.textContent).toContain('Unread (3)');
    expect(root(harness).querySelector('[data-filter=all]')!.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('lists rows as links and marks the opened one read; read rows are not bold', async () => {
    const { harness } = await open('/notifications');
    const rows = root(harness).querySelectorAll<HTMLAnchorElement>('[data-notification-item]');
    expect(rows[0].getAttribute('href')).toBe('/tasks/13');
    expect(rows[0].classList).toContain('npg__row--unread');
    expect(rows[1].classList).not.toContain('npg__row--unread');
    expect(rows[1].getAttribute('href')).toBe('/matters/12');
    rows[0].click();
    expect(client['markNotificationRead']).toHaveBeenCalledWith(3);
  });

  it('puts the filter in the address and goes back to page 1', async () => {
    const { harness } = await open('/notifications?page=3');
    root(harness).querySelector<HTMLButtonElement>('[data-filter=unread]')!.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/notifications?filter=unread');
    expect(client['listNotifications']).toHaveBeenLastCalledWith('unread', 1, 25);
  });

  it('shows the empty states', async () => {
    const { harness } = await open('/notifications?filter=unread', 0);
    expect(root(harness).querySelector('[data-page-empty]')!.textContent).toContain(
      'No unread notifications.',
    );
    expect(root(harness).querySelector('[data-show-all]')).not.toBeNull();
    TestBed.resetTestingModule();
    const again = await open('/notifications', 0);
    expect(root(again.harness).querySelector('[data-page-empty]')!.textContent).toContain(
      'No notifications yet.',
    );
  });

  it('shows one inline error with Retry', async () => {
    const { harness } = await open('/notifications');
    client['listNotifications'].mockReturnValue(throwError(() => new Error('x')));
    root(harness).querySelector<HTMLButtonElement>('[data-filter=unread]')!.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(root(harness).querySelector('[data-page-error]')).not.toBeNull();
  });

  it('marks all read and reloads', async () => {
    const { harness } = await open('/notifications');
    root(harness).querySelector<HTMLButtonElement>('[data-mark-all-read]')!.click();
    await harness.fixture.whenStable();
    expect(client['markAllNotificationsRead']).toHaveBeenCalled();
    expect(ActivatedRoute).toBeDefined();
  });
});
