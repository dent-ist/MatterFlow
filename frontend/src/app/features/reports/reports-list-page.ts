import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  RecentReportResponse,
  ReportFavouritesClient,
  ReportsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { QuietRequests } from '../../core/http/interceptors';
import { NotificationService } from '../../core/notify/notification.service';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { FilterDef } from '../../shared/filters/filter-def';
import { ListFilters } from '../../shared/filters/list-filters';
import { ListToolbar } from '../../shared/filters/list-toolbar';
import { Dropdown, DropdownItem } from '../../shared/ui/dropdown';
import { FilterChip, FilterChips } from '../../shared/ui/filter-chips';
import { FixedPage } from '../../shared/ui/fixed-page';
import { NumericDatePipe } from '../../shared/ui/numeric-date';
import { PageHeader } from '../../shared/ui/page-header';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
  RecordGroup,
  RecordGroupToggle,
} from '../../shared/ui/record-grid';
import { RowLink, restoreRowFocus } from '../../shared/ui/row-nav';
import { StateBlock } from '../../shared/ui/state-block';
import { Tip } from '../../shared/ui/tip';
import { ReportStarButton } from './report-star-button';
import { LoadState } from '../../shared/ui/data-table';
import {
  FAVOURITES_FAILED,
  RECENT_MAX,
  starAnnouncement,
  withFavourite,
} from './report-favourites';
import { ReportRecentLine } from './report-recent-line';
import { ReportRow, filterReports, flattenReports, parametersText } from './report-rows';

/** The loading rows of the grid: one bone width per column. */
const BONES: Record<string, string> = {
  star: '1rem',
  name: '16rem',
  parameters: '5rem',
  lastRun: '6rem',
};

/** Where the closed categories are remembered (per person, this browser): a convenience only, so every access is guarded. */
const collapsedKey = (userId: number | undefined): string => `mf.reports.collapsed.${userId ?? 0}`;

function readCollapsed(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeCollapsed(key: string, keys: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(keys));
  } catch {
    /* storage can be blocked: the categories then open again next time */
  }
}

/**
 * Reports (issue #718, spec section 2 of `docs/ux/reports-review/ui-spec-user-pages.md`): the reports the person may run, one row each on the shared
 * record grid, grouped by category (`groupBy`, D-44a) in the administrator's order. Columns: Report (the name opens the run page, the description is
 * a muted line under it), Parameters and Last Run (the person's own). Search (name, description, category) and a Category filter work on the loaded
 * list; there is no sort, no Columns chooser, no row menu and no Run button (the row opens the report). Favourites and recent reports (#723, spec section
 * 7): the star is the first column (an icon button, optimistic with a rollback and the toast "Couldn't update favourites."), the Favourites chip in the
 * toolbar filters the grid to the favourites (a filter of the address like the others, not a second group and not part of a saved view), and one line of
 * up to five Recent chips sits above the grid while no search or filter is active. Needs `Report.Run`; the server lists only active reports assigned to
 * one of the person's roles.
 */
