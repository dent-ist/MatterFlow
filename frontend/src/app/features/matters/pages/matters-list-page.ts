import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  MatterManagerItem,
  MatterManagersClient,
  MatterResponse,
  MattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { matterColumnDefs } from '../../../shared/filters/common-defs';
import { FilterDef, FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFiltersButton } from '../../../shared/filters/list-filters-button';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
import { SortHeader } from '../../../shared/ui/data-table';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
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
import { CopyButton } from '../../../shared/ui/copy-button';
import { Pager } from '../../../shared/ui/pager';
import { TaskCount } from '../../../shared/ui/task-count';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { MatterManagersDialog, ManagerTarget } from '../ui/matter-managers-dialog';

/** Below this width the Client column (the least informative one) leaves the table (#266). */
const CLIENT_COLUMN_MIN_PX = 900;
/**
 * Below this width the Secondary project manager column leaves the table (the Primary stays), epic #667. The issue asks for 1100 px; measured
 * at 1366 px (a 1098 px grid next to the menu) the extra column squeezed Name to 121 px and the filter row fell back to the sheet, so the
 * column starts where the grid has room for it. A filter on it still works from any width (it shows as a chip).
 */
const SECONDARY_COLUMN_MIN_PX = 1440;
/** Below this width the Primary project manager column leaves the table as well (the Client column goes at the same width): at 768 px it pushed Status out of the grid. */
const PRIMARY_COLUMN_MIN_PX = 900;
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
  status: '5rem',
};

/**
 * Matters list (UX S06): Reference (plain text with a copy button), Name (the one link), Client (a link; from 900 px), the Primary project
 * manager (and from 1100 px the Secondary; an empty cell stays empty, a matter without a manager is normal), Open tasks and Overdue
 * (counts that open the Task Queue; left out without Task.View), Status. Inline column filters (Matter reference, Name, Client, Status with Active by default, and Sensitive beside it),
 * open by default from 640 px; a link from a Client keeps `?clientId=` as a removable chip. State lives in the URL.
 */
