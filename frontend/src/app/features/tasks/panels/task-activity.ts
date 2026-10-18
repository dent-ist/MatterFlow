import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TaskActivityClient, TaskActivityItem } from '../../../api/generated/api-client';
import { QuietRequests } from '../../../core/http/interceptors';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { ActivityText, activityText, friendlyText } from '../../../shared/ui/audit-format';
import { ActivityGroupRow, ActivityRow, formatRange, groupActivity } from './activity-groups';

interface Filter {
  readonly key: string;
  readonly label: string;
}

/** Filter chips of the Activity tab (UX S10); `key` is the category the API assigns to each entry. */
export const ACTIVITY_FILTERS: readonly Filter[] = [
  { key: 'ALL', label: 'All' },
  { key: 'STATUS', label: 'Status' },
  { key: 'ASSIGNMENT', label: 'Assignment' },
  { key: 'FIELDS', label: 'Fields' },
  { key: 'WORKFLOW', label: 'Workflow' },
  { key: 'COMMENTS', label: 'Comments' },
  { key: 'ASSETS', label: 'Assets' },
];

const PAGE_SIZE = 25;

/**
 * The Activity tab of a Task (UX S10): a read-only, newest-first timeline of what happened to the Task, its steps, comments and asset links,
 * with the actor, the time in the viewer's zone (UTC in the tooltip) and a readable sentence. "View changes" shows old and new values when
 * the server includes them (callers with Audit.View). Filter by type; "Load more" pages back through the history.
 *
 * Inputs: `taskId` (required) and `refresh` (change the number to reload, for example after a status change elsewhere on the page).
 */
