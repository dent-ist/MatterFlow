import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import type { SearchHit } from '../../api/generated/api-client';
import { highlightParts, SearchType } from '../../shared/search/search-meta';
import { ActiveBadge, Badge, SensitiveBadge } from '../../shared/ui/badge';
import { TaskTypeBadge } from '../../shared/task-type/task-type-badge';
import { dispositionOf } from '../assets/disposition/asset-disposition';
import { hitDueText, hitIsOverdue, hitSizeText } from './search-facts';
import { LoadState } from '../../shared/ui/data-table';
import { GridBody } from '../../shared/ui/grid-body';
import { MatterRef } from '../../shared/ui/matter-ref';
import { RecordCardDef, RecordCardList, phoneCards } from '../../shared/ui/record-card-list';
import { RowLink } from '../../shared/ui/row-nav';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TaskOriginLinks } from '../../shared/work-queue/task-origin';
import { SearchHitCard, hitRowKey } from './search-hit-card';

/** The kinds of cell the grid knows; each type picks its columns from them. */
type CellKind =
  | 'ref'
  | 'name'
  | 'client'
  | 'matter'
  | 'matterNumber'
  | 'assetType'
  | 'status'
  | 'taskType'
  | 'due'
  | 'size'
  | 'disposition';

interface Column {
  kind: CellKind;
  heading: string;
  /** Width of the skeleton bone. */
  bone: string;
  /** Extra cell class. */
  cls?: string;
}

const STATUS: Column = { kind: 'status', heading: 'Status', bone: '4.5rem' };

/**
 * The columns of each type (Search review S4, #468, #469). The reference column means one thing, a business number (a matter, client or task
 * number), and an asset has none: its URL reference is the tooltip of the row only; assets show their Type and the Matter number instead.
 * `mixed` is only the skeleton of the All tab before it knows which types answer.
 */
export const SEARCH_COLUMNS: Record<SearchType | 'mixed', readonly Column[]> = {
  matter: [
    { kind: 'ref', heading: 'Number', bone: '6rem', cls: 'sg-ref' },
    { kind: 'name', heading: 'Name', bone: '14rem' },
    { kind: 'client', heading: 'Client', bone: '9rem' },
    STATUS,
  ],
  client: [
    { kind: 'ref', heading: 'Number', bone: '5rem', cls: 'sg-ref' },
    { kind: 'name', heading: 'Name', bone: '16rem' },
    STATUS,
  ],
  task: [
    { kind: 'ref', heading: 'Ref', bone: '5rem', cls: 'sg-ref' },
    { kind: 'name', heading: 'Title', bone: '16rem' },
    { kind: 'taskType', heading: 'Type', bone: '2rem' },
    { kind: 'matter', heading: 'Matter', bone: '9rem' },
    { kind: 'due', heading: 'Due', bone: '5rem', cls: 'sg-due' },
    STATUS,
  ],
  project: [
    { kind: 'name', heading: 'Name', bone: '16rem' },
    { kind: 'matter', heading: 'Matter', bone: '9rem' },
    STATUS,
  ],
  asset: [
    { kind: 'name', heading: 'Name', bone: '16rem' },
    { kind: 'assetType', heading: 'Type', bone: '6rem' },
    { kind: 'matterNumber', heading: 'Matter number', bone: '6rem' },
    { kind: 'size', heading: 'Size', bone: '4rem', cls: 'sg-size' },
    { kind: 'disposition', heading: 'Disposition', bone: '5rem' },
  ],
  mixed: [
    { kind: 'ref', heading: 'Number', bone: '5rem', cls: 'sg-ref' },
    { kind: 'name', heading: 'Name', bone: '16rem' },
    { kind: 'client', heading: 'Details', bone: '9rem' },
    STATUS,
  ],
};

/**
 * The grid of search hits of one type (Search review S2, S3, S4, S7; #468, #469, #470, #473), used by every type tab and by each section of the
 * All tab. A table of 44 px rows on the record-list conventions (the name is the only link, numbers are plain text, long text is cut with its
 * full text as the tooltip, relevance order, no column sort), and below 640 px the same hits as cards (`mf-search-hit-card` on
 * `mf-record-card-list`), so no table is cut at Status. The states are the grid body's: skeleton rows, the error with its reference and Retry,
 * the empty text. A task link remembers the results page as its origin (Back returns to the row).
 *
 *   <mf-search-grid type="task" label="Tasks" [hits]="page.items" [state]="state()" [query]="q()" (retry)="load()" />
 */
