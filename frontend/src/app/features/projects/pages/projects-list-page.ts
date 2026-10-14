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
import { ProjectResponse, ProjectsClient } from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import {
  StatusFilter,
  ariaSort,
  isActiveParam,
  nextSort,
  parsePage,
  parseStatus,
} from '../../../shared/ui/list-helpers';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { Pager } from '../../../shared/ui/pager';

type LoadState = 'loading' | 'ready' | 'error';

/** Global Projects list (UX S07): search by name or matter reference, status filter, optional matter filter. */
@Component({
  selector: 'mf-projects-list-page',
  imports: [RouterLink, Button, HasPermissionDirective, Pager, MatterRef],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <header class="pg-head">
      <h1 class="pg-title">Projects</h1>
      <div class="pg-actions">
        <p-button
          *mfHasPermission="'Project.Create'"
          label="New Project"
          icon="pi pi-plus"
          (onClick)="go('/projects/new' + (matterId() ? '?matterId=' + matterId() : ''))"
        />
      </div>
    </header>

    <form
      class="pg-filters"
      role="search"
      (submit)="$event.preventDefault(); search(searchBox.value)"
    >
      <div class="pg-filter">
        <label for="project-search">Search</label>
        <input
          #searchBox
          id="project-search"
          class="pg-input"
          type="search"
          placeholder="Project name or 343-12"
          [value]="q() ?? ''"
          (keydown.enter)="search(searchBox.value)"
          (blur)="search(searchBox.value)"
        />
      </div>
      <div class="pg-filter">
        <label for="project-status">Status</label>
        <select
          id="project-status"
          class="pg-input"
          [value]="statusFilter()"
          (change)="setStatus($any($event.target).value)"
        >
          <option value="active">Active</option>
          <option value="inactive">Archived</option>
          <option value="all">All</option>
        </select>
      </div>
      @if (matterId()) {
        <div class="pg-filter">
          <span class="pg-label">Matter</span>
          <span data-matter-chip>
            {{ matterChip() }}
            <button type="button" (click)="clearMatter()" aria-label="Remove matter filter">
              Remove
            </button>
          </span>
        </div>
      }
    </form>

    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading projects...</div>
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
              <p>No results match these filters.</p>
              <p-button label="Clear filters" severity="secondary" (onClick)="clear()" />
            </div>
          } @else {
            <div class="pg-state" data-empty="none">
              <p>No projects yet.</p>
            </div>
          }
        } @else {
          <table class="pg-table">
            <caption class="pg-sr">
              Projects
            </caption>
            <thead>
              <tr>
                <th scope="col" [attr.aria-sort]="aria('name')">
                  <button type="button" (click)="sortBy('name')">Name</button>
                </th>
                <th scope="col" [attr.aria-sort]="aria('matterRef')">
                  <button type="button" (click)="sortBy('matterRef')">Matter</button>
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (p of rows(); track p.projectId) {
                <tr>
                  <td>
                    <a class="pg-link" [routerLink]="['/projects', p.projectId]">{{ p.name }}</a>
                  </td>
                  <td>
                    <mf-matter-ref [value]="p.matterRef" [link]="['/matters', p.matterId]" />
                  </td>
                  <td>
                    <span class="pg-chip" [class.pg-chip--inactive]="!p.isActive">{{
                      p.isActive ? 'Active' : 'Archived'
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
export class ProjectsListPage {
  /** Query parameters (bound by the router). */
  readonly q = input<string>();
  readonly status = input<string>();
  readonly matterId = input<string>();
  readonly page = input<string>();
  readonly sort = input<string>();

  private readonly api = inject(ProjectsClient);
  private readonly router = inject(Router);

  protected readonly pageSize = 25;
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<ProjectResponse[]>([]);
  protected readonly total = signal(0);

  protected readonly statusFilter = computed<StatusFilter>(() => parseStatus(this.status()));
  protected readonly pageNumber = computed(() => parsePage(this.page()));
  protected readonly hasFilter = computed(
    () => !!this.q() || !!this.matterId() || this.statusFilter() !== 'active',
  );
  protected readonly matterChip = computed(() => {
    const first = this.rows()[0];
    return first && String(first.matterId) === this.matterId()
      ? `${first.matterRef} ${first.matterName}`
      : `Matter ${this.matterId()}`;
  });

  private requestId = 0;

  constructor() {
    effect(() => {
      this.q();
      this.statusFilter();
      this.matterId();
      this.pageNumber();
      this.sort();
      untracked(() => void this.load());
    });
  }

  protected aria(field: string) {
    return ariaSort(this.sort(), field, 'name');
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    if (this.state() === 'error') this.state.set('loading');
    const matterId = Number(this.matterId());
    try {
      const result = await firstValueFrom(
        this.api.listProjects(
          this.q()?.trim() || undefined,
          Number.isInteger(matterId) && matterId > 0 ? matterId : undefined,
          isActiveParam(this.statusFilter()),
          this.pageNumber(),
          this.pageSize,
          this.sort() || undefined,
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

  protected search(text: string): void {
    const q = text.trim() || null;
    if (q === (this.q() ?? null)) return;
    this.navigate({ q, page: null });
  }

  protected setStatus(status: string): void {
    this.navigate({ status: status === 'active' ? null : status, page: null });
  }

  protected sortBy(field: string): void {
    this.navigate({ sort: nextSort(this.sort() || 'name', field), page: null });
  }

  protected goToPage(page: number): void {
    this.navigate({ page: page === 1 ? null : page });
  }

  protected clearMatter(): void {
    this.navigate({ matterId: null, page: null });
  }

  protected clear(): void {
    this.navigate({ q: null, status: null, matterId: null, page: null });
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  private navigate(params: Record<string, string | number | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge' });
  }
}
