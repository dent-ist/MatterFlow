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
import { RouterLink } from '@angular/router';
import {
  MyMattersSinceCount,
  MyMattersSinceItem,
  MyMattersClient,
} from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { formatInstant, formatStatusStamp } from '../../../core/time/time';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { factText } from '../facts';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { activityText } from './activity-panel';
import { PanelBox } from './panel-box';

/** One figure of the sentence: its words and where it leads. */
interface Figure {
  key: string;
  count: number;
  words: string;
  /** Router commands and query of the link (the Task Queue, or the Activity tab of this page). */
  commands: string[];
  params: Record<string, string | string[]>;
}

/**
 * The address a count leads to. A count that lists tasks opens the Task Queue with its own filters; a count that lists events opens the
 * Activity tab with the kind (and "unread" while the person has a marker). The event period (`from`) is dropped: the tab shows 30 days.
 */
export function figureLink(c: MyMattersSinceCount): {
  commands: string[];
  params: Record<string, string | string[]>;
} {
  const params = queryToParams(c.query);
  if (c.target === 'taskQueue') return { commands: ['/tasks'], params };
  delete params['from'];
  return { commands: ['/my-matters'], params: { ...params, tab: 'activity' } };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * "Since your last visit" (epic #758, PX-19; README 6.1): a card at the top of Overview with one sentence of counts ("4 tasks became overdue,
 * 2 reassigned, 7 completed ..."), each count a link to the list behind it, the (at most five) most important items, and "Mark as read". Opening
 * the page never moves the marker; only "Mark as read" does (the same marker as the Activity tab and the Recent activity panel). Without a
 * marker the card covers the last 7 days. A comment is only ever a count: its text is never shown.
 */
@Component({
  selector: 'mf-mm-since',
  imports: [PanelBox, RouterLink, RowLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .sv__line {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .sv__sentence {
      margin: 0 0 var(--mf-s2);
      padding: 0;
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s3);
    }
    .sv__fig a {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      color: var(--mf-link);
    }
    .sv__fig b {
      margin-right: 0.25em;
      font-variant-numeric: tabular-nums;
    }
    .sv__items {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .sv__item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      column-gap: var(--mf-s3);
      padding: var(--mf-s1) 0;
      border-top: 1px solid var(--mf-border);
    }
    .sv__link {
      min-width: 0;
      min-height: 24px;
      line-height: 24px;
      overflow-wrap: anywhere;
      color: var(--mf-link);
    }
    .sv__meta {
      grid-column: 1;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .sv__fact {
      grid-row: 1;
      grid-column: 2;
      align-self: center;
      white-space: nowrap;
    }
    .sv__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }
    /* Below 640 px the events sit behind a "Show events" button so the counts line and the next panel share the first screen (#818). */
    .sv__toggle {
      display: none;
    }
    @media (max-width: 639.98px) {
      .sv__toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--mf-s2);
        min-height: 44px;
        padding: 0 var(--mf-s3);
        margin: 0 0 var(--mf-s1);
      }
      .sv__items--shut {
        display: none;
      }
      .sv__fig a,
      .sv__link {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
      }
      .sv__item {
        grid-template-columns: minmax(0, 1fr);
      }
      .sv__fact {
        grid-row: auto;
        grid-column: 1;
      }
    }
  `,
  template: `
    <mf-mm-panel
      name="since"
      title="Since your last visit"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      @if (!empty()) {
        <button
          mfPanelActions
          type="button"
          class="mf-btn"
          data-mark-read
          [disabled]="marking()"
          (click)="markRead()"
        >
          Mark as read
        </button>
      }
      <span class="mf-sr-only" role="status" aria-live="polite" data-since-announce>{{
        announcement()
      }}</span>
      @if (empty()) {
        <p class="sv__empty" data-since-empty>Nothing has changed since your last visit.</p>
      } @else {
        <p class="sv__line" data-since-period [attr.title]="stamp()">{{ period() }}</p>
        <ul class="sv__sentence" data-since-figures>
          @for (f of figures(); track f.key) {
            <li class="sv__fig">
              <a [routerLink]="f.commands" [queryParams]="f.params" [attr.data-figure]="f.key"
                ><b>{{ f.count }}</b
                >{{ f.words }}</a
              >
            </li>
          }
        </ul>
        @if (items().length > 0) {
          <button
            type="button"
            class="mf-btn sv__toggle"
            data-since-toggle
            aria-controls="mm-since-events"
            [attr.aria-expanded]="eventsOpen()"
            (click)="eventsOpen.set(!eventsOpen())"
          >
            <i
              class="pi"
              [class.pi-chevron-down]="!eventsOpen()"
              [class.pi-chevron-up]="eventsOpen()"
              aria-hidden="true"
            ></i>
            {{ eventsOpen() ? 'Hide events' : 'Show events (' + items().length + ')' }}
          </button>
          <ul
            class="sv__items"
            id="mm-since-events"
            data-since-items
            [class.sv__items--shut]="!eventsOpen()"
          >
            @for (it of items(); track $index) {
              <li class="sv__item" data-since-item>
                @if (it.task; as t) {
                  <a
                    class="sv__link"
                    mfRowLink="my-matters-since"
                    [rowKey]="t.taskId"
                    [routerLink]="['/tasks', t.taskId]"
                    [queryParams]="origin.params('my-matters')"
                    [state]="origin.state()"
                    >{{ t.taskNumber }} {{ t.title }} became overdue</a
                  >
                  <span class="sv__meta">{{ t.matterRef }} {{ t.matterName }}</span>
                  <span class="sv__fact">{{ fact(t) }}</span>
                } @else if (it.event; as e) {
                  <a
                    class="sv__link"
                    mfRowLink="my-matters-since"
                    [rowKey]="e.eventId"
                    [routerLink]="e.taskId ? ['/tasks', e.taskId] : ['/matters', e.matterId]"
                    [queryParams]="e.taskId ? origin.params('my-matters') : undefined"
                    [state]="origin.state()"
                    >{{ text(e) }}</a
                  >
                  <span class="sv__meta">{{ e.matterRef }} {{ e.matterName }}</span>
                }
              </li>
            }
          </ul>
        }
      }
    </mf-mm-panel>
  `,
})
export class SincePanel {
  readonly filters = input.required<MmFilters>();
  /** Changes whenever the marker moved elsewhere on the page (Recent activity's Mark all as read): the card reads again. */
  readonly marker = input(0);
  /** The marker moved (Mark as read): the other panels that show unread items read again. */
  readonly marked = output<void>();
  /** The first read is over (it worked or it failed): the panels that wait for it may ask now. */
  readonly settled = output<void>();

  protected readonly origin = inject(TaskOriginLinks);
  private readonly api = inject(MyMattersClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  protected readonly marking = signal(false);
  /** Phone: the events below the counts are shown (a button toggles them; from 640 px they always show). */
  protected readonly eventsOpen = signal(false);
  protected readonly announcement = signal('');
  /** The marks made here (the page counts them in `marker` too): the card reads again by itself, once. */
  private readonly own = signal(0);
  /** The marker moves made elsewhere: a computed, so a move made here (counted in both) changes nothing. */
  private readonly moves = computed(() => this.marker() - this.own());

  protected readonly loader = panelLoader(
    () => [this.filters(), this.moves()],
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersSinceLastVisit(
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
    restoreRowFocus('my-matters-since', () => this.loader.state() === 'ready');
    let first = true;
    effect(() => {
      if (this.loader.state() === 'loading' || !first) return;
      first = false;
      untracked(() => this.settled.emit());
    });
  }

  protected readonly figures = computed((): Figure[] => {
    const c = this.loader.data()?.counts;
    if (!c) return [];
    const make = (key: string, count: MyMattersSinceCount, words: string): Figure => ({
      key,
      count: count.count,
      words: ` ${words}`,
      ...figureLink(count),
    });
    return [
      make(
        'becameOverdue',
        c.becameOverdue,
        plural(c.becameOverdue.count, 'task became overdue', 'tasks became overdue'),
      ),
      make('reassigned', c.reassigned, 'reassigned'),
      make('completed', c.completed, 'completed'),
      make('newTasks', c.newTasks, plural(c.newTasks.count, 'new task', 'new tasks')),
      make('putOnHold', c.putOnHold, plural(c.putOnHold.count, 'put on hold', 'put on hold')),
      make('comments', c.comments, plural(c.comments.count, 'comment', 'comments')),
    ].filter((f) => f.count > 0);
  });

  protected readonly items = computed((): MyMattersSinceItem[] => this.loader.data()?.items ?? []);
  protected readonly empty = computed(
    () => this.figures().length === 0 && this.items().length === 0,
  );

  /** "Since Oct 19, 9:12 AM" with a marker; without one the card says it covers the last 7 days. */
  protected readonly period = computed(() => {
    const d = this.loader.data();
    if (!d) return '';
    return d.hasMarker
      ? `Since ${formatStatusStamp(d.sinceUtc, this.zone, this.clock.now())}`
      : 'You have not marked anything as read yet: the last 7 days.';
  });
  protected readonly stamp = computed(() => {
    const d = this.loader.data();
    return d ? formatInstant(d.sinceUtc, this.zone) : null;
  });
  protected readonly text = activityText;
  protected readonly fact = factText;

  /** The one thing that moves the marker on this card. */
  protected async markRead(): Promise<void> {
    if (this.marking()) return;
    this.marking.set(true);
    try {
      await new Promise<void>((resolve, reject) =>
        this.api.markMyMattersActivitySeen({}).subscribe({ next: () => resolve(), error: reject }),
      );
      this.announcement.set('Marked as read.');
      this.own.update((n) => n + 1);
      this.marked.emit();
      this.loader.load();
    } catch {
      // The error toast says it; the card keeps showing what changed.
    } finally {
      this.marking.set(false);
    }
  }
}
