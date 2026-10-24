import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersActivityItem, MyMattersClient } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { formatInstant } from '../../../core/time/time';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { activityTime, statusWords } from '../facts';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { PanelBox } from './panel-box';

export const ACTIVITY_PAGE = 30;
/** How many events a phone shows before "Show all" (README 9). */
export const PHONE_EVENTS = 5;

/**
 * The sentence of one event, composed from its structured fields (README 6.6). A comment is only ever "commented on <task>": the text is
 * never read or shown (privilege).
 */
export function activityText(e: MyMattersActivityItem): string {
  const who = e.actorName ?? 'Someone';
  const task = e.taskTitle ? `"${e.taskTitle}"` : 'a task';
  switch (e.kind) {
    case 'TASK_CREATED':
      return `${who} created ${task}`;
    case 'STATUS_CHANGED':
      return `${who} moved ${task} to ${statusWords(e.to)}`;
    case 'REASSIGNED':
      return e.from
        ? `${task} reassigned from ${e.from} to ${e.to ?? 'nobody'}`
        : `${task} assigned to ${e.to ?? 'nobody'}`;
    case 'COMMENTED':
      return `${who} commented on ${task}`;
    case 'MANAGER_CHANGED': {
      const place = e.managerPlace === 'secondary' ? 'secondary' : 'primary';
      if (e.to) return `${e.to} became ${place} project manager`;
      return e.from
        ? `${e.from} is no longer ${place} project manager`
        : `The ${place} project manager was cleared`;
    }
    default:
      return `${who} changed ${task}`;
  }
}

/**
 * Recent activity (README 6.6): the last seven days on the viewer's matters, newest first, as sentences. An event newer than the person's
 * marker has a dot and the word "unread". Only "Mark all as read" and opening an event move the marker: viewing the panel never does, and
 * the first visit shows nothing unread. "Show more" adds 30. Below 640 px the first five show, then "Show all".
 */