@Component({
  selector: 'mf-search-grid',
  imports: [
    ActiveBadge,
    GridBody,
    MatterRef,
    RecordCardDef,
    RecordCardList,
    RouterLink,
    RowLink,
    SearchHitCard,
    SensitiveBadge,
    StatusBadge,
    Badge,
    TaskTypeBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/page.scss',
  styles: `
    :host {
      display: block;
    }
    .sg-name {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .sg-name .pg-link {
      min-width: 0;
    }
    .sg-lock {
      flex: none;
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
    }
    .sg-other {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      white-space: nowrap;
    }
    .sg-sub {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      line-height: 14px;
    }
    td.sg-ref {
      width: 1%;
      white-space: nowrap;
    }
    td.sg-due,
    td.sg-size {
      white-space: nowrap;
    }
    .sg-over {
      color: var(--mf-due-overdue);
      font-weight: 700;
    }
    mark {
      background: transparent;
      color: inherit;
      font-weight: 700;
      text-decoration: underline;
    }
  `,
  template: `
    @if (phone()) {
      <mf-record-card-list
        noun="results"
        [label]="label()"
        [emptyText]="emptyText()"
        [state]="state()"
        [empty]="hits().length === 0"
        [filtered]="filtered()"
        (retry)="retry.emit()"
        (clear)="clear.emit()"
      >
        <ng-template [mfRecordCard]="hits()" let-hit>
          <mf-search-hit-card [hit]="hit" />
        </ng-template>
      </mf-record-card-list>
    } @else {
      <div class="mf-scroll">
        <table class="pg-table" data-hit-table [attr.data-type]="type()">
          <caption class="pg-sr">
            {{
              label()
            }}
          </caption>
          <thead>
            <tr>
              @for (col of columns(); track col.kind) {
                <th scope="col">{{ col.heading }}</th>
              }
            </tr>
          </thead>
          <tbody
            mfGridBody
            noun="results"
            [emptyText]="emptyText()"
            [state]="state()"
            [empty]="hits().length === 0"
            [filtered]="filtered()"
            [columns]="columns().length"
            [skeleton]="bones()"
            (retry)="retry.emit()"
            (clear)="clear.emit()"
          >
            @for (hit of hits(); track hit.type + hit.id) {
              <tr data-hit-row [attr.title]="hit.type === 'asset' ? hit.reference : null">
                @for (col of columns(); track col.kind) {
                  @switch (col.kind) {
                    @case ('ref') {
                      <td class="pg-mono sg-ref" [attr.data-cell]="col.kind">
                        {{ hit.reference ?? '' }}
                      </td>
                    }
                    @case ('name') {
                      <td [attr.data-cell]="col.kind">
                        <span class="sg-name">
                          <!-- A task result remembers this view (T9, #324): its Back link and crumb return here and focus this link. -->
                          <a
                            class="pg-link pg-name"
                            [routerLink]="hit.path"
                            [queryParams]="hit.type === 'task' ? origin.params('search') : null"
                            [state]="hit.type === 'task' ? origin.state() : undefined"
                            mfRowLink="search"
                            [rowKey]="rowKey(hit)"
                            [attr.title]="hit.label"
                          >
                            @for (part of parts(hit.label); track $index) {
                              @if (part.match) {
                                <mark>{{ part.text }}</mark>
                              } @else {
                                <span>{{ part.text }}</span>
                              }
                            }
                          </a>
                          @if (hit.type === 'matter' && hit.isSensitive) {
                            <mf-sensitive-badge />
                          } @else if (hit.isSensitive) {
                            <i
                              class="pi pi-lock sg-lock"
                              role="img"
                              aria-label="Sensitive matter"
                              data-sensitive-marker
                            ></i>
                          }
                          @if (hit.inMyMatters === false) {
                            <span class="sg-other" data-other-matter
                              ><span class="mf-sr-only">, </span>Other matter</span
                            >
                          }
                        </span>
                      </td>
                    }
                    @case ('client') {
                      <td [attr.data-cell]="col.kind">
                        <span class="pg-clip" [attr.title]="hit.secondary">{{
                          hit.secondary ?? ''
                        }}</span>
                      </td>
                    }
                    @case ('assetType') {
                      <td [attr.data-cell]="col.kind">
                        <span class="pg-clip" [attr.title]="hit.secondary">{{
                          hit.secondary ?? ''
                        }}</span>
                      </td>
                    }
                    @case ('matter') {
                      <td [attr.data-cell]="col.kind">
                        @if (hit.matterRef) {
                          <mf-matter-ref [value]="hit.matterRef" [rowStop]="true" />
                          @if (hit.matterName) {
                            <span class="sg-sub" [attr.title]="hit.matterName">{{
                              hit.matterName
                            }}</span>
                          }
                        }
                      </td>
                    }
                    @case ('matterNumber') {
                      <td [attr.data-cell]="col.kind">
                        @if (hit.matterRef) {
                          <mf-matter-ref [value]="hit.matterRef" [rowStop]="true" />
                        }
                      </td>
                    }
                    @case ('taskType') {
                      <td [attr.data-cell]="col.kind">
                        @if (hit.taskTypeName) {
                          <mf-task-type-badge
                            [name]="hit.taskTypeName"
                            [iconKey]="hit.taskTypeIconKey"
                            [colourKey]="hit.taskTypeColourKey"
                          />
                        }
                      </td>
                    }
                    @case ('due') {
                      <td class="sg-due" [attr.data-cell]="col.kind">
                        @if (dueText(hit); as due) {
                          <span [class.sg-over]="isOverdue(due)">{{ due }}</span>
                        }
                      </td>
                    }
                    @case ('size') {
                      <td class="sg-size" [attr.data-cell]="col.kind">
                        @if (sizeText(hit); as size) {
                          {{ size }}
                        } @else {
                          <span class="pg-muted" aria-hidden="true">&ndash;</span>
                          <span class="mf-sr-only">No size</span>
                        }
                      </td>
                    }
                    @case ('disposition') {
                      <td [attr.data-cell]="col.kind">
                        @if (hit.disposition; as code) {
                          <mf-badge
                            [tone]="dispositionOf(code).tone"
                            [icon]="dispositionOf(code).icon"
                            >{{ dispositionOf(code).label }}</mf-badge
                          >
                        } @else {
                          <mf-active-badge [active]="hit.isActive" />
                        }
                      </td>
                    }
                    @case ('status') {
                      <td [attr.data-cell]="col.kind">
                        @if (hit.status) {
                          <mf-status-badge [code]="hit.status" />
                        } @else {
                          <mf-active-badge [active]="hit.isActive" />
                        }
                      </td>
                    }
                  }
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class SearchGrid {
  protected readonly origin = inject(TaskOriginLinks);
  protected readonly phone = phoneCards();

  /** The type of every hit in the grid (`mixed` only for the skeleton of the All tab). */
  readonly type = input.required<SearchType | 'mixed'>();
  /** Accessible name of the table / the card list ("Tasks"). */
  readonly label = input.required<string>();
  readonly hits = input<readonly SearchHit[]>([]);
  readonly state = input<LoadState>('ready');
  /** The text to highlight in names. */
  readonly query = input('');
  readonly emptyText = input('No results.');
  /** A filter limits the hits: the empty text then offers Clear filters. */
  readonly filtered = input(false);
  readonly retry = output<void>();
  readonly clear = output<void>();

  protected readonly columns = computed(() => SEARCH_COLUMNS[this.type()]);
  protected readonly bones = computed(() => this.columns().map((c) => c.bone));

  protected readonly rowKey = hitRowKey;
  protected readonly dispositionOf = dispositionOf;
  protected readonly isOverdue = hitIsOverdue;
  protected readonly sizeText = hitSizeText;
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected dueText(hit: SearchHit): string {
    return hitDueText(hit, this.clock.now(), this.zone);
  }

  protected parts(text: string) {
    return highlightParts(text, this.query());
  }
}