@Component({
  selector: 'mf-matters-list-page',
  imports: [
    FixedPage,
    ScrollArea,
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
    FiltersBar,
    ListFiltersButton,
    ColumnFilterRow,
    TaskCount,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    CopyButton,
    RowLink,
    MatterManagersDialog,
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
  `,
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Matters">
        <mf-list-filters-button
          mfActions
          [filters]="filters"
          controls="matter-filter-row"
          [clearAlso]="['q']"
        />
        @if (canBeManager()) {
          <button
            mfActions
            type="button"
            class="mf-btn ml-mine"
            [attr.aria-pressed]="mine()"
            title="Only matters I manage"
            data-mine
            (click)="toggleMine()"
          >
            <i class="pi pi-user" aria-hidden="true"></i>
            Mine
          </button>
        }
        @if (canAssign() && !phone()) {
          <button
            mfActions
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
        <p-button
          mfActions
          *mfHasPermission="'Matter.Create'"
          label="New matter"
          icon="pi pi-plus"
          (onClick)="go('/matters/new')"
        />
      </mf-page-header>

      <mf-filters-bar [bare]="true" [filters]="filters" [clearAlso]="['q']">
        <mf-record-sort
          mfSheetSort
          [options]="sortOptions()"
          [sort]="sort()"
          defaultSort="matterRef"
          (sorted)="pickSort($event)"
        />
      </mf-filters-bar>

      <div class="mf-fill">
        @if (!phone() && selecting()) {
          <div class="ml-selbar" role="region" aria-label="Selected matters" data-selection-bar>
            <span data-selection-count>{{ selected().size }} selected</span>
            <button
              type="button"
              class="mf-btn"
              data-bulk-managers
              [disabled]="selected().size === 0"
              (click)="bulkOpen.set(true)"
            >
              Set project managers
            </button>
            <button
              type="button"
              class="mf-btn mf-btn--text"
              (click)="selected.set(emptySelection)"
            >
              Clear selection
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
        }
        @if (phone()) {
          <mf-record-card-list
            noun="matters"
            label="Matters"
            [state]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            (retry)="load()"
            (clear)="clear()"
            [hidden]="hiddenCount()"
            hiddenLabel="inactive"
            (showAll)="showAll()"
          >
            <p-button
              mfEmptyAction
              *mfHasPermission="'Matter.Create'"
              label="New matter"
              (onClick)="go('/matters/new')"
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
                  <p mfCardMeta class="rc-line" data-card-managers>{{ line }}</p>
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
          <div class="mf-table-wrap" mfScrollArea="Matters list" #scroll>
            <div class="mf-scroll">
              <table class="pg-table">
                <caption class="pg-sr">
                  Matters
                </caption>
                <thead>
                  <tr>
                    @if (selecting()) {
                      <th scope="col" class="ml-selcol">
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
                    <th
                      mfSort="matterRef"
                      [sort]="sort()"
                      [defaultSort]="defaultSort"
                      (sorted)="setSort($event)"
                    >
                      Matter reference
                    </th>
                    <th
                      mfSort="name"
                      [sort]="sort()"
                      [defaultSort]="defaultSort"
                      (sorted)="setSort($event)"
                    >
                      Name
                    </th>
                    @if (showClient()) {
                      <th
                        mfSort="clientNumber"
                        [sort]="sort()"
                        [defaultSort]="defaultSort"
                        (sorted)="setSort($event)"
                      >
                        Client
                      </th>
                    }
                    @if (showPrimary()) {
                      <th
                        mfSort="primaryManager"
                        [sort]="sort()"
                        [defaultSort]="defaultSort"
                        (sorted)="setSort($event)"
                      >
                        Project manager
                      </th>
                    }
                    @if (showSecondary()) {
                      <th
                        mfSort="secondaryManager"
                        [sort]="sort()"
                        [defaultSort]="defaultSort"
                        (sorted)="setSort($event)"
                      >
                        Secondary project manager
                      </th>
                    }
                    @if (counts()) {
                      <th
                        class="pg-num"
                        mfSort="openTasks"
                        [firstDesc]="true"
                        [sort]="sort()"
                        [defaultSort]="defaultSort"
                        (sorted)="setSort($event)"
                      >
                        Open tasks
                      </th>
                      <th
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
                    <th scope="col">Status</th>
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
                  (retry)="load()"
                  (clear)="clear()"
                  [hidden]="hiddenCount()"
                  hiddenLabel="inactive"
                  (showAll)="showAll()"
                >
                  <p-button
                    mfEmptyAction
                    *mfHasPermission="'Matter.Create'"
                    label="New matter"
                    (onClick)="go('/matters/new')"
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
                      <td>
                        <mf-matter-ref [value]="m.matterRef" [rowStop]="true" />
                      </td>
                      <td>
                        <div class="pg-namecell">
                          <a
                            class="pg-link pg-name"
                            [routerLink]="['/matters', m.matterId]"
                            mfRowLink="matters"
                            [rowKey]="m.matterId"
                            [title]="m.name"
                            >{{ m.name }}</a
                          >
                          @if (m.isSensitive) {
                            <mf-sensitive-badge />
                          }
                        </div>
                      </td>
                      @if (showClient()) {
                        <td>
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
                      @if (showPrimary()) {
                        <td class="ml-pm" data-primary-manager>
                          {{ m.primaryManager?.displayName }}
                        </td>
                      }
                      @if (showSecondary()) {
                        <td class="ml-pm" data-secondary-manager>
                          {{ m.secondaryManager?.displayName }}
                        </td>
                      }
                      @if (counts()) {
                        <td class="pg-num">
                          <mf-task-count
                            kind="open"
                            scope="matter"
                            [recordId]="m.matterId"
                            [name]="m.name"
                            [count]="m.openTaskCount ?? 0"
                          />
                        </td>
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
                      <td>
                        <mf-active-badge [active]="m.isActive" />
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
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
      </div>
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
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  private readonly auth = inject(AuthStore);
  private readonly wide = viewportAtLeast(CLIENT_COLUMN_MIN_PX);
  private readonly wideForSecondary = viewportAtLeast(SECONDARY_COLUMN_MIN_PX);
  private readonly wideForPrimary = viewportAtLeast(PRIMARY_COLUMN_MIN_PX);
  private readonly managersApi = inject(MatterManagersClient);
  private readonly quiet = inject(QuietRequests);

  /** The people who can be named a project manager (the filter's choices); empty until loaded, and when the lookup fails. */
  private readonly managers = signal<readonly MatterManagerItem[]>([]);
  protected readonly emptySelection: ReadonlySet<number> = new Set<number>();
  /** The matters ticked for the bulk "Set project managers" (only offered with Matter.AssignManagers). */
  protected readonly selected = signal<ReadonlySet<number>>(this.emptySelection);
  protected readonly bulkOpen = signal(false);
  protected readonly canAssign = computed(() => this.auth.has('Matter.AssignManagers'));
  /** Selection mode: the tick column is there only after "Select", so the grid keeps its normal columns for everybody else. */
  protected readonly selecting = signal(false);
  /** The "Mine" quick filter is for people who can be a project manager. */
  protected readonly canBeManager = computed(() => this.auth.has('Matter.BeManager'));
  protected readonly mine = computed(() => this.filters.text('mine') === 'true');
  protected readonly showPrimary = computed(() => this.wideForPrimary());
  protected readonly showSecondary = computed(() => this.wideForSecondary());
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

  /** Below 640 px the list is cards, not a table (WP12). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, counts only with Task.View (the headers' keys). */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'matterRef', label: 'Reference' },
    { value: 'name', label: 'Name' },
    { value: 'clientNumber', label: 'Client' },
    { value: 'primaryManager', label: 'Project manager' },
    ...(this.counts()
      ? [
          { value: 'openTasks', label: 'Open tasks', descFirst: true },
          { value: 'overdue', label: 'Overdue', descFirst: true },
        ]
      : []),
  ]);

  protected readonly defaultSort = 'matterRef';
  /** Counts are null without Task.View: the two columns are not rendered then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  protected readonly showClient = computed(() => this.wide());
  /** The client's name on a card is a link only with Client.View. */
  protected readonly clientLink = computed(() => this.auth.canLink('client'));
  /** The columns of the grid, in order; the keys the filter definitions point at. */
  protected readonly columns = computed(() => [
    ...(this.selecting() ? ['select'] : []),
    'matterRef',
    'name',
    ...(this.showClient() ? ['client'] : []),
    ...(this.showPrimary() ? ['primaryManager'] : []),
    ...(this.showSecondary() ? ['secondaryManager'] : []),
    ...(this.counts() ? ['openTasks', 'overdue'] : []),
    'status',
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
      name,
      { key: 'client', label: 'Client', column: 'client', type: 'text' },
      this.managerDef('primaryManager', 'Project manager'),
      this.managerDef('secondaryManager', 'Secondary project manager'),
      // Quick filter "Mine" (the header button): the matters the viewer manages, as Primary or Secondary. A removable chip, no column.
      {
        key: 'mine',
        label: 'Mine',
        type: 'select',
        noControl: true,
        bareChip: true,
        options: [{ value: 'true', label: 'Mine: matters I manage' }],
        normalize: (v: string) => (v === 'true' ? 'true' : null),
      },
      status,
      sensitive,
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

  constructor() {
    super();
    void this.loadManagers();
    // A new page of rows never keeps a tick from the old one.
    effect(() => {
      this.rows();
      untracked(() => this.selected.set(this.emptySelection));
    });
    registerTableSkip({ copyButton: true });
    restoreRowFocus('matters', () => this.state() === 'ready');
    // The controls move into the sheet while the grid scrolls sideways (the grid is not there while the phone shows cards).
    effect(() => {
      const area = this.scroll()?.nativeElement;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });
  }

  protected override listFilters() {
    return this.filters;
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

  protected toggleMine(): void {
    this.filters.set('mine', this.mine() ? '' : 'true');
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

  /** The inactive matters the default Active hides, under the same other filters (#271). */
  protected override fetchHidden() {
    return parseStatus(this.filters.text('status')) === 'active' ? this.list(false, 1, 1) : null;
  }

  private list(isActive: boolean | undefined, page: number, size: number) {
    const clientId = Number(this.filters.text('clientId'));
    const sensitive = this.filters.text('isSensitive');
    const primary = this.filters.text('primaryManager');
    const secondary = this.filters.text('secondaryManager');
    return firstValueFrom(
      this.api.listMatters(
        undefined,
        Number.isInteger(clientId) && clientId > 0 ? clientId : undefined,
        isActive,
        sensitive === '' ? undefined : sensitive === 'true',
        this.filters.text('matterRef') || undefined,
        this.filters.text('name') || undefined,
        this.filters.text('client') || undefined,
        managerId(primary),
        managerId(secondary),
        undefined,
        this.mine() ? true : undefined,
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
