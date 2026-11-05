import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  AssetDataMatterRow,
  MatterManagerItem,
  MatterManagersClient,
  MatterResponse,
  MattersClient,
  MyMattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { matterColumnDefs } from '../../../shared/filters/common-defs';
import { FilterDef, FilterOption } from '../../../shared/filters/filter-def';
import { ListToolbar } from '../../../shared/filters/list-toolbar';
import { SortedLine, sortLabelsOf } from '../../../shared/ui/sorted-line';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
import { SortHeader } from '../../../shared/ui/data-table';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { GridFrame } from '../../../shared/ui/grid-frame';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';
import { RecordSort } from '../../../shared/ui/record-sort';
import { SortOption } from '../../../shared/work-queue/phone-sort';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PageHeader } from '../../../shared/ui/page-header';
import { AddCommentDialog } from '../../../shared/matter-actions/add-comment-dialog';
import { matterActionMenu } from '../../../shared/matter-actions/matter-actions';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { PageScope } from '../../../shared/scope/page-scope';
import { scopeLine } from '../../../shared/scope/scope-line';
import { ScopeSwitch } from '../../../shared/scope/scope-switch';
import { CopyButton } from '../../../shared/ui/copy-button';
import { Pager } from '../../../shared/ui/pager';
import { TaskCount } from '../../../shared/ui/task-count';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { ResizableColumns } from '../../../shared/ui/resizable-columns';
import { ZeroDash } from '../../../shared/ui/zero-dash';
import { MatterManagersDialog, ManagerTarget } from '../ui/matter-managers-dialog';
import { MatterFormDialog } from '../ui/matter-form-dialog';
import { GridColumns } from '../../../shared/ui/grid-columns';
import {
  GridColumnDef,
  GridPrefs,
  clearGridPrefs,
  gridPrefsKey,
  loadGridPrefs,
  moveBefore,
  saveGridPrefs,
  shownKeys,
} from '../../../shared/ui/grid-prefs';
import { ColumnMove, ReorderColumns } from '../../../shared/ui/reorder-columns';

/** The optional columns of the Matters list (PM v2, #881): not shown until added in the Columns menu. */
type MatterExtraColumn = 'onHold' | 'atRisk' | 'dataSize' | 'pending';
interface MatterExtraColumnChoice {
  readonly key: MatterExtraColumn;
  readonly label: string;
}
const EXTRA_KEYS: readonly string[] = ['onHold', 'atRisk', 'dataSize', 'pending'];
import { assetsParams, sizeText } from '../../my-matters/data-model';
import { IntPipe } from '../../../shared/ui/number-format';

/** The "None" choice of a project manager filter (the matters with nobody in that place); the API argument is `hasPrimaryManager=false`. */
const NO_MANAGER = 'none';

/** Bone widths of a skeleton row, per column key. */
const BONES: Record<string, string> = {
  matterRef: '7rem',
  name: '16rem',
  select: '1.5rem',
  client: '14rem',
  primaryManager: '9rem',
  secondaryManager: '9rem',
  openTasks: '3rem',
  overdue: '3rem',
  onHold: '3rem',
  atRisk: '3rem',
  dataSize: '5rem',
  pending: '3rem',
  status: '5rem',
  actions: '2rem',
};

/**
 * Matters list (UX S06): Reference (plain text with a copy button), Name (the one link), Client (a link; from 900 px), the Primary project
 * manager (and from 1100 px the Secondary; an empty cell stays empty, a matter without a manager is normal), Open tasks and Overdue
 * (counts that open the Task Queue; left out without Task.View), Status. Inline column filters (CM Number, Name, Client, Status with Active by default, and Sensitive beside it),
 * open by default from 640 px; a link from a Client keeps `?clientId=` as a removable chip. State lives in the URL.
 */
