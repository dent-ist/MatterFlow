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
import { StepDefinitionSummary, StepDefinitionsClient } from '../../../api/generated/api-client';
import {
  StatusFilter,
  isActiveParam,
  parsePage,
  parseStatus,
  debounced,
} from '../../../shared/ui/list-helpers';
import { Pager } from '../../../shared/ui/pager';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Admin: Step Library list (UX S15). Search by title or description, Active/Inactive/All filter, server paged; state lives in the URL.
 * Each row opens the step editor. Needs `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-steps-list-page',
  imports: [RouterLink, Button, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <header class="pg-head">
      <div>
        <h1 class="pg-title">Step Library</h1>
        <p class="pg-muted">
          Reusable steps. Workflows copy a step when they are published, so editing a step here
          never changes a published workflow.
        </p>
      </div>
      <div class="pg-actions">
        <p-button label="New step" icon="pi pi-plus" (onClick)="go('/admin/steps/new')" />
      </div>
    </header>

    <form
      class="pg-filters"
      role="search"
      (submit)="$event.preventDefault(); search(searchBox.value)"
    >
      <div class="pg-filter">
        <label for="step-search">Search</label>
        <input
          #searchBox
          id="step-search"
          class="pg-input"
          type="search"
          placeholder="Title or description"
          [value]="q() ?? ''"
          (keydown.enter)="search(searchBox.value)"
          (input)="searchLater(searchBox.value)"
          (blur)="search(searchBox.value)"
        />
      </div>
      <div class="pg-filter">
        <label for="step-status">Status</label>
        <select
          id="step-status"
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
        <div class="pg-state" role="status" aria-busy="true">Loading steps...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert">
          Something went wrong. Try again.
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (rows().length === 0) {
          @if (hasFilter()) {
            <div class="pg-state" data-empty="filtered">
              <p>No steps match these filters.</p>
              <p-button label="Clear filters" severity="secondary" (onClick)="clear()" />
            </div>
          } @else {
            <div class="pg-state" data-empty="none">
              <p>No steps yet. Add the first reusable step.</p>
              <p-button label="New step" (onClick)="go('/admin/steps/new')" />
            </div>
          }
        } @else {
          <table class="pg-table" data-steps>
            <caption class="pg-sr">
              Step library
            </caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Description</th>
                <th scope="col">Used in workflows</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (s of rows(); track s.stepDefinitionId) {
                <tr [attr.data-row]="s.title">
                  <td>
                    <a class="pg-link" [routerLink]="['/admin/steps', s.stepDefinitionId]">{{
                      s.title
                    }}</a>
                  </td>
                  <td>{{ s.description }}</td>
                  <td>{{ usage(s) }}</td>
                  <td>
                    <span class="pg-chip" [class.pg-chip--inactive]="!s.isActive">{{
                      s.isActive ? 'Active' : 'Inactive'
                    }}</span>
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
export class StepsListPage {
  /** Query parameters (bound by the router): `q`, `status`, `page`. */
  readonly q = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();

  private readonly api = inject(StepDefinitionsClient);
  private readonly router = inject(Router);

  protected readonly pageSize = 25;
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<StepDefinitionSummary[]>([]);
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

  protected usage(step: StepDefinitionSummary): string {
    if (step.usedInVersions === 0) return 'Not used';
    return step.usedInVersions === 1 ? '1 version' : `${step.usedInVersions} versions`;
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    if (this.state() === 'error') this.state.set('loading');
    try {
      const result = await firstValueFrom(
        this.api.listStepDefinitions(
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
