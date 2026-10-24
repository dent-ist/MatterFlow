import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NotificationItem, NotificationsClient } from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { Connectivity } from '../../core/http/connectivity';
import { SessionReset } from '../../core/session/session-reset';
import { QuietRequests } from '../../core/http/interceptors';
import { announcementText } from './notification-text';

/** The client asks every 30 seconds (owner decision) plus a random 0 to 5 seconds so 50 people do not poll in step. */
export const POLL_MS = 30_000;
export const POLL_JITTER_MS = 5_000;
/** After a failed poll: 60 s, then 120 s for every further failure. Never a toast. */
export const BACKOFF_MS = [60_000, 120_000] as const;
/** The panel lists this many newest items. */
export const PANEL_SIZE = 10;

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The bell's state and its poll loop (NT-D1, #745). Lazy: the eager bell button loads this file with `import()` in idle time, so the
 * generated API client stays out of the initial bundle.
 *
 * Polling: `GET /me/notifications/poll`, the first call with `initial=true` (opening the app never announces old items), later ones with the
 * `sinceId` cursor. The browser answers an unchanged ETag with 304 on its own; a 304 that reaches the code counts as "nothing new". The loop
 * pauses while the tab is hidden (and polls once when it is visible again), is suspended while the shell says offline (and polls once on
 * "Back online."), backs off 60 s then 120 s after errors, and stops for good on 401 or 403.
 */
@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly client = inject(NotificationsClient);
  private readonly quiet = inject(QuietRequests);
  private readonly connectivity = inject(Connectivity);
  private readonly doc = inject(DOCUMENT);

  private readonly _unread = signal(0);
  private readonly _recent = signal<readonly NotificationItem[]>([]);
  private readonly _recentState = signal<LoadState>('idle');
  private readonly _announcement = signal('');

  /** Visible unread notifications (the server counts at most the newest 100). */
  readonly unreadCount = this._unread.asReadonly();
  /** The newest items for the panel (loaded when the panel opens, kept current by the poll). */
  readonly recent = this._recent.asReadonly();
  readonly recentState = this._recentState.asReadonly();
  /** What the live region says; set only for items a poll after the first one found. */
  readonly announcement = this._announcement.asReadonly();

  private running = false;
  private initialDone = false;
  private latestId = 0;
  private failures = 0;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private paused: 'hidden' | 'offline' | null = null;
  private readonly onVisibility = (): void => {
    if (this.running && !this.doc.hidden && this.paused === 'hidden') {
      this.paused = null;
      void this.pollNow();
    }
  };

  constructor() {
    inject(SessionReset).register(() => this.reset());
    effect(() => {
      const offline = this.connectivity.offline();
      untracked(() => {
        if (!this.running) return;
        if (offline) {
          this.clearTimer();
          this.paused = 'offline';
        } else if (this.paused === 'offline') {
          this.paused = null;
          void this.pollNow();
        }
      });
    });
  }

  /** Starts the loop (idempotent): the first poll runs at once. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    void this.pollNow();
  }

  /** Forgets everything shown for the earlier person (the session changed): the badge, the panel items, the cursor. A running loop starts over as a first poll. */
  reset(): void {
    const wasRunning = this.running;
    if (wasRunning) this.stop();
    this._unread.set(0);
    this._recent.set([]);
    this._recentState.set('idle');
    this._announcement.set('');
    this.latestId = 0;
    this.initialDone = false;
    this.failures = 0;
    if (wasRunning) this.start();
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.clearTimer();
    this.paused = null;
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Polls now (after a change of read state, on becoming visible or online) and schedules the next poll. */
  async pollNow(): Promise<void> {
    if (!this.running) return;
    this.clearTimer();
    if (this.doc.hidden) {
      this.paused = 'hidden';
      return;
    }
    if (this.connectivity.offline()) {
      this.paused = 'offline';
      return;
    }
    const mine = ++this.generation;
    const initial = !this.initialDone;
    try {
      const res = await this.quiet.run(() =>
        firstValueFrom(
          this.client.pollNotifications(initial ? 0 : this.latestId, initial ? true : undefined),
        ),
      );
      if (!this.running || mine !== this.generation) return;
      this.failures = 0;
      this.apply(res.unreadCount, res.latestId, res.items, initial);
      this.initialDone = true;
    } catch (error) {
      if (!this.running || mine !== this.generation) return;
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 401 || status === 403) {
        this.stop();
        return;
      }
      if (status === 304) this.failures = 0;
      else this.failures++;
    }
    this.schedule();
  }

  private apply(
    unread: number,
    latest: number,
    items: readonly NotificationItem[],
    initial: boolean,
  ): void {
    this._unread.set(unread);
    if (!initial) {
      const known = new Set(this._recent().map((i) => i.id));
      const fresh = items.filter((i) => i.id > this.latestId && !known.has(i.id));
      if (fresh.length > 0) {
        if (this._recentState() === 'ready') {
          this._recent.set([...fresh, ...this._recent()].slice(0, PANEL_SIZE));
        }
        const unreadFresh = fresh.filter((i) => !i.isRead);
        // At most one announcement per poll, and only for items that are still unread.
        if (unreadFresh.length > 0) this._announcement.set(announcementText(unreadFresh));
      }
    }
    this.latestId = Math.max(this.latestId, latest);
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.running) return;
    const delay =
      this.failures > 0
        ? BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length) - 1]
        : POLL_MS + Math.floor(Math.random() * POLL_JITTER_MS);
    this.timer = setTimeout(() => void this.pollNow(), delay);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Reads the newest items for the panel. A failure shows inline in the panel (no toast). */
  async loadRecent(): Promise<void> {
    if (this._recentState() !== 'ready') this._recentState.set('loading');
    try {
      const res = await this.quiet.run(() =>
        firstValueFrom(this.client.listNotifications('all', 1, PANEL_SIZE)),
      );
      this._recent.set(res.items);
      this._recentState.set('ready');
    } catch {
      if (this._recentState() !== 'ready') this._recentState.set('error');
    }
  }

  /** Marks one item read at once (badge and list), tells the server, then reads the count again. A failure is put right by the next poll. */
  async markRead(item: Pick<NotificationItem, 'id' | 'isRead'>): Promise<void> {
    if (item.isRead) return;
    if (this._recent().find((i) => i.id === item.id)?.isRead) return;
    this._unread.update((n) => Math.max(0, n - 1));
    this._recent.update((list) => list.map((i) => (i.id === item.id ? asRead(i) : i)));
    try {
      await this.quiet.run(() => firstValueFrom(this.client.markNotificationRead(item.id)));
    } catch {
      /* the item may be gone or not visible any more: the next poll and list show the truth */
    }
    void this.pollNow();
  }

  async markAllRead(): Promise<void> {
    this._unread.set(0);
    this._recent.update((list) => list.map(asRead));
    try {
      await this.quiet.run(() => firstValueFrom(this.client.markAllNotificationsRead()));
    } catch {
      /* corrected by the poll below */
    }
    void this.pollNow();
  }
}

function asRead(item: NotificationItem): NotificationItem {
  return item.isRead ? item : { ...item, isRead: true, readUtc: new Date().toISOString() };
}
