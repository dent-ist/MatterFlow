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
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { WorkflowSummary, WorkflowsClient } from '../../../api/generated/api-client';
import {
  StatusFilter,
  isActiveParam,
  parsePage,
  parseStatus,
  debounced,
} from '../../../shared/ui/list-helpers';
import { Pager } from '../../../shared/ui/pager';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ActiveBadge, Badge } from '../../../shared/ui/badge';
import { PageHeader } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Admin: Workflows list (UX S16). Search by name, Active/Inactive/All filter, server paged; state lives in the URL.
 * Each row shows the latest published version and any draft in progress. Needs `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-workflows-list-page',
  imports: [PageHeader, Badge, ActiveBadge, ErrorReference, RouterLink, Button, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', './workflows.scss'],
  template: `
    <mf-page-header
      heading="Workflows"
      description="A workflow is an ordered or unordered list of steps. Tasks run on a published version; edit by creating a new draft."
    >
      <p-button
        mfActions
        label="New workflow"
        icon="pi pi-plus"
        (onClick)="go('/admin/workflows/new')"
      />
    </mf-page-header>

    <form
      class="pg-filters"
      role="search"
      (submit)="$event.preventDefault(); search(searchBox.value)"
    >
      <div class="pg-filter">
        <label for="wf-search">Search</label>
        <input
          #searchBox
          id="wf-search"
          class="pg-input"
          type="search"
          placeholder="Workflow name"
          [value]="q() ?? ''"
          (keydown.enter)="search(searchBox.value)"
          (input)="searchLater(searchBox.value)"
          (blur)="search(searchBox.value)"
        />
      </div>
      <div class="pg-filter">
        <label for="wf-status">Status</label>
        <select
          id="wf-status"
          class="pg-input"
          [value]="statusFilter()"
          (change)="setStatus($any($event.target).value)"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>
    </form>

    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading workflows...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert">
          Something went wrong. Try again.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (rows().length === 0) {
          @if (hasFilter()) {
            <div class="pg-state" data-empty="filtered">
              <p>No workflows match these filters.</p>
              <p-button label="Clear filters" severity="secondary" (onClick)="clear()" />
            </div>
          } @else {
            <div class="pg-state" data-empty="none">
              <p>No workflows yet. Create the first workflow.</p>
              <p-button label="New workflow" (onClick)="go('/admin/workflows/new')" />
            </div>
          }
        } @else {
          <table class="pg-table" data-workflows>
            <caption class="pg-sr">
              Workflows
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Latest published</th>
                <th scope="col">Draft</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (w of rows(); track w.workflowDefinitionId) {
                <tr [attr.data-row]="w.name">
                  <td>
                    <a
                      class="pg-link"
                      [routerLink]="['/admin/workflows', w.workflowDefinitionId]"
                      >{{ w.name }}</a
                    >
                    @if (w.description) {
                      <div class="pg-muted">{{ w.description }}</div>
                    }
                  </td>
                  <td>
                    @if (w.publishedVersionNo) {
                      <mf-badge tone="success" icon="pi-check-circle">Published</mf-badge>
                      v{{ w.publishedVersionNo }} ({{ stepsLabel(w.publishedStepCount) }})
                    } @else {
                      <span class="pg-muted">Not published</span>
                    }
                  </td>
                  <td>
                    @if (w.draftVersionNo) {
                      <mf-badge tone="warning" icon="pi-pencil">Draft</mf-badge>
                      v{{ w.draftVersionNo }}
                    } @else {
                      <span class="pg-muted">None</span>
                    }
                  </td>
                  <td>
                    <mf-active-badge [active]="w.isActive" />
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <mf-pager
            [page]="pageNumber()"
            [pageSize]="pageSize"
            [total]="total()"
            (pageChange)="goToPage($event)"
          />
        }
      }
    }
  `,
})
export class WorkflowsListPage {
  /** Query parameters (bound by the router): `q`, `status`, `page`. */
  readonly q = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();

  private readonly api = inject(WorkflowsClient);
  private readonly router = inject(Router);

  protected readonly pageSize = 25;
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<WorkflowSummary[]>([]);
  protected readonly total = signal(0);

  protected readonly statusFilter = computed<StatusFilter>(() => parseStatus(this.status()));
  protected readonly pageNumber = computed(() => parsePage(this.page()));
  protected readonly hasFilter = computed(() => !!this.q() || this.statusFilter() !== 'active');

  private requestId = 0;

  constructor() {
    effect(() => {
      this.q();
      this.statusFilter();
      this.pageNumber();
      untracked(() => void this.load());
    });
  }

  protected stepsLabel(count: number | undefined): string {
    return count === 1 ? '1 step' : `${count ?? 0} steps`;
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    if (this.state() === 'error') this.state.set('loading');
    try {
      const result = await firstValueFrom(
        this.api.listWorkflows(
          this.q()?.trim() || undefined,
          isActiveParam(this.statusFilter()),
          this.pageNumber(),
          this.pageSize,
        ),
      );
      if (id !== this.requestId) return;
      this.rows.set(result.items);
      this.total.set(result.total);
      this.state.set('ready');
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }

  protected readonly searchLater = debounced((text: string) => this.search(text));

  protected search(text: string): void {
    const q = text.trim() || null;
    if (q === (this.q() ?? null)) return;
    this.navigate({ q, page: null });
  }

  protected setStatus(status: string): void {
    this.navigate({ status: status === 'active' ? null : status, page: null });
  }

  protected goToPage(page: number): void {
    this.navigate({ page: page === 1 ? null : page });
  }

  protected clear(): void {
    this.navigate({ q: null, status: null, page: null });
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  private navigate(params: Record<string, string | number | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge' });
  }
}