@Component({
  selector: 'mf-mm-activity',
  imports: [PanelBox, RouterLink, RowLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .ac__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ac__row {
      display: grid;
      grid-template-columns: 4.5rem minmax(0, 1fr) auto;
      grid-template-areas:
        'mark text time'
        'mark matter time';
      column-gap: var(--mf-s2);
      padding: var(--mf-s1) 0;
      border-top: 1px solid var(--mf-border);
    }
    .ac__mark {
      grid-area: mark;
      display: inline-flex;
      gap: var(--mf-s1);
      align-items: flex-start;
      min-height: 20px;
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
      font-weight: 700;
    }
    .ac__dot {
      flex: none;
      width: 8px;
      height: 8px;
      margin-top: 0.4em;
      border-radius: 50%;
      background: var(--mf-primary);
    }
    .ac__text {
      grid-area: text;
      min-width: 0;
      min-height: 24px;
      overflow-wrap: anywhere;
      color: var(--mf-link);
    }
    .ac__row--unread .ac__text {
      font-weight: 700;
    }
    .ac__matter {
      grid-area: matter;
      min-width: 0;
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ac__time {
      grid-area: time;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
    }
    .ac__empty,
    .ac__legend {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .ac__legend {
      margin-top: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .ac__more {
      margin-top: var(--mf-s2);
    }
    @media (max-width: 639.98px) {
      .ac__row {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          'mark time'
          'text text'
          'matter matter';
        min-height: 44px;
      }
      .ac__more {
        min-height: 44px;
      }
      .ac__text {
        display: flex;
        align-items: center;
        min-height: 44px;
      }
    }
  `,
  template: `
    <mf-mm-panel
      name="activity"
      title="Recent activity"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      @if (unread() > 0) {
        <button
          mfPanelActions
          type="button"
          class="mf-btn"
          data-mark-all-read
          [disabled]="marking()"
          (click)="markAll()"
        >
          Mark all as read
        </button>
      }
      <span class="mf-sr-only" role="status" aria-live="polite" data-activity-announce>{{
        announcement()
      }}</span>
      @if (items().length === 0) {
        <p class="ac__empty" data-empty>No activity on your matters in the last 7 days.</p>
      } @else {
        <ul class="ac__list" data-activity-list>
          @for (e of visible(); track e.eventId) {
            <li
              class="ac__row"
              [class.ac__row--unread]="e.isUnread"
              data-activity-row
              [attr.data-unread]="e.isUnread"
            >
              <span class="ac__mark">
                @if (e.isUnread) {
                  <span class="ac__dot" aria-hidden="true"></span>
                  <span data-unread-word>unread</span>
                }
              </span>
              <a
                class="ac__text"
                data-activity-link
                mfRowLink="my-matters-activity"
                [rowKey]="e.eventId"
                [routerLink]="e.taskId ? ['/tasks', e.taskId] : ['/matters', e.matterId]"
                [queryParams]="e.taskId ? origin.params('my-matters') : undefined"
                [state]="origin.state()"
                (click)="opened(e)"
                >{{ text(e) }}</a
              >
              <span class="ac__matter"
                >{{ e.matterRef }} {{ e.matterName }} . {{ e.clientName }}</span
              >
              <time class="ac__time" [attr.datetime]="e.occurredAtUtc" [attr.title]="stamp(e)">{{
                when(e)
              }}</time>
            </li>
          }
        </ul>
        @if (items().length > visible().length) {
          <button type="button" class="mf-btn ac__more" data-show-all (click)="expanded.set(true)">
            Show all {{ items().length }}
          </button>
        } @else if (hasMore()) {
          <button type="button" class="mf-btn ac__more" data-show-more (click)="more()">
            Show more
          </button>
        }
        <p class="ac__legend">An event is unread until you mark all as read or open it.</p>
      }
    </mf-mm-panel>
  `,
})
export class ActivityPanel {
  readonly filters = input.required<MmFilters>();
  protected readonly origin = inject(TaskOriginLinks);
  private readonly api = inject(MyMattersClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  protected readonly phone = phoneCards();
  protected readonly take = signal(ACTIVITY_PAGE);
  protected readonly expanded = signal(false);
  protected readonly marking = signal(false);
  protected readonly announcement = signal('');

  protected readonly loader = panelLoader(
    () => [this.filters(), this.take()],
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersActivity(
        this.take(),
        undefined,
        undefined,
        undefined,
        undefined,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  constructor() {
    restoreRowFocus('my-matters-activity', () => this.loader.state() === 'ready');
  }

  protected readonly items = computed(() => this.loader.data()?.items ?? []);
  protected readonly unread = computed(() => this.loader.data()?.unreadCount ?? 0);
  protected readonly hasMore = computed(() => this.loader.data()?.hasMore ?? false);
  protected readonly visible = computed(() =>
    this.phone() && !this.expanded() ? this.items().slice(0, PHONE_EVENTS) : this.items(),
  );
  protected readonly text = activityText;

  protected when(e: MyMattersActivityItem): string {
    return activityTime(e.occurredAtUtc, this.clock.now(), this.zone);
  }

  protected stamp(e: MyMattersActivityItem): string {
    return formatInstant(e.occurredAtUtc, this.zone);
  }

  protected more(): void {
    this.take.update((n) => n + ACTIVITY_PAGE);
  }

  /** The marker moves to the newest event the person has seen on this page; nothing else moves it. */
  protected async markAll(): Promise<void> {
    const data = this.loader.data();
    if (!data || this.marking()) return;
    this.marking.set(true);
    try {
      await new Promise<void>((resolve, reject) =>
        this.api
          .markMyMattersActivitySeen({
            upToEventId: data.latestEventId > 0 ? data.latestEventId : undefined,
          })
          .subscribe({
            next: () => resolve(),
            error: reject,
          }),
      );
      this.loader.data.set({
        ...data,
        unreadCount: 0,
        seenEventId: data.latestEventId,
        items: data.items.map((i) => ({ ...i, isUnread: false })),
      });
      this.announcement.set('All activity marked as read.');
    } catch {
      // The error toast says it; the panel keeps showing the events as unread.
    } finally {
      this.marking.set(false);
    }
  }

  /** Opening an event marks it, and what is older, as read; the page does not wait for the answer. */
  protected opened(e: MyMattersActivityItem): void {
    if (!e.isUnread) return;
    this.api
      .markMyMattersActivitySeen({ upToEventId: e.eventId })
      .subscribe({ error: () => undefined });
  }
}
