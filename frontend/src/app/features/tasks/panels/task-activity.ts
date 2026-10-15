import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TaskActivityClient, TaskActivityItem } from '../../../api/generated/api-client';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { friendlyText } from '../../../shared/ui/audit-format';

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
  imports: [MfDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ta" aria-label="Activity">
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
              @for (e of visible(); track e.eventId) {
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
                    <span class="ta__actor" data-actor>{{ e.actor?.displayName ?? 'System' }}</span>
                    <span class="ta__summary" data-summary>{{ friendly(e.summary) }}</span>
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
                        <span class="ta__old">{{ e.oldValue ?? 'none' }}</span>
                        <span aria-hidden="true"> &rarr; </span>
                        <span class="sr-only">changed to</span>
                        <span class="ta__new">{{ e.newValue ?? 'none' }}</span>
                      </p>
                    }
                  </div>
                </li>
              }
            </ol>
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
  protected readonly friendly = friendlyText;
  readonly taskId = input.required<number>();
  /** Change the value to reload the timeline. */
  readonly refresh = input(0);

  protected readonly filters = ACTIVITY_FILTERS;
  private readonly api = inject(TaskActivityClient);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly events = signal<TaskActivityItem[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly filter = signal('ALL');
  private readonly canViewChanges = signal(false);
  private readonly open = signal<ReadonlySet<number>>(new Set());

  protected readonly visible = computed(() => {
    const key = this.filter();
    return key === 'ALL' ? this.events() : this.events().filter((e) => e.category === key);
  });

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

  protected hasChanges(e: TaskActivityItem): boolean {
    return this.canViewChanges() && (e.oldValue != null || e.newValue != null);
  }

  protected isOpen(e: TaskActivityItem): boolean {
    return this.open().has(e.eventId);
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
    try {
      const page = await firstValueFrom(
        this.api.getTaskActivity(taskId, cursor ?? undefined, PAGE_SIZE),
      );
      if (taskId !== this.taskId()) return;
      this.events.update((list) => (cursor === null ? page.items : [...list, ...page.items]));
      this.nextCursor.set(page.nextCursor ?? null);
      this.canViewChanges.set(page.canViewChanges);
      this.state.set('ready');
    } catch {
      if (taskId === this.taskId()) {
        if (cursor === null) this.state.set('error');
      }
    } finally {
      this.loadingMore.set(false);
    }
  }
}