@Component({
  selector: 'mf-matters-list-page',
  imports: [
    IntPipe,
    ZeroDash,
    FixedPage,
    GridFrame,
    NgTemplateOutlet,
    PageHeader,
    ActiveBadge,
    SensitiveBadge,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    MatterRef,
    SortHeader,
    GridBody,
    ListToolbar,
    SortedLine,
    ColumnFilterRow,
    TaskCount,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    CopyButton,
    RowLink,
    ResizableColumns,
    ReorderColumns,
    GridColumns,
    MatterManagersDialog,
    MatterFormDialog,
    ScopeSwitch,
    ActionMenu,
    AddCommentDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .ml-mine[aria-pressed='true'] {
      border-color: var(--mf-primary);
      background: var(--mf-selected-bg);
    }
    .ml-selbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-selected-bg);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }
    .ml-selcol {
      width: 2.25rem;
    }
    .ml-pm {
      overflow-wrap: anywhere;
    }
    /* Name and Client are the springs of the table (PM v2, #881): a floor of their own, so the fixed columns and the filter row never squeeze them to "Demo Emp...". */
    /* The CM Number keeps the room of its value and copy button. */
    .pg-table td.ml-ref {
      min-width: 8.5rem;
    }
    .pg-table td.ml-name {
      width: 36%;
      min-width: 12rem;
    }
    .pg-table td.ml-client {
      width: 22%;
      min-width: 9rem;
    }
    .ml-namecell mf-sensitive-badge {
      flex: none;
    }
    .ml-fact {
      white-space: nowrap;
    }
    .ml-muted {
      color: var(--mf-text-muted);
    }
    .ml-fact a {
      color: var(--mf-link);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .ml-actions {
      width: 3.25rem;
      text-align: right;
    }
  `,
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Matters" [count]="state() === 'ready' ? total() : null">
        @if (scopeText()) {
          <span mfDescription class="sl-line" data-scope-line>{{ scopeText() }}</span>
        }
        <mf-scope-switch
          mfActions
          [scope]="scope.value()"
          [canAll]="scope.canAll()"
          (scopeChange)="scope.set($event)"
        />
        <p-button
          mfActions
          *mfHasPermission="'Matter.Create'"
          label="New Matter"
          icon="pi pi-plus"
          (onClick)="openNew()"
        />
      </mf-page-header>

      <mf-list-toolbar
        [filters]="filters"
        controls="matter-filter-row"
        searchLabel="Search matters"
        [clearAlso]="['q']"
        [bulkActive]="!phone() && selecting()"
      >
        @if (!phone()) {
          <mf-grid-columns
            mfColumns
            [defs]="gridDefs()"
            [prefs]="prefs()"
            (prefsChange)="setPrefs($event)"
            (resetColumns)="resetPrefs()"
          />
        }
        @if (canAssign() && !phone()) {
          <button
            mfColumns
            type="button"
            class="mf-btn ml-mine"
            [attr.aria-pressed]="selecting()"
            data-select-mode
            (click)="selecting() ? endSelecting() : selecting.set(true)"
          >
            <i class="pi pi-check-square" aria-hidden="true"></i>
            Select
          </button>
        }
        <mf-sorted-line
          mfBarEnd
          [sort]="sort()"
          [defaultSort]="defaultSort"
          [labels]="sortLabels()"
          (resetSort)="pickSort(null)"
        />
        <div
          mfBulk
          class="ml-selbar"
          role="region"
          aria-label="Selected matters"
          data-selection-bar
        >
          <span data-selection-count>{{ selected().size }} selected</span>
          <button
            type="button"
            class="mf-btn"
            data-bulk-managers
            [disabled]="selected().size === 0"
            (click)="bulkOpen.set(true)"
          >
            Set PMs
          </button>
          <button type="button" class="mf-btn mf-btn--text" (click)="selected.set(emptySelection)">
            Clear Selection
          </button>
          <button
            type="button"
            class="mf-btn mf-btn--text"
            data-selection-done
            (click)="endSelecting()"
          >
            Done
          </button>
        </div>
        <mf-record-sort
          mfSheetSort
          [options]="sortOptions()"
          [sort]="sort()"
          defaultSort="matterRef"
          (sorted)="pickSort($event)"
        />
      </mf-list-toolbar>

      <div class="mf-fill">
        @if (phone()) {
          <mf-record-card-list
            noun="matters"
            label="Matters"
            [state]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            (retry)="load()"
            (clear)="clear()"
            [emptyText]="emptyText()"
            [hidden]="hiddenCount()"
            hiddenLabel="inactive"
            (showAll)="showAll()"
          >
            @if (scope.mine() && scope.canAll()) {
              <button
                mfEmptyAction
                type="button"
                class="mf-btn"
                data-show-all-matters
                (click)="scope.set('all')"
              >
                Show All Matters
              </button>
            }
            <p-button
              mfEmptyAction
              *mfHasPermission="'Matter.Create'"
              label="New Matter"
              (onClick)="openNew()"
            />
            <ng-template [mfRecordCard]="rows()" let-m>
              <mf-record-card
                [name]="m.name"
                [link]="['/matters', m.matterId]"
                list="matters"
                [rowKey]="m.matterId"
              >
                <mf-active-badge mfCardBadges [active]="m.isActive" />
                @if (m.isSensitive) {
                  <mf-sensitive-badge mfCardBadges />
                }
                <mf-copy-button
                  mfCardAside
                  [text]="m.matterRef"
                  label="matter number"
                  [rowStop]="true"
                />
                @if (hasActions()) {
                  <mf-action-menu
                    mfCardAside
                    [floating]="true"
                    [label]="menus().get(m.matterId)!.label"
                    [items]="menus().get(m.matterId)!.items"
                  />
                }
                <p mfCardMeta class="rc-line" data-card-meta>
                  <span class="rc-ref">{{ m.matterRef }}</span>
                  <span class="rc-sep" aria-hidden="true">-</span><span class="mf-sr-only">, </span>
                  @if (clientLink()) {
                    <a
                      class="rc-text"
                      data-card-client
                      [routerLink]="['/clients', m.clientId]"
                      [title]="m.clientNumber + ' ' + m.clientName"
                      >{{ m.clientName }}</a
                    >
                  } @else {
                    <span class="rc-text" data-card-client>{{ m.clientName }}</span>
                  }
                </p>
                @if (managersLine(m); as line) {
                  <p mfCardMeta class="rc-line" data-card-managers>
                    <span class="rc-text" [attr.title]="line">{{ line }}</span>
                  </p>
                }
                @if (counts()) {
                  <mf-task-count
                    mfCardCounts
                    kind="open"
                    scope="matter"
                    [word]="true"
                    [recordId]="m.matterId"
                    [name]="m.name"
                    [count]="m.openTaskCount ?? 0"
                  />
                }
                @if (counts() && (m.overdueTaskCount ?? 0) > 0) {
                  <mf-task-count
                    mfCardCounts
                    kind="overdue"
                    scope="matter"
                    [word]="true"
                    [recordId]="m.matterId"
                    [name]="m.name"
                    [count]="m.overdueTaskCount ?? 0"
                  />
                }
              </mf-record-card>
            </ng-template>
          </mf-record-card-list>
        } @else {
          <mf-grid-frame scrollLabel="Matters list" #scroll>
            <div class="mf-scroll">
              <table
                class="pg-table tt"
                mfResizable="matters"
                mfReorder
                (columnMove)="onColumnMove($event)"
              >
                <caption class="pg-sr">
                  Matters
                </caption>
                <thead>
                  <tr>
                    @if (selecting()) {
                      <th scope="col" class="ml-selcol" data-no-resize data-no-reorder>
                        <input
                          type="checkbox"
                          aria-label="Select all matters on this page"
                          data-select-all
                          [checked]="allSelected()"
                          [indeterminate]="selected().size > 0 && !allSelected()"
                          (change)="toggleAll($any($event.target).checked)"
                        />
                      </th>
                    }
                    @for (key of dataColumns(); track key) {
                      @switch (key) {
                        @case ('matterRef') {
                          <th
                            data-col="matterRef"
                            mfSort="matterRef"
                            [sort]="sort()"
                            [defaultSort]="defaultSort"
                            (sorted)="setSort($event)"
                          >
                            CM Number
                          </th>
                        }
                        @case ('name') {
                          <th
                            data-col="name"
                            mfSort="name"
                            [sort]="sort()"
                            [defaultSort]="defaultSort"
                            (sorted)="setSort($event)"
                          >
                            Name
                          </th>
                        }
                        @case ('client') {
                          <th
                            data-col="client"
                            mfSort="clientNumber"
                            [sort]="sort()"
                            [defaultSort]="defaultSort"
                            (sorted)="setSort($event)"
                          >
                            Client
                          </th>
                        }
                        @case ('primaryManager') {
                          <th
                            data-col="primaryManager"
                            mfSort="primaryManager"
                            [sort]="sort()"
                            [defaultSort]="defaultSort"
                            (sorted)="setSort($event)"
                          >
                            Primary PM
                          </th>
                        }
                        @case ('secondaryManager') {
                          <th
                            data-col="secondaryManager"
                            mfSort="secondaryManager"
                            [sort]="sort()"
                            [defaultSort]="defaultSort"
                            (sorted)="setSort($event)"
                          >
                            Secondary PM
                          </th>
                        }
                        @case ('openTasks') {
                          <th
                            data-col="openTasks"
                            class="pg-num"
                            mfSort="openTasks"
                            [firstDesc]="true"
                            [sort]="sort()"
                            [defaultSort]="defaultSort"
                            (sorted)="setSort($event)"
                          >
                            Open Tasks
                          </th>
                        }
                        @case ('overdue') {
                          <th
                            data-col="overdue"
                            class="pg-num"
                            mfSort="overdue"
                            [firstDesc]="true"
                            [sort]="sort()"
                            [defaultSort]="defaultSort"
                            (sorted)="setSort($event)"
                          >
                            Overdue
                          </th>
                        }
                        @case ('onHold') {
                          <th scope="col" class="pg-num" data-col="onHold" data-col-head="onHold">
                            On Hold
                          </th>
                        }
                        @case ('atRisk') {
                          <th scope="col" class="pg-num" data-col="atRisk" data-col-head="atRisk">
                            At Risk
                          </th>
                        }
                        @case ('dataSize') {
                          <th
                            scope="col"
                            class="pg-num"
                            data-col="dataSize"
                            data-col-head="dataSize"
                          >
                            Data Size
                          </th>
                        }
                        @case ('pending') {
                          <th scope="col" class="pg-num" data-col="pending" data-col-head="pending">
                            Pending Disposition
                          </th>
                        }
                        @case ('status') {
                          <th scope="col" data-col="status">Status</th>
                        }
                      }
                    }
                    @if (tableActions()) {
                      <th scope="col" class="ml-actions" data-no-resize data-no-reorder>
                        <span class="pg-sr">Actions</span>
                      </th>
                    }
                  </tr>
                  @if (filters.rowVisible()) {
                    <tr
                      mfColumnFilterRow
                      id="matter-filter-row"
                      [filters]="filters"
                      [columns]="columns()"
                    ></tr>
                  }
                </thead>
                <tbody
                  mfGridBody
                  noun="matters"
                  [state]="state()"
                  [empty]="rows().length === 0"
                  [filtered]="filters.activeCount() > 0"
                  [columns]="columns().length"
                  [skeleton]="skeleton()"
                  [emptyText]="emptyText()"
                  (retry)="load()"
                  (clear)="clear()"
                  [hidden]="hiddenCount()"
                  hiddenLabel="inactive"
                  (showAll)="showAll()"
                >
                  @if (scope.mine() && scope.canAll()) {
                    <button
                      mfEmptyAction
                      type="button"
                      class="mf-btn"
                      data-show-all-matters
                      (click)="scope.set('all')"
                    >
                      Show All Matters
                    </button>
                  }
                  <p-button
                    mfEmptyAction
                    *mfHasPermission="'Matter.Create'"
                    label="New Matter"
                    (onClick)="openNew()"
                  />
                  @for (m of rows(); track m.matterId) {
                    <tr>
                      @if (selecting()) {
                        <td class="ml-selcol">
                          <input
                            type="checkbox"
                            [attr.aria-label]="'Select ' + m.matterRef + ' ' + m.name"
                            data-select-row
                            [checked]="selected().has(m.matterId)"
                            (change)="toggleRow(m.matterId, $any($event.target).checked)"
                          />
                        </td>
                      }
                      @for (key of dataColumns(); track key) {
                        @switch (key) {
                          @case ('matterRef') {
                            <td class="ml-ref">
                              <mf-matter-ref [value]="m.matterRef" [rowStop]="true" />
                            </td>
                          }
                          @case ('name') {
                            <td class="ml-name">
                              <div class="pg-namecell ml-namecell">
                                <a
                                  class="pg-link pg-name"
                                  [routerLink]="['/matters', m.matterId]"
                                  mfRowLink="matters"
                                  [rowKey]="m.matterId"
                                  [title]="m.name"
                                  >{{ m.name }}</a
                                >
                                @if (m.isSensitive) {
                                  <mf-sensitive-badge [compact]="true" />
                                }
                              </div>
                            </td>
                          }
                          @case ('client') {
                            <td class="ml-client">
                              @if (clientLink()) {
                                <a
                                  class="pg-link pg-name"
                                  [routerLink]="['/clients', m.clientId]"
                                  [title]="m.clientNumber + ' ' + m.clientName"
                                  ><span class="pg-mono">{{ m.clientNumber }}</span>
                                  {{ m.clientName }}</a
                                >
                              } @else {
                                <span class="pg-name" [title]="m.clientNumber + ' ' + m.clientName"
                                  ><span class="pg-mono">{{ m.clientNumber }}</span>
                                  {{ m.clientName }}</span
                                >
                              }
                            </td>
                          }
                          @case ('primaryManager') {
                            <td class="ml-pm" data-primary-manager>
                              {{ m.primaryManager?.displayName }}
                            </td>
                          }
                          @case ('secondaryManager') {
                            <td class="ml-pm" data-secondary-manager>
                              {{ m.secondaryManager?.displayName }}
                            </td>
                          }
                          @case ('openTasks') {
                            <td class="pg-num">
                              <mf-task-count
                                kind="open"
                                scope="matter"
                                [recordId]="m.matterId"
                                [name]="m.name"
                                [count]="m.openTaskCount ?? 0"
                              />
                            </td>
                          }
                          @case ('overdue') {
                            <td class="pg-num">
                              <mf-task-count
                                kind="overdue"
                                scope="matter"
                                [recordId]="m.matterId"
                                [name]="m.name"
                                [count]="m.overdueTaskCount ?? 0"
                              />
                            </td>
                          }
                          @case ('onHold') {
                            <td class="pg-num ml-fact" data-cell="onHold">
                              @if ((m.onHoldTaskCount ?? 0) > 0) {
                                <a
                                  routerLink="/tasks"
                                  [queryParams]="{ matter: m.matterId, status: ['ON_HOLD'] }"
                                  [attr.aria-label]="m.onHoldTaskCount + ' on hold in ' + m.name"
                                  >{{ m.onHoldTaskCount | mfInt }}</a
                                >
                              } @else {
                                <mf-zero-dash />
                              }
                            </td>
                          }
                          @case ('atRisk') {
                            <td class="pg-num ml-fact" data-cell="atRisk">
                              @if ((m.atRiskTaskCount ?? 0) > 0) {
                                <a
                                  routerLink="/tasks"
                                  [queryParams]="{
                                    matter: m.matterId,
                                    status: ['NEW', 'IN_PROGRESS'],
                                    atRisk: 'true',
                                  }"
                                  [attr.aria-label]="m.atRiskTaskCount + ' at risk in ' + m.name"
                                  >{{ m.atRiskTaskCount | mfInt }}</a
                                >
                              } @else {
                                <mf-zero-dash />
                              }
                            </td>
                          }
                          @case ('dataSize') {
                            <td class="pg-num ml-fact" data-cell="dataSize">
                              {{ dataSize(m.matterId) }}
                            </td>
                          }
                          @case ('pending') {
                            <td class="pg-num ml-fact" data-cell="pending">
                              @if (dataRow(m.matterId); as d) {
                                @if (d.counts.pendingDisposition > 0) {
                                  <a
                                    routerLink="/assets"
                                    [queryParams]="pendingParams(d)"
                                    [attr.aria-label]="
                                      d.counts.pendingDisposition +
                                      ' pending disposition in ' +
                                      m.name
                                    "
                                    >{{ d.counts.pendingDisposition }}</a
                                  >
                                } @else {
                                  <span class="ml-muted" aria-label="0 pending disposition">0</span>
                                }
                              } @else {
                                <span class="ml-muted" [attr.title]="dataNote()">{{
                                  dataReady() ? '0' : '–'
                                }}</span>
                              }
                            </td>
                          }
                          @case ('status') {
                            <td>
                              <mf-active-badge [active]="m.isActive" />
                            </td>
                          }
                        }
                      }
                      @if (tableActions()) {
                        <td class="ml-actions" data-row-actions>
                          <mf-action-menu
                            [floating]="true"
                            [label]="menus().get(m.matterId)!.label"
                            [items]="menus().get(m.matterId)!.items"
                          />
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div frameFoot>
              <ng-container *ngTemplateOutlet="pager" />
            </div>
          </mf-grid-frame>
        }
        @if (phone()) {
          <ng-container *ngTemplateOutlet="pager" />
        }
        <ng-template #pager>
          @if (state() === 'ready' && total() > 0) {
            <mf-pager
              [page]="pageNumber()"
              [pageSize]="pageSize()"
              [pageSizes]="pageSizes"
              [total]="total()"
              [hidden]="hiddenCount()"
              hiddenLabel="inactive"
              (showAll)="showAll()"
              (pageChange)="goToPage($event)"
              (pageSizeChange)="setPageSize($event)"
            />
          }
        </ng-template>
      </div>
      @if (commentRow(); as row) {
        <mf-add-comment-dialog
          [matterId]="row.matterId"
          [matterLabel]="row.matterRef + ' ' + row.name"
          [(visible)]="commentOpen"
        />
      }
      @if (canCreate() && createUsed()) {
        <mf-matter-form-dialog
          [clientId]="createClient()"
          [(visible)]="createOpen"
          (saved)="created($event)"
        />
      }
      @if (canAssign()) {
        <mf-matter-managers-dialog
          [targets]="bulkTargets()"
          [(visible)]="bulkOpen"
          (saved)="bulkSaved()"
        />
      }
    </mf-fixed-page>
  `,
})
export class MattersListPage extends ServerListPage<MatterResponse> {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(MattersClient);
  private readonly scroll = viewChild('scroll', { read: ElementRef });

