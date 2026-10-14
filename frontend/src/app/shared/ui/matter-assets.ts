import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { AssetListItem, AssetsClient } from '../../api/generated/api-client';
import { HasPermissionDirective } from '../directives/has-permission.directive';
import { StatusFilter, isActiveParam } from './list-helpers';
import { Pager } from './pager';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * The Assets tab of a Matter (UX S08, S06): server-side search by name, type or external reference, a status filter and paging, for
 * the 200 to 300 assets a Matter can hold. Creating an asset starts from here with the Matter prefilled and locked.
 */
@Component({
  selector: 'mf-matter-assets',
  imports: [RouterLink, Button, HasPermissionDirective, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './page.scss',
  template: `
    <div class="pg-filters" role="search">
      <div class="pg-filter">
        <label for="matter-asset-search">Search assets</label>
        <input
          #searchBox
          id="matter-asset-search"
          class="pg-input"
          type="search"
          placeholder="Name, type or reference"
          [value]="q()"
          (keydown.enter)="search(searchBox.value)"
          (blur)="search(searchBox.value)"
        />
      </div>
      <div class="pg-filter">
        <label for="matter-asset-status">Status</label>
        <select
          id="matter-asset-status"
          class="pg-input"
          [value]="status()"
          (change)="setStatus($any($event.target).value)"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>
      <p-button
        *mfHasPermission="'Asset.Create'"
        label="New Asset"
        icon="pi pi-plus"
        severity="secondary"
        (onClick)="newAsset()"
      />
    </div>

    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading assets...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert">
          We couldn't load the assets.
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (rows().length === 0) {
          <div
            class="pg-state"
            [attr.data-empty]="q() || status() !== 'active' ? 'filtered' : 'none'"
          >
            @if (q() || status() !== 'active') {
              <p>No assets match these filters.</p>
            } @else {
              <p>No assets in this matter yet.</p>
            }
          </div>
        } @else {
          <table class="pg-table">
            <caption class="pg-sr">
              Assets of this matter
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">External reference</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (a of rows(); track a.assetId) {
                <tr>
                  <td>
                    <a class="pg-link" [routerLink]="['/assets', a.assetId]">{{ a.displayName }}</a>
                  </td>
                  <td>{{ a.assetTypeName }}</td>
                  <td class="pg-mono">{{ a.externalReference }}</td>
                  <td>
                    <span class="pg-chip" [class.pg-chip--inactive]="!a.isActive">{{
                      a.isActive ? 'Active' : 'Inactive'
                    }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <mf-pager
            [page]="page()"
            [pageSize]="pageSize"
            [total]="total()"
            (pageChange)="goToPage($event)"
          />
        }
      }
    }
  `,
})
export class MatterAssets {
  readonly matterId = input.required<number>();

  private readonly api = inject(AssetsClient);
  private readonly router = inject(Router);

  protected readonly pageSize = 25;
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<AssetListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly q = signal('');
  protected readonly status = signal<StatusFilter>('active');
  protected readonly page = signal(1);
  private requestId = 0;

  constructor() {
    effect(() => {
      this.matterId();
      untracked(() => {
        this.page.set(1);
        void this.load();
      });
    });
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    this.state.set('loading');
    try {
      const result = await firstValueFrom(
        this.api.listAssets(
          this.matterId(),
          undefined,
          isActiveParam(this.status()),
          this.q().trim() || undefined,
          this.page(),
          this.pageSize,
          'displayName',
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
    const q = text.trim();
    if (q === this.q()) return;
    this.q.set(q);
    this.page.set(1);
    void this.load();
  }

  protected setStatus(status: string): void {
    this.status.set(status === 'inactive' || status === 'all' ? status : 'active');
    this.page.set(1);
    void this.load();
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    void this.load();
  }

  protected newAsset(): void {
    void this.router.navigateByUrl(`/assets/new?matterId=${this.matterId()}`);
  }
}