@Component({
  selector: 'mf-task-activity',
  imports: [MfDatePipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ta" [class.ta--compact]="compact()" aria-label="Activity">
      <div class="ta__filters" role="group" aria-label="Filter by type">
        @for (f of filters; track f.key) {
          <button
            type="button"
            class="ta__chip"
            [attr.data-filter]="f.key"
            [attr.aria-pressed]="filter() === f.key"
            (click)="filter.set(f.key)"
          >
            {{ f.label }}
          </button>
        }
      </div>

      @switch (state()) {
        @case ('loading') {
          <p class="ta__muted" role="status" aria-busy="true">Loading activity...</p>
        }
        @case ('error') {
          <p class="ta__alert" role="alert" data-load-error>
            Something went wrong. Try again.
            <button type="button" class="ta__link" (click)="reload()">Retry</button>
          </p>
        }
        @default {
          @if (visible().length === 0) {
            <p class="ta__muted" data-empty>
              {{
                filter() === 'ALL'
                  ? 'No activity recorded yet.'
                  : 'No activity of this type has been loaded.'
              }}
            </p>
          } @else {
            <ol class="ta__list">
              @for (row of rows(); track trackKey(row)) {
                @if (row.kind === 'group') {
                  <li class="ta__item ta__item--group" [attr.data-group-key]="row.key">
                    <time
                      class="ta__time"
                      [attr.datetime]="row.latest.occurredAtUtc"
                      [title]="row.latest.occurredAtUtc + ' (UTC)'"
                      >{{ row.latest.occurredAtUtc | mfDate }}</time
                    >
                    <div class="ta__what">
                      <span class="ta__actor" data-actor>{{ row.actorName }}</span>
                      <span class="ta__summary" data-summary data-group-summary
                        >added {{ row.events.length }} comments ({{ range(row) }})</span
                      >
                      <button
                        type="button"
                        class="ta__link"
                        data-group-toggle
                        [attr.aria-expanded]="isGroupOpen(row)"
                        [attr.aria-controls]="'ta-group-' + row.key"
                        (click)="toggleGroup(row)"
                      >
                        {{ isGroupOpen(row) ? 'Hide comments' : 'Show comments' }}
                      </button>
                      @if (isGroupOpen(row)) {
                        <ol class="ta__sub" [id]="'ta-group-' + row.key" data-group-items>
                          @for (e of row.events; track e.eventId) {
                            <li
                              class="ta__sub-item"
                              [attr.data-event-id]="e.eventId"
                              [attr.data-category]="e.category"
                            >
                              <time
                                class="ta__time"
                                [attr.datetime]="e.occurredAtUtc"
                                [title]="e.occurredAtUtc + ' (UTC)'"
                                >{{ e.occurredAtUtc | mfDate }}</time
                              >
                              <span class="ta__summary" data-summary>{{ text(e).summary }}</span>
                              <ng-container
                                [ngTemplateOutlet]="excerptTpl"
                                [ngTemplateOutletContext]="{ $implicit: e }"
                              />
                            </li>
                          }
                        </ol>
                      }
                    </div>
                  </li>
                } @else {
                  @let e = row.event;
                  <li
                    class="ta__item"
                    [attr.data-event-id]="e.eventId"
                    [attr.data-category]="e.category"
                  >
                    <time
                      class="ta__time"
                      [attr.datetime]="e.occurredAtUtc"
                      [title]="e.occurredAtUtc + ' (UTC)'"
                      >{{ e.occurredAtUtc | mfDate }}</time
                    >
                    <div class="ta__what">
                      <span class="ta__actor" data-actor>{{
                        e.actor?.displayName ?? 'System'
                      }}</span>
                      <span class="ta__summary" data-summary>{{ text(e).summary }}</span>
                      @if (hasChanges(e)) {
                        <button
                          type="button"
                          class="ta__link"
                          data-changes-toggle
                          [attr.aria-expanded]="isOpen(e)"
                          (click)="toggle(e)"
                        >
                          {{ isOpen(e) ? 'Hide changes' : 'View changes' }}
                        </button>
                      }
                      @if (isOpen(e)) {
                        <p class="ta__changes" data-changes>
                          <span class="ta__old">{{ text(e).oldValue ?? 'none' }}</span>
                          <span aria-hidden="true"> &rarr; </span>
                          <span class="sr-only">changed to</span>
                          <span class="ta__new">{{ text(e).newValue ?? 'none' }}</span>
                        </p>
                      }
                      <ng-container
                        [ngTemplateOutlet]="excerptTpl"
                        [ngTemplateOutletContext]="{ $implicit: e }"
                      />
                    </div>
                  </li>
                }
              }
            </ol>
          }
          @if (moreFailed()) {
            <p class="ta__alert" role="alert" data-more-error>Something went wrong. Try again.</p>
          }
          @if (nextCursor() !== null) {
            <button
              type="button"
              class="ta__more"
              data-more
              [disabled]="loadingMore()"
              (click)="more()"
            >
              Load more
            </button>
          }
        }
      }
    </section>

    <ng-template #excerptTpl let-e>
      @if (e.commentId && e.excerpt) {
        <button
          type="button"
          class="ta__excerpt"
          data-comment-link
          [attr.data-comment-id]="e.commentId"
          (click)="showComment.emit(e.commentId)"
        >
          <span class="sr-only">Go to comment: </span>{{ e.excerpt }}
        </button>
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    .ta {
      display: grid;
      gap: var(--mf-s3);
    }
    .ta__filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
    .ta__chip,
    .ta__more {
      min-height: var(--mf-target-min, 2rem);
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .ta__chip[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      font-weight: 600;
    }
    .ta__more {
      justify-self: start;
    }
    .ta__list {
      display: grid;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ta__item {
      display: grid;
      grid-template-columns: 14rem 1fr;
      gap: var(--mf-s3);
      padding: var(--mf-s2) 0;
      border-bottom: 1px solid var(--mf-border);
    }
    .ta--compact .ta__item {
      grid-template-columns: 1fr;
      gap: var(--mf-s1);
    }
    @media (max-width: 40rem) {
      .ta__item {
        grid-template-columns: 1fr;
        gap: var(--mf-s1);
      }
    }
    .ta__time {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ta__actor {
      margin-right: var(--mf-s2);
      font-weight: 600;
    }
    .ta__excerpt {
      display: block;
      max-width: 100%;
      margin-top: var(--mf-s1);
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-align: left;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    .ta__excerpt:hover {
      text-decoration: underline;
    }
    .ta__sub {
      display: grid;
      gap: var(--mf-s1);
      margin: var(--mf-s2) 0 0;
      padding: 0 0 0 var(--mf-s3);
      border-left: 2px solid var(--mf-border);
      list-style: none;
    }
    .ta__sub-item .ta__time {
      margin-right: var(--mf-s2);
    }
    .ta__changes {
      margin: var(--mf-s1) 0 0;
      padding: var(--mf-s1) var(--mf-s2);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
      overflow-wrap: anywhere;
    }
    .ta__old {
      color: var(--mf-text-muted);
      text-decoration: line-through;
    }
    .ta__muted {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .ta__alert {
      margin: 0;
      color: var(--mf-danger-text, var(--mf-danger));
    }
    .ta__link {
      margin-left: var(--mf-s2);
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
})
export class TaskActivity {
  readonly taskId = input.required<number>();
  /** Change the value to reload the timeline. */
  readonly refresh = input(0);
  /** One column (time above the text), for the narrow Activity drawer. */
  readonly compact = input(false);
  /** The person chose the excerpt of a comment event: the id of that comment (the host shows it in the Comments section). */
  readonly showComment = output<number>();

  protected readonly filters = ACTIVITY_FILTERS;
  private readonly api = inject(TaskActivityClient);
  private readonly quiet = inject(QuietRequests);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly events = signal<TaskActivityItem[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  /** Loading older rows failed: one inline message, and "Load more" tries again. */
  protected readonly moreFailed = signal(false);
  protected readonly filter = signal('ALL');
  private readonly texts = new WeakMap<TaskActivityItem, ActivityText>();
  private readonly canViewChanges = signal(false);
  private readonly open = signal<ReadonlySet<number>>(new Set());

  protected readonly visible = computed(() => {
    const key = this.filter();
    return key === 'ALL' ? this.events() : this.events().filter((e) => e.category === key);
  });

  /** The visible events with runs of 3 or more "Comment added" by one person folded into one row each. */
  protected readonly rows = computed(() => groupActivity(this.visible()));
  private readonly openGroups = signal<ReadonlySet<number>>(new Set());

  constructor() {
    effect(() => {
      this.taskId();
      this.refresh();
      untracked(() => {
        this.state.set('loading');
        void this.load(null);
      });
    });
  }

  protected reload(): void {
    this.state.set('loading');
    void this.load(null);
  }

  protected more(): void {
    const cursor = this.nextCursor();
    if (cursor !== null) void this.load(cursor);
  }

  /** The row's sentence and values, dates in the app's format (the stored text stays as the server wrote it). */
  protected text(e: TaskActivityItem): ActivityText {
    const cached = this.texts.get(e);
    if (cached) return cached;
    const text = activityText({ ...e, summary: friendlyText(e.summary) });
    this.texts.set(e, text);
    return text;
  }

  protected hasChanges(e: TaskActivityItem): boolean {
    return this.canViewChanges() && (e.oldValue != null || e.newValue != null);
  }

  protected isOpen(e: TaskActivityItem): boolean {
    return this.open().has(e.eventId);
  }

  protected trackKey(row: ActivityRow): string {
    return row.kind === 'group' ? `g${row.key}` : `e${row.event.eventId}`;
  }

  protected range(group: ActivityGroupRow): string {
    const oldest = group.events[group.events.length - 1];
    return formatRange(oldest.occurredAtUtc, group.latest.occurredAtUtc, this.zone);
  }

  protected isGroupOpen(group: ActivityGroupRow): boolean {
    return this.openGroups().has(group.key);
  }

  protected toggleGroup(group: ActivityGroupRow): void {
    this.openGroups.update((set) => {
      const next = new Set(set);
      if (!next.delete(group.key)) next.add(group.key);
      return next;
    });
  }

  protected toggle(e: TaskActivityItem): void {
    this.open.update((set) => {
      const next = new Set(set);
      if (!next.delete(e.eventId)) next.add(e.eventId);
      return next;
    });
  }

  private async load(cursor: string | null): Promise<void> {
    const taskId = this.taskId();
    if (cursor !== null) this.loadingMore.set(true);
    this.moreFailed.set(false);
    try {
      // The drawer shows its own failure (the message with Retry, or under the list for "Load more"): the request is quiet, so no toast says it twice.
      const page = await this.quiet.run(() =>
        firstValueFrom(this.api.getTaskActivity(taskId, cursor ?? undefined, PAGE_SIZE)),
      );
      if (taskId !== this.taskId()) return;
      this.events.update((list) => (cursor === null ? page.items : [...list, ...page.items]));
      this.nextCursor.set(page.nextCursor ?? null);
      this.canViewChanges.set(page.canViewChanges);
      this.state.set('ready');
    } catch {
      if (taskId === this.taskId()) {
        if (cursor === null) this.state.set('error');
        else this.moreFailed.set(true);
      }
    } finally {
      this.loadingMore.set(false);
    }
  }
}