  private readonly auth = inject(AuthStore);
  private readonly managersApi = inject(MatterManagersClient);
  /** The Data API client is asked for only when a Data size or Pending disposition column is shown, so it is looked up then, not at construction. */
  private readonly injector = inject(Injector);
  private readonly quiet = inject(QuietRequests);

  /**
   * The optional columns (PM v2, #881): On hold and At risk need Task.View, Data size and Pending disposition need Asset.View. The default set shows none;
   * the choice is remembered in this browser.
   */
  protected readonly extraChoices = computed((): MatterExtraColumnChoice[] => [
    ...(this.counts()
      ? [
          { key: 'onHold' as const, label: 'On Hold' },
          { key: 'atRisk' as const, label: 'At Risk' },
        ]
      : []),
    // The numbers come from the Data API, which is for people who manage matters and may see tasks and assets (My Matters' own rule).
    ...(this.canData()
      ? [
          { key: 'dataSize' as const, label: 'Data Size' },
          { key: 'pending' as const, label: 'Pending Disposition' },
        ]
      : []),
  ]);
  private readonly canData = computed(
    () =>
      this.auth.has('Asset.View') &&
      this.auth.has('Task.View') &&
      (this.auth.has('Matter.BeManager') || this.auth.has('Matter.AssignManagers')),
  );
  /** The columns shown now, in the person's order: the Columns menu choice, then the width rules (a narrow window drops Client and the PMs, a phone has cards). */
  protected readonly dataColumns = computed((): string[] => {
    const narrow = new Set<string>([
      ...(this.showClient() ? [] : ['client']),
      ...(this.showPrimary() ? [] : ['primaryManager']),
      ...(this.showSecondary() ? [] : ['secondaryManager']),
    ]);
    return shownKeys(this.gridDefs(), this.prefs()).filter(
      (k) => !narrow.has(k) && !(this.phone() && EXTRA_KEYS.includes(k)),
    );
  });
  private readonly shownExtras = computed(() =>
    this.dataColumns().filter((k): k is MatterExtraColumn => EXTRA_KEYS.includes(k)),
  );
  /** The columns this person may have, in the default order; the Columns menu, the order and the visibility all start from it (MD-28). */
  protected readonly gridDefs = computed((): GridColumnDef[] => {
    const extra = new Map(this.extraChoices().map((c) => [c.key as string, c.label]));
    return [
      { key: 'matterRef', label: 'CM Number', locked: true },
      { key: 'name', label: 'Name', locked: true },
      { key: 'client', label: 'Client' },
      { key: 'primaryManager', label: 'Primary PM' },
      { key: 'secondaryManager', label: 'Secondary PM' },
      ...(this.counts()
        ? [
            { key: 'openTasks', label: 'Open Tasks' },
            { key: 'overdue', label: 'Overdue' },
          ]
        : []),
      ...EXTRA_KEYS.filter((k) => extra.has(k)).map((k) => ({
        key: k,
        label: extra.get(k)!,
        defaultHidden: true,
      })),
      { key: 'status', label: 'Status' },
    ];
  });
  private readonly prefsKey = computed(() => gridPrefsKey('matters', this.auth.profile()?.userId));
  protected readonly prefs = signal<GridPrefs>(
    loadGridPrefs(gridPrefsKey('matters', this.auth.profile()?.userId)),
  );

