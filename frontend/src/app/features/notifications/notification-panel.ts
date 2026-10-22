import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { retryWhenBackOnline } from '../../core/http/connectivity';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { NotificationStore } from './notification-store';
import { absoluteTime, notificationLink, relativeTime } from './notification-text';

/** Below this width (px) the panel is a full-width sheet under the header (README 4.3). */
const PHONE_MAX = 639;
const PANEL_WIDTH = 380;
const GAP = 4;

/**
 * The notification panel (NT-D2, #746): a non-modal dialog under the bell with the ten newest items, "Mark all as read" and "View all
 * notifications". From 640 px a 380 px popover anchored to the bell, below that a full-width sheet under the header with a Close button.
 * Opening moves focus to the heading; Esc and Close give it back to the bell (the bell does that when this component says `closed`).
 * The message is the server's text, unchanged. Errors show inline with Retry, never as a toast.
 */
@Component({
  selector: 'mf-notification-panel',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close(true)',
    '(window:resize)': 'place()',
    '[class.np-sheet]': 'sheet()',
    '[style.top.px]': 'top()',
    '[style.right.px]': 'sheet() ? 0 : right()',
  },
  template: `
    <section class="np" role="dialog" aria-labelledby="np-title" data-notification-panel>
      <div class="np__head">
        <h2 id="np-title" #title class="np__title" tabindex="-1">Notifications</h2>
        @if (sheet()) {
          <button type="button" class="mf-btn np__close" data-panel-close (click)="close(true)">
            <i class="pi pi-times" aria-hidden="true"></i> Close
          </button>
        }
        @if (store.unreadCount() > 0) {
          <button
            type="button"
            class="mf-btn mf-btn--text np__all"
            data-mark-all-read
            (click)="markAll()"
          >
            Mark all as read
          </button>
        }
      </div>
      <div class="np__body" [attr.aria-busy]="store.recentState() === 'loading' ? 'true' : null">
        @switch (store.recentState()) {
          @case ('error') {
            <p class="np__note" data-panel-error>
              Couldn't load notifications.
              <button type="button" class="mf-btn mf-btn--text" data-panel-retry (click)="load()">
                Retry
              </button>
            </p>
          }
          @case ('ready') {
            @if (store.recent().length === 0) {
              <p class="np__empty" data-panel-empty>
                <strong>You're all caught up.</strong>
                <span class="np__muted">New notifications appear here.</span>
              </p>
            } @else {
              <ul class="np__list" data-panel-list>
                @for (item of store.recent(); track item.id) {
                  <li>
                    <a
                      class="np__item"
                      data-notification-item
                      [class.np__item--unread]="!item.isRead"
                      [routerLink]="link(item)"
                      [title]="item.message"
                      (click)="choose(item)"
                    >
                      <span class="np__dot" aria-hidden="true"></span>
                      <span class="np__text">
                        <span class="np__message">
                          @if (!item.isRead) {
                            <span class="mf-sr-only">Unread: </span>
                          }
                          {{ item.message }}</span
                        >
                        <time
                          class="np__time"
                          [attr.datetime]="item.createdUtc"
                          [title]="absolute(item.createdUtc)"
                          >{{ relative(item.createdUtc) }}</time
                        >
                      </span>
                    </a>
                  </li>
                }
              </ul>
            }
          }
          @default {
            <p class="np__note np__muted" data-panel-loading>Loading notifications...</p>
          }
        }
      </div>
      <div class="np__foot">
        <a class="np__viewall" data-view-all routerLink="/notifications" (click)="later()"
          >View all notifications</a
        >
      </div>
    </section>
  `,
  styles: `
    :host {
      position: fixed;
      z-index: 60;
      display: block;
      width: min(${PANEL_WIDTH}px, calc(100vw - 16px));
    }
    :host(.np-sheet) {
      left: 0;
      bottom: 0;
      width: auto;
    }
    .np {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      max-height: min(32rem, calc(100vh - 6rem));
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      box-shadow: var(--mf-shadow-2);
    }
    :host(.np-sheet) .np {
      height: 100%;
      max-height: none;
      border-width: 1px 0 0;
      border-radius: 0;
    }
    .np__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
    }
    .np__title {
      flex: 1 1 auto;
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .np__title:focus-visible {
      outline-offset: 2px;
    }
    .np__body {
      flex: 1 1 auto;
      min-height: 8rem;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .np__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .np__list li + li {
      border-top: 1px solid var(--mf-border);
    }
    .np__item {
      display: flex;
      gap: var(--mf-s2);
      align-items: flex-start;
      box-sizing: border-box;
      min-height: 44px;
      padding: var(--mf-s2) var(--mf-s3);
      color: var(--mf-text);
      text-decoration: none;
    }
    .np__item:hover {
      background: var(--mf-surface-alt);
    }
    .np__item--unread .np__message {
      font-weight: 700;
    }
    .np__dot {
      flex: none;
      width: 8px;
      height: 8px;
      margin-top: 0.4rem;
      border-radius: 50%;
    }
    .np__item--unread .np__dot {
      background: var(--mf-primary);
    }
    .np__text {
      display: flex;
      min-width: 0;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 2px;
    }
    .np__message {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .np__time {
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
    }
    .np__note,
    .np__empty {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--mf-s1);
      margin: 0;
      padding: var(--mf-s4) var(--mf-s3);
    }
    .np__muted {
      color: var(--mf-text-muted);
    }
    .np__foot {
      border-top: 1px solid var(--mf-border);
    }
    .np__viewall {
      display: flex;
      align-items: center;
      min-height: 44px;
      padding: 0 var(--mf-s3);
      color: var(--mf-link);
    }
  `,
})
export class NotificationPanel {
  protected readonly store = inject(NotificationStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');

  /** The bell's element: positions the popover and keeps a click on the bell from counting as "outside". */
  readonly anchor = input<HTMLElement | null>(null);
  /** `true` when focus should go back to the bell (Esc, Close), `false` after following a link. */
  readonly closed = output<boolean>();

  protected readonly sheet = signal(false);
  protected readonly top = signal(0);
  protected readonly right = signal(0);

  constructor() {
    effect(() => {
      this.anchor();
      untracked(() => this.place());
    });
    void this.store.loadRecent();
    afterNextRender(() => this.title()?.nativeElement.focus());
    retryWhenBackOnline(
      () => this.store.recentState() === 'error',
      () => this.load(),
    );
  }

  /** Popover under the bell, right edges aligned; a sheet under the header on phones. */
  protected place(): void {
    const anchor = this.anchor();
    const phone = typeof window !== 'undefined' && window.innerWidth <= PHONE_MAX;
    this.sheet.set(phone);
    const rect = anchor?.getBoundingClientRect();
    if (phone) {
      const header = anchor?.closest('header')?.getBoundingClientRect();
      this.top.set(Math.round(header?.bottom ?? rect?.bottom ?? 0));
    } else {
      this.top.set(Math.round((rect?.bottom ?? 0) + GAP));
      this.right.set(
        Math.max(8, Math.round(window.innerWidth - (rect?.right ?? window.innerWidth))),
      );
    }
  }

  protected load(): void {
    void this.store.loadRecent();
  }

  protected link(item: { objectKind: string; objectId: number }): unknown[] {
    return notificationLink(item);
  }

  protected relative(createdUtc: string): string {
    return relativeTime(createdUtc, this.clock.now(), this.zone);
  }

  protected absolute(createdUtc: string): string {
    return absoluteTime(createdUtc, this.zone);
  }

  protected choose(item: { id: number; isRead: boolean }): void {
    void this.store.markRead(item);
    // After the link's own click handler has run (closing at once would destroy it first).
    setTimeout(() => this.close(false));
  }

  protected later(): void {
    setTimeout(() => this.close(false));
  }

  protected markAll(): void {
    void this.store.markAllRead();
    // The button disappears once nothing is unread: keep focus inside the panel.
    this.title()?.nativeElement.focus();
  }

  protected close(restoreFocus: boolean): void {
    this.closed.emit(restoreFocus);
  }

  protected onDocumentClick(event: Event): void {
    const target = event.target as Node | null;
    if (!target) return;
    if (this.host.nativeElement.contains(target) || this.anchor()?.contains(target)) return;
    this.close(false);
  }
}
