import { TestBed } from '@angular/core/testing';
import { NEVER, of } from 'rxjs';
import { NotificationsClient } from '../../api/generated/api-client';
import { QuietRequests } from '../../core/http/interceptors';
import { NotificationStore } from '../../features/notifications/notification-store';
import { settle } from '../testing/org-testing';
import { NotificationBell, badgeText, bellName } from './notification-bell';

describe('notification bell', () => {
  it('names the bell with the exact count up to 99 and "more than 99" above', () => {
    expect(bellName(0)).toBe('Notifications, 0 unread');
    expect(bellName(1)).toBe('Notifications, 1 unread');
    expect(bellName(99)).toBe('Notifications, 99 unread');
    expect(bellName(100)).toBe('Notifications, more than 99 unread');
  });

  it('shows the badge as 1 to 99, then 99+', () => {
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });

  describe('in the page', () => {
    let poll: ReturnType<typeof vi.fn>;

    async function create(unread: number) {
      poll = vi.fn().mockReturnValue(of({ unreadCount: unread, latestId: 4, items: [] }));
      TestBed.configureTestingModule({
        providers: [
          {
            provide: NotificationsClient,
            useValue: {
              pollNotifications: poll,
              listNotifications: vi.fn().mockReturnValue(NEVER),
            },
          },
          QuietRequests,
        ],
      });
      const fixture = TestBed.createComponent(NotificationBell);
      await settle(fixture);
      return fixture;
    }

    afterEach(() => {
      TestBed.inject(NotificationStore).stop();
    });

    it('is a button with an aria-live polite status beside it from the first render', async () => {
      const fixture = await create(0);
      const el = fixture.nativeElement as HTMLElement;
      const button = el.querySelector<HTMLButtonElement>('[data-testid=notification-bell]')!;
      expect(button.getAttribute('aria-label')).toBe('Notifications, 0 unread');
      expect(button.getAttribute('aria-haspopup')).toBe('dialog');
      expect(el.querySelector('[data-notification-badge]')).toBeNull();
      const live = el.querySelector('[role=status]')!;
      expect(live.getAttribute('aria-live')).toBe('polite');
    });

    it('loads the store and shows the count once the first poll answered (aria-hidden badge)', async () => {
      const fixture = await create(120);
      const el = fixture.nativeElement as HTMLElement;
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('[data-notification-badge]')?.textContent?.trim()).toBe('99+');
      });
      expect(el.querySelector('[data-notification-badge]')!.getAttribute('aria-hidden')).toBe(
        'true',
      );
      expect(el.querySelector('button')!.getAttribute('aria-label')).toBe(
        'Notifications, more than 99 unread',
      );
      expect(poll).toHaveBeenCalledWith(0, true);
    });
  });
});