  protected setPrefs(next: GridPrefs): void {
    this.prefs.set(next);
    saveGridPrefs(this.prefsKey(), next);
  }

  protected resetPrefs(): void {
    this.prefs.set({ order: [], visible: null });
    clearGridPrefs(this.prefsKey());
  }

  /** A header was dragged to a new place. */
  protected onColumnMove(move: ColumnMove): void {
    const defs = this.gridDefs();
    const prefs = this.prefs();
    // The drop target may be a column that is hidden by width: the visible neighbour in the order is what the person pointed at.
    this.setPrefs({
      order: moveBefore(defs, prefs, move.key, move.beforeKey),
      visible: prefs.visible,
    });
  }
  /** The Data API's rows by matter (the sizes and pending counts of the page; loaded only while one of the two columns is shown). */
  private readonly dataRows = signal<ReadonlyMap<number, AssetDataMatterRow>>(new Map());
  protected readonly dataReady = signal(false);
  private dataScope: 'mine' | 'all' = 'mine';

  /** The people who can be named a project manager (the filter's choices); empty until loaded, and when the lookup fails. */
  private readonly managers = signal<readonly MatterManagerItem[]>([]);
  protected readonly emptySelection: ReadonlySet<number> = new Set<number>();
  /** The matters ticked for the bulk "Set project managers" (only offered with Matter.AssignManagers). */
  protected readonly selected = signal<ReadonlySet<number>>(this.emptySelection);
  protected readonly bulkOpen = signal(false);
  protected readonly canAssign = computed(() => this.auth.has('Matter.AssignManagers'));
  /** Selection mode: the tick column is there only after "Select", so the grid keeps its normal columns for everybody else. */
  protected readonly selecting = signal(
    // My Matters' "Set project managers" link (#701) opens the list already in selection mode (router state, never the address).
    this.canAssign() &&
      typeof history !== 'undefined' &&
      history.state?.['selectManagers'] === true,
  );
  /**
   * "My matters / All" (epic #758): people who can be a project manager open the list on the matters they manage, with a remembered switch.
   * A link with filters of the list (a client's matters, a strip cell) and no `scope` means what it says and is not scoped.
   */
  protected readonly scope = new PageScope(
    'matters',
    () => !this.filters.isDeepLink(),
    () => false,
    ['mine'],
  );
  /** `?mine=true`, the older link-only form of the same filter (a removable chip). */
  protected readonly mine = computed(() => this.filters.text('mine') === 'true');
  /** "Matters you manage (14 of 212)" / "212 matters". */
  protected readonly scopeText = computed(() =>
    scopeLine({
      scope: this.scope.value(),
      noun: 'matters',
      phrase: 'Matters you manage',
      shown: this.state() === 'ready' ? this.total() : null,
      all: this.unscopedTotal(),
    }),
  );
  protected readonly emptyText = computed(() =>
    this.scope.mine() ? 'You do not manage any matter yet.' : '',
  );
  protected dataRow(matterId: number): AssetDataMatterRow | undefined {
    return this.dataRows().get(matterId);
  }

