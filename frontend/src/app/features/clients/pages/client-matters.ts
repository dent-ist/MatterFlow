import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { MatterResponse, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
import { ListState, SortHeader, StatusFilter } from '../../../shared/ui/data-table';
import { isActiveParam } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { Pager } from '../../../shared/ui/pager';
import { SearchBox } from '../../../shared/ui/search-box';

/**
 * The main area of the Client detail page: the client's Matters as a list in the shared pattern (search, status filter defaulting to
 * Active, sortable columns, paging, loading / empty / error states) with a "Create matter" button that prefills the client. The list
 * state (`q`, `status`, `page`, `size`, `sort`) is bound by the page from the address, like every other list. Needs `Matter.View`.
 */
@Component({
  selector: 'mf-client-matters',
  imports: [
    Button,
    ScrollArea,
    HasPermissionDirective,
    ActiveBadge,
    SensitiveBadge,
    MatterRef,
    Pager,
    SearchBox,
    StatusFilter,
    SortHeader,
    ListState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .cm-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: start;
      justify-content: space-between;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .cm-bar .pg-filters {
      margin-bottom: 0;
    }
    /* Lines the button up with the search input (a label row above the controls, and a 40 px input against a 32 px button). */
    .cm-create {
      margin-top: calc(1.5rem + (var(--mf-row-h) - 32px) / 2);
    }
    /* Pinned above the grid of a fixed-header page the search has no label row, so the button sits on the same line. */
    @media (min-width: 768px) and (min-height: 561px) {
      .cm-bar {
        align-items: center;
        margin-bottom: var(--mf-s2);
      }
      .cm-create {
        margin-top: 0;
      }
    }
  `,
  template: `
    @if (!canView()) {
      <div class="pg-state" data-no-access="matters">
        You don't have permission to view matters.
      </div>
    } @else {
      <div class="cm-bar">
        <div class="pg-filters" role="search">
          <mf-search-box
            inputId="client-matter-search"
            placeholder="Matter number or name"
            [value]="q() ?? ''"
            (searchChange)="search($event)"
          />
          <mf-status-filter
            inputId="client-matter-status"
            [value]="statusFilter()"
            (valueChange)="setStatus($event)"
          />
        </div>
        <p-button
          *mfHasPermission="'Matter.Create'"
          label="Create matter"
          icon="pi pi-plus"
          severity="secondary"
          class="cm-create"
          data-create-matter
          [disabled]="!clientActive()"
          [attr.aria-describedby]="clientActive() ? null : 'client-inactive-reason'"
          (onClick)="go('/matters/new?clientId=' + clientId())"
        />
      </div>
      @if (!clientActive()) {
        <p class="pg-reason" id="client-inactive-reason" data-inactive-reason>
          This client is inactive, so new matters can't be created for it.
        </p>
      }

      <mf-list-state
        noun="matters"
        [state]="state()"
        [empty]="rows().length === 0"
        [filtered]="hasFilter()"
        [columns]="4"
        emptyText="No matters yet for this client."
        (retry)="load()"
        (clear)="clear()"
      >
        <div class="mf-table-wrap" mfScrollArea="Matters list">
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
              </thead>
              <tbody>
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
        <mf-pager
          [page]="pageNumber()"
          [pageSize]="pageSize()"
          [pageSizes]="pageSizes"
          [total]="total()"
          (pageChange)="goToPage($event)"
          (pageSizeChange)="setPageSize($event)"
        />
      </mf-list-state>
    }
  `,
})
export class ClientMatters extends ServerListPage<MatterResponse> {
  readonly clientId = input.required<number>();
  readonly clientName = input('');
  /** False for an inactive client: Create matter is disabled with a visible reason. */
  readonly clientActive = input(true);

  private readonly api = inject(MattersClient);
  private readonly auth = inject(AuthStore);

  protected readonly canView = computed(() => this.auth.has('Matter.View'));
  protected readonly defaultSort = 'matterRef';

  protected override watch(): void {
    this.clientId();
  }

  protected override fetch() {
    if (!this.canView()) return Promise.resolve({ items: [], total: 0 });
    return firstValueFrom(
      this.api.listMatters(
        this.q()?.trim() || undefined,
        this.clientId(),
        isActiveParam(this.statusFilter()),
        undefined,
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }
}
