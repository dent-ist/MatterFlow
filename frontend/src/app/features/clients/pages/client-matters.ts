import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatterResponse, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { matterColumnDefs } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
import { SortHeader } from '../../../shared/ui/data-table';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { Pager } from '../../../shared/ui/pager';

/** Why New matter is unavailable for an inactive client (the server refuses with ClientInactive); shown beside the button and as its tooltip. */
const INACTIVE_REASON = 'This client is inactive. Set it active to add matters.';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['matterRef', 'name', 'projects', 'status'] as const;

/**
 * The main area of the Client detail page: the client's Matters as a list in the shared pattern (inline column filters for Matter and
 * Name, Status defaulting to Active, Sensitive under "Other filters"; sortable columns, paging, loading / empty / error states) with a
 * "New matter" button that prefills the client. The filters (`matterRef`, `name`, `status`, `isSensitive`) are read from the address
 * by `ListFilters`; the page binds `status`, `page`, `size` and `sort` like every other list. Needs `Matter.View`.
 */
@Component({
  selector: 'mf-client-matters',
  imports: [
    ScrollArea,
    HasPermissionDirective,
    ActiveBadge,
    SensitiveBadge,
    MatterRef,
    Pager,
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .cm-new {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      min-width: 0;
    }
    .cm-reason {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    @if (!canView()) {
      <div class="pg-state" data-no-access="matters">
        You don't have permission to view matters.
      </div>
    } @else {
      <mf-filters-bar [filters]="filters" controls="client-matter-filter-row" [clearAlso]="['q']">
        <span mfBarStart *mfHasPermission="'Matter.Create'" class="cm-new">
          <!-- aria-disabled, not disabled: the button stays in the tab order, so the reason is reachable and read out. -->
          <button
            type="button"
            class="mf-btn"
            data-create-matter
            [attr.aria-disabled]="clientActive() ? null : 'true'"
            [attr.aria-describedby]="clientActive() ? null : 'client-inactive-reason'"
            [attr.title]="clientActive() ? null : INACTIVE_REASON"
            (click)="newMatter()"
          >
            <i class="pi pi-plus" aria-hidden="true"></i>
            New matter
          </button>
          @if (!clientActive()) {
            <span class="cm-reason" id="client-inactive-reason" data-inactive-reason>{{
              INACTIVE_REASON
            }}</span>
          }
        </span>
      </mf-filters-bar>

      <div class="mf-table-wrap" mfScrollArea="Matters list" #scroll>
        <div class="mf-scroll">
          <table class="pg-table">
            <caption class="pg-sr">
              Matters of
              {{
                clientName()
              }}
            </caption>
            <thead>
              <tr>
                <th
                  mfSort="matterRef"
                  [sort]="sort()"
                  [defaultSort]="defaultSort"
                  (sorted)="setSort($event)"
                >
                  Matter
                </th>
                <th
                  mfSort="name"
                  [sort]="sort()"
                  [defaultSort]="defaultSort"
                  (sorted)="setSort($event)"
                >
                  Name
                </th>
                <th scope="col">Projects</th>
                <th scope="col">Status</th>
              </tr>
              @if (filters.rowVisible()) {
                <tr
                  mfColumnFilterRow
                  id="client-matter-filter-row"
                  [filters]="filters"
                  [columns]="columns"
                ></tr>
              }
            </thead>
            <tbody
              mfGridBody
              noun="matters"
              emptyText="No matters yet for this client."
              [state]="state()"
              [empty]="rows().length === 0"
              [filtered]="filters.activeCount() > 0"
              [columns]="4"
              (retry)="load()"
              (clear)="clear()"
            >
              <span mfEmptyAction *mfHasPermission="'Matter.Create'">
                @if (clientActive()) {
                  <button type="button" class="mf-btn" data-empty-new-matter (click)="newMatter()">
                    New matter
                  </button>
                } @else {
                  <span class="cm-reason">{{ INACTIVE_REASON }}</span>
                }
              </span>
              @for (m of rows(); track m.matterId) {
                <tr>
                  <td>
                    <mf-matter-ref [value]="m.matterRef" [link]="['/matters', m.matterId]" />
                  </td>
                  <td>
                    {{ m.name }}
                    @if (m.isSensitive) {
                      <mf-sensitive-badge />
                    }
                  </td>
                  <td>{{ m.projectCount }}</td>
                  <td><mf-active-badge [active]="m.isActive" /></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
      @if (state() === 'ready' && total() > 0) {
        <mf-pager
          [page]="pageNumber()"
          [pageSize]="pageSize()"
          [pageSizes]="pageSizes"
          [total]="total()"
          (pageChange)="goToPage($event)"
          (pageSizeChange)="setPageSize($event)"
        />
      }
    }
  `,
})
export class ClientMatters extends ServerListPage<MatterResponse> {
  readonly clientId = input.required<number>();
  readonly clientName = input('');
  /** False for an inactive client: New matter is disabled with a visible reason. */
  readonly clientActive = input(true);

  private readonly api = inject(MattersClient);
  private readonly auth = inject(AuthStore);

  private readonly injector = inject(Injector);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly canView = computed(() => this.auth.has('Matter.View'));
  protected readonly defaultSort = 'matterRef';
  protected readonly columns = COLUMNS;
  protected readonly INACTIVE_REASON = INACTIVE_REASON;

  /** One definition per filter (the Matters list's, without the Client column). */
  private readonly defs = computed((): FilterDef[] => matterColumnDefs('Matter'));

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'client-matters',
    noun: 'matters',
    defs: this.defs,
  });

  constructor() {
    super();
    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(() => this.filters.watchOverflow(this.scroll()?.nativeElement), {
      injector: this.injector,
    });
  }

  /** Opens the New matter form for this client; does nothing for an inactive one (the button is `aria-disabled`, not disabled). */
  protected newMatter(): void {
    if (this.clientActive()) this.go('/matters/new?clientId=' + this.clientId());
  }

  protected override listFilters() {
    return this.filters;
  }

  protected override watch(): void {
    this.clientId();
    this.canView();
    super.watch();
  }

  protected override fetch() {
    if (!this.canView()) return Promise.resolve({ items: [], total: 0 });
    const sensitive = this.filters.text('isSensitive');
    return firstValueFrom(
      this.api.listMatters(
        undefined,
        this.clientId(),
        isActiveParam(parseStatus(this.filters.text('status'))),
        sensitive === '' ? undefined : sensitive === 'true',
        this.filters.text('matterRef') || undefined,
        this.filters.text('name') || undefined,
        undefined,
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }
}