  /** "640 GB", "No assets" (a matter the data covers but that holds none), or an en dash when the figure is not known to this view. */
  protected dataSize(matterId: number): string {
    const row = this.dataRows().get(matterId);
    if (row) return sizeText(row.counts.size) || '–';
    return '–';
  }

  protected dataNote(): string {
    return this.dataReady()
      ? 'No assets recorded for this matter in this view.'
      : 'Not available for this matter in this view.';
  }

  protected pendingParams(row: AssetDataMatterRow) {
    return assetsParams(row.query, this.dataScope, 'pending');
  }

  protected readonly showPrimary = computed(() => true);
  protected readonly showSecondary = computed(() => true);
  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.rows().every((m) => this.selected().has(m.matterId)),
  );
  protected readonly bulkTargets = computed<ManagerTarget[]>(() =>
    this.rows()
      .filter((m) => this.selected().has(m.matterId))
      .map((m) => ({
        matterId: m.matterId,
        label: `${m.matterRef} ${m.name}`,
        rowVersion: m.rowVersion,
        primary: m.primaryManager ?? null,
        secondary: m.secondaryManager ?? null,
      })),
  );

  /** The quick actions of a row (epic #758, PX-25): the menu exists for people who can see tasks (Open the matter's tasks is always among them). */
  protected readonly hasActions = computed(() => this.auth.has('Task.View'));
  /** In the table the menu is the last column from 900 px (below that the grid has no room for it); the phone cards always carry it. */
  protected readonly tableActions = computed(() => this.hasActions());
  protected readonly commentRow = signal<MatterResponse | null>(null);
  protected readonly commentOpen = signal(false);
  /** Built once per page of rows, not on every change detection. */
  protected readonly menus = computed(
    () => new Map(this.rows().map((m) => [m.matterId, this.buildMenu(m)] as const)),
  );

  /** Below 640 px the list is cards, not a table (WP12). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, counts only with Task.View (the headers' keys). */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'matterRef', label: 'CM Number' },
    { value: 'name', label: 'Name' },
    { value: 'clientNumber', label: 'Client' },
    { value: 'primaryManager', label: 'Primary PM' },
    ...(this.counts()
      ? [
          { value: 'openTasks', label: 'Open Tasks', descFirst: true },
          { value: 'overdue', label: 'Overdue', descFirst: true },
        ]
      : []),
  ]);

  protected readonly defaultSort = 'matterRef';
  protected readonly sortLabels = computed(() => sortLabelsOf(this.sortOptions()));
  /** Counts are null without Task.View: the two columns are not rendered then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  protected readonly showClient = computed(() => true);
  /** The client's name on a card is a link only with Client.View. */
  protected readonly clientLink = computed(() => this.auth.canLink('client'));
  /** The columns of the grid, in order; the keys the filter definitions point at. */
  protected readonly columns = computed(() => [
    ...(this.selecting() ? ['select'] : []),
    ...this.dataColumns(),
    ...(this.tableActions() ? ['actions'] : []),
  ]);
  protected readonly skeleton = computed(() => this.columns().map((key) => BONES[key]));

  protected readonly clientChip = computed(() => {
    const first = this.rows()[0];
    const id = this.filters.text('clientId');
    return first && String(first.clientId) === id
      ? `${first.clientNumber} ${first.clientName}`
      : `Client ${id}`;
  });

  /** One definition per filter: the row, the sheet, the chips, the count, the URL and the API arguments all come from it. */
  private readonly defs = computed((): FilterDef[] => {
    const [ref, name, status, sensitive] = matterColumnDefs();
    return [
      ref,
      { ...name, search: true },
      { key: 'client', label: 'Client', column: 'client', type: 'text' },
      this.managerDef('primaryManager', 'Primary PM'),
      this.managerDef('secondaryManager', 'Secondary PM'),
      // Quick filter "Mine" (the header button): the matters the viewer manages, as Primary or Secondary. A removable chip, no column.
      {
        key: 'mine',
        label: 'Mine',
        type: 'select',
        noControl: true,
        bareChip: true,
        options: [{ value: 'true', label: 'Mine: Matters I Manage' }],
        normalize: (v: string) => (v === 'true' ? 'true' : null),
      },
      status,
      sensitive,
      // `?managerId=` (a link from My Matters' All matters scope, #701): matters where that person is Primary or Secondary; no control, a removable chip.
      {
        key: 'managerId',
        label: 'PM (Either)',
        type: 'text',
        noControl: true,
        normalize: (v: string) => (/^[1-9]\d*$/.test(v) ? v : null),
        valueLabel: () => this.managerName(this.filters.text('managerId')),
      },
      // `?clientId=` (a link from a client): no control, a removable chip.
      {
        key: 'clientId',
        label: 'Client',
        type: 'text',
        noControl: true,
        valueLabel: (): string => this.clientChip(),
      },
    ];
  });

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'matters',
    noun: 'matters',
    defs: this.defs,
    openByDefault: true,
    sheetBelow: 640,
  });

  /** `?newMatter=1&newClient=5` (the old `/matters/new` link, Client pages): opens the New matter dialog at once, then leaves the URL clean. */
  readonly newMatter = input<string | undefined>(undefined);
  readonly newClient = input<string | undefined>(undefined);
  protected readonly canCreate = computed(() => this.auth.has('Matter.Create'));
  protected readonly createUsed = signal(false);
  protected readonly createOpen = signal(false);
  protected readonly createClient = signal<number | null>(null);

  /** "+ New matter": the pop-up dialog (MD-22), no navigation. */
  protected openNew(client: number | null = null): void {
    this.createClient.set(client);
    this.createUsed.set(true);
    this.createOpen.set(true);
  }

  protected created(m: MatterResponse): void {
    void this.router.navigate(['/matters', m.matterId]);
  }

  constructor() {
    super();
    void this.loadManagers();
    effect(() => {
      if (!this.newMatter()) return;
      const client = Number(this.newClient());
      untracked(() => {
        if (this.canCreate()) this.openNew(Number.isInteger(client) && client > 0 ? client : null);
        void this.router.navigate([], {
          queryParams: { newMatter: null, newClient: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    });
    // A new page of rows never keeps a tick from the old one.
    effect(() => {
      this.rows();
      untracked(() => this.selected.set(this.emptySelection));
    });
    // Data size and Pending disposition come from the Data API (the same numbers as My Matters > Data), asked for only while one of the two columns is shown.
    effect(() => {
      const needed = this.shownExtras().some((k) => k === 'dataSize' || k === 'pending');
      const scope = this.scope.mine() ? 'mine' : this.scope.canAll() ? 'all' : 'mine';
      untracked(() => void this.loadData(needed, scope));
    });
    registerTableSkip({ copyButton: true });
    restoreRowFocus('matters', () => this.state() === 'ready');
    // The controls move into the sheet while the grid scrolls sideways (the grid is not there while the phone shows cards).
    effect(() => {
      this.state();
      const area = this.scroll()?.nativeElement.querySelector(
        '.mf-scroll-area',
      ) as HTMLElement | null;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  private dataTurn = 0;

  private async loadData(needed: boolean, scope: 'mine' | 'all'): Promise<void> {
    const mine = ++this.dataTurn;
    if (!needed) return;
    this.dataScope = scope;
    try {
      const res = await firstValueFrom(
        this.quiet.run(() => this.injector.get(MyMattersClient).getMyMattersData(scope)),
      );
      if (mine !== this.dataTurn) return;
      this.dataRows.set(new Map(res.matters.map((r) => [r.matterId, r])));
      this.dataReady.set(true);
    } catch {
      if (mine !== this.dataTurn) return;
      this.dataRows.set(new Map());
      this.dataReady.set(false);
    }
  }

  /** A project manager column filter: a select of the eligible people with "None" (nobody in that place) after the leading "Any". */
  private managerDef(key: 'primaryManager' | 'secondaryManager', label: string): FilterDef {
    return {
      key,
      label,
      column: key,
      type: 'select',
      allLabel: 'Any',
      options: () => this.managerOptions(key),
      normalize: (v: string) => (v === NO_MANAGER || /^[1-9]\d*$/.test(v) ? v : null),
      valueLabel: (v: string) => (v === NO_MANAGER ? 'None' : this.managerName(v)),
    };
  }

  private managerOptions(key: 'primaryManager' | 'secondaryManager'): FilterOption[] {
    const people = this.managers().map((p) => ({ value: String(p.userId), label: p.displayName }));
    const current = this.filters?.text(key);
    // Somebody named by a link or by the rows on screen who is not in the list (lost the role) stays choosable, so the control shows its value.
    const extra =
      current && current !== NO_MANAGER && !people.some((p) => p.value === current)
        ? [{ value: current, label: this.managerName(current) }]
        : [];
    return [{ value: NO_MANAGER, label: 'None' }, ...people, ...extra];
  }

  private managerName(id: string): string {
    const known = this.managers().find((p) => String(p.userId) === id)?.displayName;
    if (known) return known;
    for (const m of this.rows()) {
      for (const p of [m.primaryManager, m.secondaryManager]) {
        if (p && String(p.userId) === id) return p.displayName;
      }
    }

    return 'Selected person';
  }

  private async loadManagers(): Promise<void> {
    try {
      this.managers.set(
        await firstValueFrom(
          this.quiet.run(() => this.managersApi.lookupMatterManagers(undefined, 50)),
        ),
      );
    } catch {
      // The filter then offers only "Any" and "None".
    }
  }

  /** "PM: Ann / Bob" on a phone card; only what is set, nothing at all for a matter without a manager. */
  protected managersLine(m: MatterResponse): string {
    const names = [m.primaryManager?.displayName, m.secondaryManager?.displayName].filter(
      (n): n is string => !!n,
    );
    return names.length > 0 ? `PM: ${names.join(' / ')}` : '';
  }

  private buildMenu(m: MatterResponse) {
    return matterActionMenu(
      { matterId: m.matterId, matterRef: m.matterRef, name: m.name, isActive: m.isActive },
      (p) => this.auth.has(p),
      {
        newTask: () =>
          void this.router.navigate(['/tasks/new'], { queryParams: { matterId: m.matterId } }),
        bulk: () =>
          void this.router.navigate(['/matters', m.matterId], {
            queryParams: { tab: 'tasks' },
            state: { selectTasks: true },
          }),
        addComment: () => {
          this.commentRow.set(m);
          this.commentOpen.set(true);
        },
        openTasks: () =>
          void this.router.navigate(['/matters', m.matterId], { queryParams: { tab: 'tasks' } }),
      },
    );
  }

  protected endSelecting(): void {
    this.selecting.set(false);
    this.selected.set(this.emptySelection);
  }

  protected toggleRow(id: number, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  protected toggleAll(on: boolean): void {
    this.selected.set(on ? new Set(this.rows().map((m) => m.matterId)) : this.emptySelection);
  }

  /** After the bulk dialog saved some matters: show the new managers (the ticks stay on the matters that could not be changed). */
  protected bulkSaved(): void {
    void this.load();
  }

  protected override fetch() {
    return this.list(
      isActiveParam(parseStatus(this.filters.text('status'))),
      this.pageNumber(),
      this.pageSize(),
    );
  }

  protected override watch(): void {
    super.watch();
    this.scope.value();
  }

  /** The same list without the scope: the "212" of "14 of 212 matters". */
  protected override fetchUnscoped() {
    return this.scope.mine()
      ? this.list(isActiveParam(parseStatus(this.filters.text('status'))), 1, 1, false)
      : null;
  }

  /** The inactive matters the default Active hides, under the same other filters (#271). */
  protected override fetchHidden() {
    return parseStatus(this.filters.text('status')) === 'active' ? this.list(false, 1, 1) : null;
  }

  private list(isActive: boolean | undefined, page: number, size: number, scoped = true) {
    const clientId = Number(this.filters.text('clientId'));
    const sensitive = this.filters.text('isSensitive');
    const primary = this.filters.text('primaryManager');
    const secondary = this.filters.text('secondaryManager');
    return firstValueFrom(
      this.api.listMatters(
        // Search finds the name, the client or the number (the API's `q`, decision of 2026-11-02); the URL parameter stays `name`.
        this.filters.text('name') || undefined,
        Number.isInteger(clientId) && clientId > 0 ? clientId : undefined,
        isActive,
        sensitive === '' ? undefined : sensitive === 'true',
        this.filters.text('matterRef') || undefined,
        undefined,
        this.filters.text('client') || undefined,
        managerId(primary),
        managerId(secondary),
        managerId(this.filters.text('managerId')),
        (scoped && this.scope.mine()) || this.mine() ? true : undefined,
        undefined,
        primary === NO_MANAGER ? false : undefined,
        secondary === NO_MANAGER ? false : undefined,
        page,
        size,
        this.sort() || undefined,
      ),
    );
  }
}

/** The user id a project manager filter names (undefined for "Any" and for "None", which is `hasPrimaryManager=false`). */
function managerId(value: string): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}
