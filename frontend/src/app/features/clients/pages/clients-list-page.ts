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
import { ClientResponse, ClientsClient } from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import {
  StatusFilter,
  ariaSort,
  isActiveParam,
  nextSort,
  parsePage,
  parseStatus, debounced } from '../../../shared/ui/list-helpers';
import { Pager } from '../../../shared/ui/pager';

type LoadState = 'loading' | 'ready' | 'error';

/** Clients list (UX S05): search by number (padded or not) or name, status filter, sortable, server paged. State lives in the URL. */
@Component({
  selector: 'mf-clients-list-page',
  imports: [RouterLink, Button, HasPermissionDirective, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <header class="pg-head">
      <h1 class="pg-title">Clients</h1>
      <div class="pg-actions">
        <p-button
          *mfHasPermission="'Client.Create'"
          label="New Client"
          icon="pi pi-plus"
          (onClick)="go('/clients/new')"
        />
      </div>
    </header>

    <form
      class="pg-filters"
      role="search"
      (submit)="$event.preventDefault(); search(searchBox.value)"
    >
      <div class="pg-filter">
        <label for="client-search">Search</label>
        <input
          #searchBox
          id="client-search"
          class="pg-input"
          type="search"
          placeholder="343 or Acme"
          [value]="q() ?? ''"
          (keydown.enter)="search(searchBox.value)"
          (input)="searchLater(searchBox.value)"
          (blur)="search(searchBox.value)"
        />
      </div>
      <div class="pg-filter">
        <label for="client-status">Status</label>
        <select
          id="client-status"
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
        <div class="pg-state" role="status" aria-busy="true">Loading clients...</div>
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
              <p>No clients yet.</p>
              <p-button
                *mfHasPermission="'Client.Create'"
                label="New Client"
                (onClick)="go('/clients/new')"
              />
            </div>
          }
        } @else {
          <table class="pg-table">
            <caption class="pg-sr">
              Clients
            </caption>
            <thead>
              <tr>
                <th scope="col" [attr.aria-sort]="aria('clientNumber')">
                  <button type="button" (click)="sortBy('clientNumber')">Client No.</button>
                </th>
                <th scope="col" [attr.aria-sort]="aria('name')">
                  <button type="button" (click)="sortBy('name')">Name</button>
                </th>
                <th scope="col">Matters</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (c of rows(); track c.clientId) {
                <tr>
                  <td class="pg-mono">
                    <a class="pg-link" [routerLink]="['/clients', c.clientId]">{{
                      c.clientNumber
                    }}</a>
                  </td>
                  <td>{{ c.name }}</td>
                  <td>{{ c.matterCount }}</td>
                  <td>
                    <span class="pg-chip" [class.pg-chip--inactive]="!c.isActive">{{
                      c.isActive ? 'Active' : 'Inactive'
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
export class ClientsListPage {
  /** Query parameters (bound by the router): `q`, `status`, `page`, `sort`. */
  readonly q = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();
  readonly sort = input<string>();

  private readonly api = inject(ClientsClient);
  private readonly router = inject(Router);

  protected readonly pageSize = 25;
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<ClientResponse[]>([]);
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
      this.sort();
      untracked(() => void this.load());
    });
  }

  protected aria(field: string) {
    return ariaSort(this.sort(), field, 'clientNumber');
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    if (this.state() === 'error') this.state.set('loading');
    try {
      const result = await firstValueFrom(
        this.api.listClients(
          this.q()?.trim() || undefined,
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
    this.navigate({ sort: nextSort(this.sort() || 'clientNumber', field), page: null });
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
