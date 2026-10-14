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
import { MatterResponse, MattersClient } from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import {
  StatusFilter,
  ariaSort,
  isActiveParam,
  nextSort,
  parsePage,
  parseStatus, debounced } from '../../../shared/ui/list-helpers';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { Pager } from '../../../shared/ui/pager';

type LoadState = 'loading' | 'ready' | 'error';

/** Matters list (UX S06): search by `343-12`, `00343-00012`, a number or a name; client and status filters; state lives in the URL. */
@Component({
  selector: 'mf-matters-list-page',
  imports: [RouterLink, Button, HasPermissionDirective, Pager, MatterRef],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <header class="pg-head">
      <h1 class="pg-title">Matters</h1>
      <div class="pg-actions">
        <p-button
          *mfHasPermission="'Matter.Create'"
          label="New Matter"
          icon="pi pi-plus"
          (onClick)="go('/matters/new')"
        />
      </div>
    </header>

    <form
      class="pg-filters"
      role="search"
      (submit)="$event.preventDefault(); search(searchBox.value)"
    >
      <div class="pg-filter">
        <label for="matter-search">Search</label>
        <input
          #searchBox
          id="matter-search"
          class="pg-input"
          type="search"
          placeholder="343-12, 00343-00012 or name"
          [value]="q() ?? ''"
          (keydown.enter)="search(searchBox.value)"
          (input)="searchLater(searchBox.value)"
          (blur)="search(searchBox.value)"
        />
      </div>
      <div class="pg-filter">
        <label for="matter-status">Status</label>
        <select
          id="matter-status"
          class="pg-input"
          [value]="statusFilter()"
          (change)="setStatus($any($event.target).value)"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>
      @if (clientId()) {
        <div class="pg-filter">
          <span class="pg-label">Client</span>
          <span data-client-chip>
            {{ clientChip() }}
            <button type="button" (click)="clearClient()" aria-label="Remove client filter">
              Remove
            </button>
          </span>
        </div>
      }
    </form>

    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading matters...</div>
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
              <p>No matters yet.</p>
              <p-button
                *mfHasPermission="'Matter.Create'"
                label="New Matter"
                (onClick)="go('/matters/new')"
              />
            </div>
          }
        } @else {
          <table class="pg-table">
            <caption class="pg-sr">
              Matters
            </caption>
            <thead>
              <tr>
                <th scope="col" [attr.aria-sort]="aria('matterRef')">
                  <button type="button" (click)="sortBy('matterRef')">Matter ref</button>
                </th>
                <th scope="col" [attr.aria-sort]="aria('name')">
                  <button type="button" (click)="sortBy('name')">Name</button>
                </th>
                <th scope="col">Client</th>
                <th scope="col">Projects</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (m of rows(); track m.matterId) {
                <tr>
                  <td><mf-matter-ref [value]="m.matterRef" [link]="['/matters', m.matterId]" /></td>
                  <td>
                    {{ m.name }}
                    @if (m.isSensitive) {
                      <span class="pg-chip pg-chip--sensitive" title="Sensitive matter">
                        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> Sensitive
                      </span>
                    }
                  </td>
                  <td>
                    <a class="pg-link" [routerLink]="['/clients', m.clientId]"
                      ><span class="pg-mono">{{ m.clientNumber }}</span> {{ m.clientName }}</a
                    >
                  </td>
                  <td>{{ m.projectCount }}</td>
                  <td>
                    <span class="pg-chip" [class.pg-chip--inactive]="!m.isActive">{{
                      m.isActive ? 'Active' : 'Inactive'
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
export class MattersListPage {
  /** Query parameters (bound by the router). */
  readonly q = input<string>();
  readonly status = input<string>();
  readonly clientId = input<string>();
  readonly page = input<string>();
  readonly sort = input<string>();

  private readonly api = inject(MattersClient);
  private readonly router = inject(Router);

  protected readonly pageSize = 25;
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<MatterResponse[]>([]);
  protected readonly total = signal(0);

  protected readonly statusFilter = computed<StatusFilter>(() => parseStatus(this.status()));
  protected readonly pageNumber = computed(() => parsePage(this.page()));
  protected readonly hasFilter = computed(
    () => !!this.q() || !!this.clientId() || this.statusFilter() !== 'active',
  );
  protected readonly clientChip = computed(() => {
    const first = this.rows()[0];
    return first && String(first.clientId) === this.clientId()
      ? `${first.clientNumber} ${first.clientName}`
      : `Client ${this.clientId()}`;
  });

  private requestId = 0;

  constructor() {
    effect(() => {
      this.q();
      this.statusFilter();
      this.clientId();
      this.pageNumber();
      this.sort();
      untracked(() => void this.load());
    });
  }

  protected aria(field: string) {
    return ariaSort(this.sort(), field, 'matterRef');
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    if (this.state() === 'error') this.state.set('loading');
    const clientId = Number(this.clientId());
    try {
      const result = await firstValueFrom(
        this.api.listMatters(
          this.q()?.trim() || undefined,
          Number.isInteger(clientId) && clientId > 0 ? clientId : undefined,
          isActiveParam(this.statusFilter()),
          undefined,
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

  protected readonly searchLater = debounced((text: string) => this.search(text));

  protected search(text: string): void {
    const q = text.trim() || null;
    if (q === (this.q() ?? null)) return;
    this.navigate({ q, page: null });
  }

  protected setStatus(status: string): void {
    this.navigate({ status: status === 'active' ? null : status, page: null });
  }

  protected sortBy(field: string): void {
    this.navigate({ sort: nextSort(this.sort() || 'matterRef', field), page: null });
  }

  protected goToPage(page: number): void {
    this.navigate({ page: page === 1 ? null : page });
  }

  protected clearClient(): void {
    this.navigate({ clientId: null, page: null });
  }

  protected clear(): void {
    this.navigate({ q: null, status: null, clientId: null, page: null });
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  private navigate(params: Record<string, string | number | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge' });
  }
}