@Component({
  selector: 'mf-reports-list-page',
  imports: [
    Button,
    Dropdown,
    FilterChips,
    FixedPage,
    HasPermissionDirective,
    ListToolbar,
    NumericDatePipe,
    PageHeader,
    RecordCell,
    RecordGrid,
    ReportRecentLine,
    RouterLink,
    RowLink,
    StateBlock,
    Tip,
    ReportStarButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/page.scss',
  styles: `
    /* The Report column is the spring; the name is one link, the description one clipped muted line under it. */
    td.rl-report {
      width: 100%;
      max-width: 0;
    }
    .rl-desc {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    /* The star cell is the 44 px column; the button is 32 px in a cell (D-02). Outline star muted at rest, filled star in the amber solid. */
    td.rl-star {
      padding-inline: var(--mf-s1);
      text-align: center;
    }
  `,
  template: `
    <mf-fixed-page>
      <mf-page-header
        heading="Reports"
        [count]="state() === 'ready' ? total() : null"
        [countPending]="state() !== 'ready'"
      >
        <a
          mfActions
          *mfHasPermission="'Report.Manage'"
          class="mf-btn mf-btn--text"
          routerLink="/admin/reports"
          data-report-setup-link
        >
          Report Setup <i class="pi pi-arrow-right" aria-hidden="true"></i>
        </a>
      </mf-page-header>

      <mf-list-toolbar [filters]="filters" searchLabel="Search reports..." [clearAlso]="['q']">
        <mf-filter-chips
          mfView
          label="Favourites filter"
          [chips]="favouriteChips()"
          (valueChange)="toggleFavouritesOnly()"
          data-favourites-filter
        />
        <mf-dropdown
          mfView
          [multi]="true"
          [search]="true"
          searchLabel="Search categories"
          label="Category"
          placeholder="All Categories"
          data-category-filter
          [items]="categoryItems()"
          [values]="filters.list('category')"
          (valuesChange)="filters.set('category', $event)"
        />
      </mf-list-toolbar>

      @if (recentShown().length > 0) {
        <mf-report-recent-line [items]="recentShown()" />
      }

      <div class="mf-fill">
        @if (noneAssigned()) {
          <mf-state-block icon="pi-chart-bar" [fill]="true" data-none-assigned>
            No reports are assigned to you.
            <span mfStateReason>Ask an administrator to assign reports to your role.</span>
          </mf-state-block>
        } @else if (nothingShown() && searchOnly()) {
          <mf-state-block icon="pi-search" [fill]="true" data-search-empty>
            No results for "{{ searchOnly() }}".
            <p-button
              mfStateAction
              label="Clear Search"
              severity="secondary"
              (onClick)="filters.set('q', '')"
            />
          </mf-state-block>
        } @else if (nothingShown()) {
          <mf-state-block icon="pi-search" [fill]="true" data-filter-empty>
            No reports match these filters.
            <p-button
              mfStateAction
              label="Clear Filters"
              severity="secondary"
              (onClick)="filters.clear(['q'])"
            />
          </mf-state-block>
        } @else {
          <mf-record-grid
            tableId="reports-table"
            label="Reports list"
            caption="Reports, grouped by category"
            noun="reports"
            [grid]="grid"
            [rows]="shown()"
            [rowKey]="reportKey"
            [loadState]="state()"
            [empty]="false"
            [bones]="bones"
            [groupBy]="groupOf"
            [collapsedGroups]="collapsed()"
            (groupToggle)="onGroupToggle($event)"
            (retry)="load()"
          >
            <ng-template mfCell="star" let-r>
              <td class="rl-star">
                <mf-report-star
                  [name]="r.name"
                  [on]="!!r.isFavourite"
                  [compact]="true"
                  (toggled)="toggleFavourite(r)"
                />
              </td>
            </ng-template>
            <ng-template mfCell="name" let-r>
              <td class="rl-report" [attr.data-report]="r.name">
                <a
                  class="mf-btn mf-btn--text mf-btn--name"
                  [routerLink]="['/reports', r.reportId]"
                  mfRowLink="reports"
                  [rowKey]="r.reportId"
                  [attr.title]="r.name"
                  data-open
                  >{{ r.name }}</a
                >
                @if (r.description) {
                  <span class="rl-desc pg-clip" [mfTip]="r.description" data-description>{{
                    r.description
                  }}</span>
                }
              </td>
            </ng-template>
            <ng-template mfCell="parameters" let-r>
              <td class="pg-muted pg-nowrap" data-parameters>
                @if (r.parameterCount > 0) {
                  <span [mfTip]="r.parameterLabels.join('\\n')" [attr.tabindex]="null">{{
                    parametersOf(r)
                  }}</span>
                } @else {
                  {{ parametersOf(r) }}
                }
              </td>
            </ng-template>
            <ng-template mfCell="lastRun" let-r>
              <td class="pg-nowrap" data-last-run>
                @if (r.lastRunAtUtc) {
                  {{ r.lastRunAtUtc | mfNum }}
                } @else {
                  <span class="pg-muted">Never</span>
                }
              </td>
            </ng-template>
          </mf-record-grid>
        }
      </div>
      <p class="pg-sr" role="status" aria-live="polite" aria-atomic="true" data-favourite-live>
        {{ announcement() }}
      </p>
    </mf-fixed-page>
  `,
})
export class ReportsListPage {
  private readonly api = inject(ReportsClient);
  private readonly favouritesApi = inject(ReportFavouritesClient);
  private readonly auth = inject(AuthStore);
  private readonly quiet = inject(QuietRequests);
  private readonly notify = inject(NotificationService);

  protected readonly state = signal<LoadState>('loading');
  private readonly all = signal<readonly ReportRow[]>([]);
  protected readonly total = computed(() => this.all().length);

  protected readonly bones = BONES;
  protected readonly parametersOf = parametersText;
  protected readonly reportKey = (r: ReportRow): number => r.reportId;

  /** The four columns of the spec (2.2): the star (44 px, no heading drawn), the Report column is the spring, the others have a floor that grows a little from 1366 to 1920. */
  protected readonly gridDefs = signal<readonly RecordGridColumn[]>([
    {
      key: 'star',
      label: 'Favourite',
      locked: true,
      pinned: true,
      iconOnly: true,
      width: '44px',
      minWidth: '44px',
    },
    { key: 'name', label: 'Report', locked: true, minWidth: '280px' },
    {
      key: 'parameters',
      label: 'Parameters',
      width: 'clamp(120px, 8.8vw, 140px)',
      minWidth: '120px',
    },
    {
      key: 'lastRun',
      label: 'Last Run',
      width: 'clamp(140px, 10.3vw, 160px)',
      minWidth: '140px',
    },
  ]);
  protected readonly grid = new RecordGridState('reports-list', this.gridDefs);

  /** Search (name, description, category) and the Category filter, both in the address so a link keeps them. */
  protected readonly filters = new ListFilters({
    screen: 'reports',
    noun: 'reports',
    defs: computed((): FilterDef[] => [
      { key: 'q', label: 'Search', type: 'text', search: true },
      {
        key: 'category',
        label: 'Category',
        type: 'multiSelect',
        // The toolbar's own Category dropdown is the control; the filter only shows its chip.
        noControl: true,
        options: () => this.categories().map((c) => ({ value: c.value, label: c.label })),
      },
      {
        key: 'favourites',
        label: 'Favourites',
        type: 'select',
        // The Favourites chip of the toolbar is the control; the filter shows its chip and counts for Clear Filters, in the address (`?favourites=true`).
        noControl: true,
        bareChip: true,
        options: [{ value: 'true', label: 'Favourites' }],
      },
    ]),
  });

  protected readonly favouritesOnly = computed(() => this.filters.text('favourites') === 'true');
  protected readonly favouriteChips = computed<readonly FilterChip[]>(() => [
    { key: 'favourites', label: 'Favourites', icon: 'pi-star', pressed: this.favouritesOnly() },
  ]);

  private readonly categories = computed(() => {
    const seen = new Map<string, string>();
    for (const r of this.all()) seen.set(String(r.categoryId), r.categoryName);
    return [...seen].map(([value, label]) => ({ value, label }));
  });
  protected readonly categoryItems = computed<DropdownItem[]>(() => this.categories());

  protected readonly shown = computed(() =>
    filterReports(
      this.all(),
      this.filters.text('q'),
      this.filters.list('category'),
      this.favouritesOnly(),
    ),
  );
  protected readonly noneAssigned = computed(() => this.state() === 'ready' && this.total() === 0);
  protected readonly nothingShown = computed(
    () => this.state() === 'ready' && this.total() > 0 && this.shown().length === 0,
  );
  /** The search text when it is the only filter, else ''. */
  protected readonly searchOnly = computed(() =>
    this.filters.list('category').length === 0 && !this.favouritesOnly()
      ? this.filters.text('q').trim()
      : '',
  );

  /** The person's recent reports (newest first, from the server); empty while loading, after a failure or when nothing was run. */
  private readonly recent = signal<readonly RecentReportResponse[]>([]);
  /** The line shows while the person has run something and no search or filter is active (spec 7.2); it never holds a report the list does not. */
  protected readonly recentShown = computed(() => {
    if (this.state() !== 'ready' || this.filters.activeCount() > 0) return [];
    const known = new Set(this.all().map((r) => r.reportId));
    return this.recent()
      .filter((r) => known.has(r.reportId))
      .slice(0, RECENT_MAX);
  });
  /** What the polite live region says after a star press. */
  protected readonly announcement = signal('');

  protected readonly groupOf = (r: ReportRow): RecordGroup => ({
    key: String(r.categoryId),
    label: r.categoryName,
  });
  private readonly storageKey = computed(() => collapsedKey(this.auth.profile()?.userId));
  protected readonly collapsed = signal<readonly string[]>(readCollapsed(this.storageKey()));

  constructor() {
    restoreRowFocus('reports', () => this.state() === 'ready');
    effect(() => untracked(() => void this.load()));
    effect(() => {
      if (this.state() === 'ready') this.filters.reportResults(this.shown().length);
    });
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const list = await firstValueFrom(this.api.listMyReports());
      this.all.set(flattenReports(list.categories));
      this.state.set('ready');
    } catch (error) {
      this.state.set(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    await this.loadRecent();
  }

  /** The Recent line is an extra: a failure leaves the line out and says nothing (the list is what the person came for). */
  private async loadRecent(): Promise<void> {
    try {
      const res = await this.quiet.run(() =>
        firstValueFrom(this.favouritesApi.listRecentReports(RECENT_MAX)),
      );
      this.recent.set(res.reports);
    } catch {
      this.recent.set([]);
    }
  }

  protected toggleFavouritesOnly(): void {
    this.filters.set('favourites', this.favouritesOnly() ? '' : 'true');
  }

  /**
   * The star was pressed: the mark changes at once and the call follows; a failure puts the star back and shows the toast (spec 7.1). Nothing is said when
   * it worked (the star is the feedback), except in the hidden live region. A press while the call of the same star is still running is ignored.
   */
  protected async toggleFavourite(row: ReportRow): Promise<void> {
    if (this.pending.has(row.reportId)) return;
    const on = !row.isFavourite;
    this.pending.add(row.reportId);
    this.all.update((rows) => withFavourite(rows, row.reportId, on));
    try {
      await this.quiet.run(() =>
        firstValueFrom(
          on
            ? this.favouritesApi.addReportFavourite(row.reportId)
            : this.favouritesApi.removeReportFavourite(row.reportId),
        ),
      );
      this.announcement.set(starAnnouncement(row.name, on));
    } catch {
      this.all.update((rows) => withFavourite(rows, row.reportId, !on));
      this.notify.error(FAVOURITES_FAILED);
    } finally {
      this.pending.delete(row.reportId);
    }
  }

  private readonly pending = new Set<number>();

  protected onGroupToggle(toggle: RecordGroupToggle): void {
    const next = new Set(this.collapsed());
    // `open` says whether the group is open now: a closed one is the one to remember.
    if (toggle.open) next.delete(toggle.key);
    else next.add(toggle.key);
    const keys = [...next];
    this.collapsed.set(keys);
    writeCollapsed(this.storageKey(), keys);
  }
}
