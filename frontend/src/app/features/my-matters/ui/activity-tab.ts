import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Clock } from '../../../core/time/clock';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { FilterChip, FilterChips } from '../../../shared/ui/filter-chips';
import { GridFrame } from '../../../shared/ui/grid-frame';
import { AssetTypeChip } from '../../../shared/ui/asset-type-chip';
import { TaskTypeChip } from '../../../shared/ui/task-type-chip';
import { Pager } from '../../../shared/ui/pager';
import { MmFilters } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { agoShort, feedTitle, feedWhat, KIND_LOOK } from './feed-format';
import { MmApi } from './mm-api';
import { FEED_KINDS, FeedItem, FeedKind } from './mm-models';

const PAGE_SIZE = 25;

/**
 * The Activity tab (`mf-mm-activity-tab`, epic #953 UI-17): the whole recent-activity feed as a grid (When, Who, What, Task, Matter and an unread dot), with the six kinds as chips
 * with counts (New assets, New comments, New status updates, On hold, Overdue, Due date updated; "Delayed" is Overdue), an Unread only toggle, "Mark all as read" and paging.
 * A task item opens the task in a NEW browser tab; an asset item opens the Assets tab with that asset's side panel. Every item carries the kind's icon and word, never colour alone.
 */
@Component({
  selector: 'mf-mm-activity-tab',
  imports: [AssetTypeChip, TaskTypeChip, FilterChips, GridFrame, MfDatePipe, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <mf-grid-frame scrollLabel="Activity" [resetKey]="kind() + '|' + unreadOnly() + '|' + page()">
      <div frameHead class="hd">
        <h2 class="ttl">
          Activity
          @if (unreadCount() > 0) {
            <span class="tot" data-unread>{{ unreadCount() }} unread</span>
          }
        </h2>
        <div class="tools">
          <label class="chk"
            ><input
              type="checkbox"
              data-unread-only
              [checked]="unreadOnly()"
              (change)="unreadOnly.set($any($event.target).checked)"
            />
            Unread only</label
          >
          <button
            type="button"
            class="b"
            data-mark-read
            [attr.aria-disabled]="unreadCount() === 0 || marking() ? true : null"
            (click)="markRead()"
          >
            <i class="pi pi-check" aria-hidden="true"></i> Mark all as read
          </button>
        </div>
      </div>
      <div frameStatus class="kc">
        <mf-filter-chips
          label="Kind of activity"
          [chips]="chips()"
          [value]="kind() ?? 'ALL'"
          emptyKey="ALL"
          (valueChange)="kindChange.emit($event === 'ALL' ? null : $event)"
        />
      </div>
      <p class="sr" role="status">{{ announcement() }}</p>
      @if (loader.state() === 'error') {
        <p class="msg" role="alert">
          Couldn't load activity.
          <button type="button" class="lnk" (click)="loader.load()">Retry</button>
        </p>
      } @else if (loader.state() === 'loading' && items().length === 0) {
        <p class="msg" role="status">Loading activity</p>
      } @else if (items().length === 0) {
        <p class="msg" data-empty>
          {{
            kind() || unreadOnly()
              ? 'No activity matches these filters.'
              : 'No activity in the last 30 days.'
          }}
        </p>
      } @else {
        <table class="tt" [attr.aria-busy]="loader.busy()">
          <caption class="sr">
            Recent activity, newest first
          </caption>
          <thead>
            <tr>
              <th scope="col" class="c-w">When</th>
              <th scope="col" class="c-k">What</th>
              <th scope="col" class="c-t">Task or asset</th>
              <th scope="col" class="c-who">Who</th>
              <th scope="col" class="c-m">Matter</th>
            </tr>
          </thead>
          <tbody>
            @for (i of items(); track i.itemKey) {
              <tr [class.unread]="i.isUnread">
                <td class="c-w">
                  @if (i.isUnread) {
                    <span class="dot" aria-hidden="true"></span><span class="sr">Unread. </span>
                  }
                  {{ ago(i) }}<span class="m">{{ i.occurredAtUtc | mfDate: 'date' }}</span>
                </td>
                <td class="c-k">
                  <div class="kw">
                    <span class="ki" [attr.data-tone]="look(i.kind).tone" aria-hidden="true"
                      ><i class="pi" [class]="look(i.kind).icon"></i
                    ></span>
                    <span class="kt">
                      <span class="kind" [attr.data-tone]="look(i.kind).tone">{{
                        look(i.kind).label
                      }}</span>
                      <span class="m">{{ what(i) }}</span>
                    </span>
                  </div>
                </td>
                <td class="c-t">
                  <div class="kw">
                    @if (i.typeName) {
                      @if (i.taskId !== null) {
                        <mf-task-type-chip
                          size="sm"
                          [iconKey]="i.typeIconKey"
                          [colourKey]="i.typeColourKey"
                          [typeId]="i.typeId"
                          [name]="i.typeName"
                        />
                      } @else {
                        <mf-asset-type-chip
                          size="sm"
                          [iconKey]="i.typeIconKey"
                          [colourKey]="i.typeColourKey"
                          [typeId]="i.typeId"
                          [name]="i.typeName"
                        />
                      }
                    }
                    <span class="kt">
                      @if (i.taskId !== null) {
                        <a
                          class="lnk"
                          [href]="taskHref(i.taskId)"
                          target="_blank"
                          rel="noopener"
                          [attr.data-feed]="i.itemKey"
                          >{{ title(i) }}<span class="sr"> (opens in a new tab)</span></a
                        >
                      } @else {
                        <button
                          type="button"
                          class="lnk"
                          [attr.data-feed]="i.itemKey"
                          (click)="assetOpened.emit(i.assetId!)"
                        >
                          {{ title(i) }}
                        </button>
                      }
                    </span>
                  </div>
                </td>
                <td class="c-who">{{ i.actorName ?? 'System' }}</td>
                <td class="c-m">
                  {{ i.matterName }}<span class="m">{{ i.clientName }}</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      <div frameFoot>
        @if (total() > pageSize) {
          <mf-pager
            [page]="page()"
            [pageSize]="pageSize"
            [pageSizes]="[]"
            [total]="total()"
            (pageChange)="pageChange.emit($event)"
          />
        }
      </div>
    </mf-grid-frame>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
    }
    mf-grid-frame {
      height: 100%;
    }
    .hd {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
      padding: var(--mf-s3) var(--mf-s4);
    }
    .ttl {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .tot {
      padding: 0 var(--mf-s2);
      border-radius: 999px;
      background: var(--mf-primary);
      color: var(--mf-surface);
      font-size: var(--mf-fs-xs);
    }
    .tools {
      display: flex;
      align-items: center;
      gap: var(--mf-s4);
      margin-left: auto;
      flex-wrap: wrap;
    }
    .chk {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
      font-size: var(--mf-fs-sm);
    }
    .b {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .b[aria-disabled='true'] {
      color: var(--mf-text-muted);
      cursor: not-allowed;
    }
    .kc {
      padding: var(--mf-s2) var(--mf-s4) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
    }
    .msg {
      margin: var(--mf-s4);
      color: var(--mf-text-muted);
    }
    .lnk {
      color: var(--mf-link);
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      text-align: left;
      cursor: pointer;
      text-decoration: none;
    }
    .lnk:hover {
      text-decoration: underline;
    }
    .tt td {
      padding: var(--mf-s2) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
      vertical-align: top;
    }
    tr.unread td {
      background: var(--mf-selected-bg);
    }
    .m {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: var(--mf-s1);
      border-radius: 50%;
      background: var(--mf-primary);
    }
    .kw {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .kt {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .ki {
      display: grid;
      flex: none;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: var(--mf-radius-lg);
      background: var(--k-bg);
      color: var(--k-fg);
    }
    .ki[data-tone='info'] {
      --k-bg: var(--mf-sem-info-bg);
      --k-fg: var(--mf-sem-info-fg);
    }
    .ki[data-tone='accent'] {
      --k-bg: var(--mf-status-progress-bg);
      --k-fg: var(--mf-status-progress-fg);
    }
    .ki[data-tone='neutral'] {
      --k-bg: var(--mf-surface-alt);
      --k-fg: var(--mf-text-muted);
    }
    .ki[data-tone='danger'] {
      --k-bg: var(--mf-sem-overdue-bg);
      --k-fg: var(--mf-sem-overdue-fg);
    }
    .ki[data-tone='warning'] {
      --k-bg: var(--mf-sem-risk-bg);
      --k-fg: var(--mf-sem-risk-fg);
    }
    .kind {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 1px var(--mf-s2);
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      background: var(--k-bg);
      color: var(--k-fg);
    }
    .kind[data-tone='info'] {
      --k-bg: var(--mf-sem-info-bg);
      --k-fg: var(--mf-sem-info-fg);
    }
    .kind[data-tone='accent'] {
      --k-bg: var(--mf-status-progress-bg);
      --k-fg: var(--mf-status-progress-fg);
    }
    .kind[data-tone='neutral'] {
      --k-bg: var(--mf-surface-alt);
      --k-fg: var(--mf-text-muted);
    }
    .kind[data-tone='danger'] {
      --k-bg: var(--mf-sem-overdue-bg);
      --k-fg: var(--mf-danger);
    }
    .kind[data-tone='warning'] {
      --k-bg: var(--mf-sem-risk-bg);
      --k-fg: var(--mf-sem-risk-fg);
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    @media (max-width: 900px) {
      .c-who {
        display: none;
      }
      th.c-who {
        display: none;
      }
    }
    @media (max-width: 767.98px) {
      .tt,
      .tt tbody {
        display: block;
        width: 100%;
      }
      .tt thead {
        display: none;
      }
      .tt tr {
        display: grid;
        gap: var(--mf-s1);
        padding: var(--mf-s3) var(--mf-s4);
        border-bottom: 1px solid var(--mf-border);
      }
      .tt td {
        display: block;
        padding: 0;
        border: 0;
      }
      .c-who {
        display: block;
      }
      .lnk,
      .b {
        min-height: 44px;
      }
    }
  `,
})
export class MmActivityTab {
  private readonly api = inject(MmApi);
  private readonly router = inject(Router);
  private readonly clock = inject(Clock);

  readonly filters = input.required<MmFilters>();
  readonly kind = input<string | null>(null);
  readonly page = input(1);
  readonly kindChange = output<string | null>();
  readonly pageChange = output<number>();
  readonly assetOpened = output<number>();
  /** The marker moved: the page reloads the badge. */
  readonly marked = output<void>();

  protected readonly pageSize = PAGE_SIZE;
  protected readonly unreadOnly = signal(false);
  protected readonly marking = signal(false);
  protected readonly announcement = signal('');

  protected readonly loader = panelLoader(
    () => [this.filters(), this.kind(), this.unreadOnly(), this.page()],
    () => {
      const k = FEED_KINDS.find((x) => x.kind === this.kind())?.kind;
      return this.api.feed(this.filters(), {
        kind: k ? [k] : undefined,
        unread: this.unreadOnly() || undefined,
        page: this.page(),
        pageSize: PAGE_SIZE,
      });
    },
  );
  protected readonly items = computed<FeedItem[]>(() => this.loader.data()?.items ?? []);
  protected readonly total = computed(() => this.loader.data()?.total ?? 0);
  protected readonly unreadCount = computed(() => this.loader.data()?.unreadCount ?? 0);
  protected readonly chips = computed<FilterChip[]>(() => {
    const c = this.loader.data()?.countsByKind;
    const all = c ? Object.values(c).reduce((a, b) => a + b, 0) : null;
    return [
      { key: 'ALL', label: 'All', count: all },
      ...FEED_KINDS.map((k) => ({
        key: k.kind,
        label: k.label,
        count: c ? c[k.kind] : null,
        icon: KIND_LOOK[k.kind].icon,
      })),
    ];
  });

  protected look(k: FeedKind) {
    return KIND_LOOK[k];
  }
  protected title(i: FeedItem): string {
    return feedTitle(i);
  }
  protected what(i: FeedItem): string {
    return feedWhat(i);
  }
  protected ago(i: FeedItem): string {
    return agoShort(i.occurredAtUtc, this.clock.now());
  }
  protected taskHref(id: number): string {
    return this.router.serializeUrl(this.router.createUrlTree(['/tasks', id]));
  }

  protected markRead(): void {
    if (this.unreadCount() === 0 || this.marking()) return;
    this.marking.set(true);
    this.api.markSeen().subscribe({
      next: () => {
        this.marking.set(false);
        this.announcement.set('All activity is marked as read.');
        this.loader.load();
        this.marked.emit();
      },
      error: () => {
        this.marking.set(false);
        this.announcement.set('Could not mark the activity as read.');
      },
    });
  }
}
