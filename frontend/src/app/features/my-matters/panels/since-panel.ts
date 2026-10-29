import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersSinceCount, MyMattersClient } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { formatInstant, formatStatusStamp } from '../../../core/time/time';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { LoadGroup, panelLoader } from '../panel-loader';

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

/**
 * What changed since the person's last visit, loaded once for the page (epic #893, owner decision of 2026-10-28, cut 1): the Overview no longer draws the
 * line, so the number of changes is the small badge on the Activity tab (the tab strip is always in sight) and the same line is shown when the tab is opened
 * (`mf-mm-since`, with "Mark as read"). Both read this one request. The page gives it the filters in force.
 */
@Injectable()
export class SinceFeed {
  private readonly api = inject(MyMattersClient);
  /** The page's filters; the first request waits until the page has set them. */
  readonly filters = signal<MmFilters | null>(null);

  readonly loader = panelLoader(
    () => this.filters(),
    () => {
      const a = commonArgs(this.filters()!);
      return this.api.getMyMattersSinceLastVisit(
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
        undefined,
        a.matterId,
      );
    },
    { enabled: () => this.filters() !== null },
  );

  /** The four changes that call for a decision, in the order of the line; a zero is not shown. */
  readonly figures = computed((): Figure[] => {
    const c = this.loader.data()?.counts;
    if (!c) return [];
    const make = (key: string, count: MyMattersSinceCount, words: string): Figure => ({
      key,
      count: count.count,
      words: ` ${words}`,
      ...figureLink(count),
    });
    return [
      make('becameOverdue', c.becameOverdue, 'became overdue'),
      make('putOnHold', c.putOnHold, 'put on hold'),
      make('completed', c.completed, 'completed'),
      make('newUnassigned', c.newUnassigned, 'new unassigned'),
    ].filter((f) => f.count > 0);
  });

  /** Moves on each time the marker moved from the line ("Mark as read"), so the Activity tab's list, which is read against the same marker, loads again. */
  readonly marks = signal(0);

  /** The number on the Activity tab: all the changes of the line (0: no badge). */
  readonly total = computed(() => this.figures().reduce((sum, f) => sum + f.count, 0));
}

/**
 * What changed, in one line (epic #893, issues #909 and #895; since 2026-10-28 it is drawn at the top of the Activity tab, not on the Overview): "Since your last visit: 2 became overdue, 4 put on hold, 9 completed, 3 new unassigned", each
 * part a link to the list behind it, and "Mark as read" as a small text button at the end. Only the changes that call for a decision are counted (became
 * overdue, put on hold, completed, new unassigned); reassignments, comments and new tasks are not decisions and the events themselves are on the Activity
 * tab, so this line never lists an event. When none of the four changed nothing is drawn at all. Opening the page never moves the marker; only "Mark
 * as read" does (the same marker as the Activity tab). Without a marker the line covers the last 7 days.
 */
@Component({
  selector: 'mf-mm-since',
  imports: [ErrorReference, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .sv {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 var(--mf-s2);
      margin: 0 0 var(--mf-s1);
      min-height: 24px;
    }
    .sv__lead {
      color: var(--mf-text-muted);
    }
    .sv__figures {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .sv__fig:not(:last-child)::after {
      content: ',';
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
    .sv__mark {
      min-height: 24px;
      padding: 0 var(--mf-s2);
    }
    .sv__muted {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
    }
    .sv__error {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
    }
    @media (max-width: 639.98px) {
      /* A phone (issue #922): one 44 px row that scrolls sideways instead of three lines and a button under them. */
      .sv {
        flex-wrap: nowrap;
        margin-bottom: 0;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
        white-space: nowrap;
      }
      .sv__figures {
        flex-wrap: nowrap;
      }
      .sv__lead,
      .sv__mark {
        flex: none;
      }
      .sv__fig a,
      .sv__mark {
        min-height: 44px;
      }
    }
  `,
  template: `
    @if (loader.state() === 'error') {
      @if (group?.many()) {
        <p class="sv__muted" data-panel-notloaded>
          What changed since your last visit: not loaded.
        </p>
      } @else {
        <div class="sv__error" role="alert" data-panel-error>
          <span>Couldn't load what changed since your last visit.</span>
          <mf-error-reference />
          <button type="button" class="mf-btn" data-panel-retry (click)="loader.load()">
            Retry
          </button>
        </div>
      }
    }
    @if (figures().length > 0) {
      <section
        class="sv"
        aria-label="Since your last visit"
        data-panel="since"
        [attr.aria-busy]="loader.busy() ? 'true' : null"
      >
        <span class="sv__lead" data-since-period [attr.title]="stamp()">{{ lead() }}</span>
        <ul class="sv__figures" data-since-figures>
          @for (f of figures(); track f.key) {
            <li class="sv__fig">
              <a [routerLink]="f.commands" [queryParams]="f.params" [attr.data-figure]="f.key"
                ><b>{{ f.count }}</b
                >{{ f.words }}</a
              >
            </li>
          }
        </ul>
        <button
          type="button"
          class="mf-btn mf-btn--text sv__mark"
          data-mark-read
          [disabled]="marking()"
          (click)="markRead()"
        >
          Mark as read
        </button>
      </section>
    }
    <span class="mf-sr-only" role="status" aria-live="polite" data-since-announce>{{
      announcement()
    }}</span>
  `,
})
export class SincePanel {
  private readonly api = inject(MyMattersClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  protected readonly marking = signal(false);
  protected readonly announcement = signal('');

  private readonly feed = inject(SinceFeed);
  protected readonly group = inject(LoadGroup, { optional: true });
  protected readonly loader = this.feed.loader;
  protected readonly figures = this.feed.figures;

  /** "Since your last visit:"; without a marker the line says it covers the last 7 days. */
  protected readonly lead = computed(() =>
    this.loader.data()?.hasMarker === false ? 'In the last 7 days:' : 'Since your last visit:',
  );

  /** The tooltip: the exact start of the period. */
  protected readonly stamp = computed(() => {
    const d = this.loader.data();
    if (!d) return null;
    return d.hasMarker
      ? `Since ${formatStatusStamp(d.sinceUtc, this.zone, this.clock.now())} (${formatInstant(d.sinceUtc, this.zone)})`
      : 'You have not marked anything as read yet: the last 7 days.';
  });

  /** The one thing that moves the marker on this line. */
  protected async markRead(): Promise<void> {
    if (this.marking()) return;
    this.marking.set(true);
    try {
      await new Promise<void>((resolve, reject) =>
        this.api.markMyMattersActivitySeen({}).subscribe({ next: () => resolve(), error: reject }),
      );
      this.announcement.set('Marked as read.');
      this.feed.marks.update((n) => n + 1);
      this.loader.load();
    } catch {
      // The error toast says it; the line keeps showing what changed.
    } finally {
      this.marking.set(false);
    }
  }
}
