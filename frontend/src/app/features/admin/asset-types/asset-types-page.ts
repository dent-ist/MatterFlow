import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
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
import { AssetTypeResponse, AssetTypesClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { TextField } from '../../../shared/ui/text-field';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ActiveBadge } from '../../../shared/ui/badge';
import { LoadState } from '../../../shared/ui/data-table';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['name', 'fields', 'assets', 'status', 'actions'] as const;

/**
 * Admin: Asset Types (UX S17), the first tab of the Assets set-up page. Name, description, order and active flag are edited here; the type's own fields are edited in the
 * form designer (`Edit fields`), which versions them. Types are deactivated, never deleted, so existing Assets keep working.
 * Needs `AssetType.Manage`.
 */
@Component({
  selector: 'mf-asset-types-page',
  imports: [
    ActiveBadge,
    ScrollArea,
    ConfirmDialog,
    RouterLink,
    Button,
    TextField,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <div class="pg-bar">
      <p class="pg-muted pg-bar__intro">
        Each type has its own fields. Fields are versioned; changing them never alters saved values.
      </p>
      @if (canManage()) {
        <p-button label="New asset type" icon="pi pi-plus" (onClick)="startCreate()" />
      }
    </div>

    <p class="pg-sr" role="status" aria-live="polite" data-announce>{{ announcement() }}</p>

    <mf-confirm-dialog
      title="Deactivate asset type?"
      confirmLabel="Deactivate asset type"
      cancelLabel="Keep active"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="deactivateOpen"
      (confirmed)="confirmDeactivate()"
    >
      <p>
        {{ deactivateTarget()?.name }} can't be chosen for new assets.
        @if (deactivateTarget()?.assetCount; as count) {
          The {{ count }} existing {{ count === 1 ? 'asset keeps' : 'assets keep' }} this type.
        } @else {
          Existing assets keep this type.
        }
        You can activate it again later.
      </p>
    </mf-confirm-dialog>

    @if (editing()) {
      <form class="pg-form" novalidate data-editor (submit)="$event.preventDefault(); save()">
        <h2 class="pg-subtitle">{{ editingId() ? 'Edit asset type' : 'New asset type' }}</h2>
        @if (summary().length > 0) {
          <div class="pg-summary" role="alert" data-summary>
            <ul>
              @for (message of summary(); track message) {
                <li>{{ message }}</li>
              }
            </ul>
          </div>
        }
        <mf-text-field
          inputId="type-name"
          label="Name"
          [required]="true"
          [maxLength]="100"
          [error]="nameError()"
          [(value)]="name"
        />
        <mf-text-field
          inputId="type-description"
          label="Description"
          [multiline]="true"
          [maxLength]="500"
          [error]="fieldError('description')"
          [(value)]="description"
        />
        <div class="pg-filter">
          <label for="type-order">Order</label>
          <input
            id="type-order"
            class="mf-control pg-input"
            type="number"
            step="1"
            [value]="sortOrder()"
            (input)="sortOrder.set(+$any($event.target).value)"
          />
        </div>
        @if (editingId()) {
          <label class="pg-radio">
            <input
              type="checkbox"
              [checked]="isActive()"
              (change)="isActive.set($any($event.target).checked)"
            />
            Active (inactive types can't be chosen for new assets)
          </label>
        }
        <div class="pg-actions mf-form-actions--sticky">
          <p-button
            type="submit"
            [label]="busy() ? 'Saving...' : editingId() ? 'Save changes' : 'Create asset type'"
            [disabled]="busy()"
          />
          <p-button label="Cancel" severity="secondary" (onClick)="cancel()" />
        </div>
      </form>
    }

    <mf-filters-bar [filters]="filters" controls="asset-type-filter-row" [clearAlso]="['q']" />

    <div class="mf-table-wrap" mfScrollArea="Asset types list" #scroll>
      <div class="mf-scroll">
        <table class="pg-table" data-types>
          <caption class="pg-sr">
            Asset types
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Fields</th>
              <th scope="col">Assets</th>
              <th scope="col">Status</th>
              <th scope="col" class="mf-col-actions"><span class="pg-sr">Actions</span></th>
            </tr>
            @if (filters.rowVisible()) {
              <tr
                mfColumnFilterRow
                id="asset-type-filter-row"
                [filters]="filters"
                [columns]="columns"
              ></tr>
            }
          </thead>
          <tbody
            mfGridBody
            noun="asset types"
            emptyText="No asset types yet."
            [state]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            [columns]="5"
            (retry)="load()"
            (clear)="clear()"
          >
            @for (t of rows(); track t.assetTypeId) {
              <tr [attr.data-row]="t.name">
                <td>
                  <strong>{{ t.name }}</strong>
                  @if (t.description) {
                    <div class="pg-muted">{{ t.description }}</div>
                  }
                </td>
                <td>
                  @if (t.publishedFormVersionNo) {
                    Published v{{ t.publishedFormVersionNo }}
                  } @else {
                    <span class="pg-muted">No published fields</span>
                  }
                  <a
                    class="pg-link"
                    [routerLink]="['/admin/asset-types', t.assetTypeId, 'form']"
                    [attr.aria-label]="'Edit fields of ' + t.name"
                    >Edit fields</a
                  >
                </td>
                <td>{{ t.assetCount }}</td>
                <td>
                  <mf-active-badge [active]="t.isActive" />
                </td>
                <td class="mf-col-actions">
                  @if (canManage()) {
                    <span class="mf-row-actions">
                      <button
                        type="button"
                        class="mf-btn mf-btn--text"
                        [attr.aria-label]="'Edit ' + t.name"
                        (click)="startEdit(t)"
                        data-edit
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        class="mf-btn mf-btn--text"
                        [class.mf-btn--danger]="t.isActive"
                        [disabled]="busy()"
                        [attr.aria-label]="(t.isActive ? 'Deactivate ' : 'Activate ') + t.name"
                        (click)="onToggle(t)"
                        data-toggle
                      >
                        {{ t.isActive ? 'Deactivate' : 'Activate' }}
                      </button>
                    </span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
    .pg-subtitle {
      margin: 0;
      font-size: var(--mf-fs-h3);
    }
    .pg-table {
      table-layout: auto;
    }
    td .pg-link {
      display: block;
    }
  `,
})
export class AssetTypesPage {
  private readonly api = inject(AssetTypesClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly columns = COLUMNS;
  protected readonly canManage = computed(() => this.auth.has('AssetType.Manage'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<AssetTypeResponse[]>([]);
  /** Inline column filters: Name (`name`) and Status (`status`, Active by default). The old `q` is no longer read. */
  protected readonly filters: ListFilters = new ListFilters({
    screen: 'asset-types',
    noun: 'asset types',
    defs: computed((): FilterDef[] => [
      { key: 'name', label: 'Name', column: 'name', type: 'text' },
      statusDef(),
    ]),
  });
  protected readonly busy = signal(false);
  protected readonly announcement = signal('');
  protected readonly deactivateOpen = signal(false);
  protected readonly deactivateTarget = signal<AssetTypeResponse | null>(null);

  protected readonly editing = signal(false);
  protected readonly editingId = signal<number | null>(null);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly sortOrder = signal(0);
  protected readonly isActive = signal(true);
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly summary = signal<string[]>([]);

  protected readonly nameError = computed(() =>
    this.submitted() && this.name().trim() === '' ? 'Enter a name.' : this.fieldError('name'),
  );

  constructor() {
    // Loads the list, and again when a filter changes.
    effect(() => {
      this.filterKey();
      untracked(() => void this.load());
    });
    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(() => this.filters.watchOverflow(this.scroll()?.nativeElement), {
      injector: this.injector,
    });
  }

  protected clear(): void {
    this.filters.clear(['q']);
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  private readonly filterKey = computed(() => JSON.stringify(this.filters.queryParams()));
  private requestId = 0;

  async load(): Promise<void> {
    const id = ++this.requestId;
    if (this.state() === 'error') this.state.set('loading');
    try {
      const page = await firstValueFrom(
        this.api.listAssetTypes(
          undefined,
          this.filters.text('name') || undefined,
          isActiveParam(parseStatus(this.filters.text('status'))),
          1,
          100,
          'sortOrder',
        ),
      );
      if (id !== this.requestId) return;
      this.rows.set(page.items);
      this.state.set('ready');
      this.filters.reportResults(page.total);
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }

  protected startCreate(): void {
    this.reset();
    const last = this.rows().at(-1);
    this.sortOrder.set((last?.sortOrder ?? 0) + 10);
    this.editingId.set(null);
    this.editing.set(true);
  }

  protected startEdit(t: AssetTypeResponse): void {
    this.reset();
    this.editingId.set(t.assetTypeId);
    this.name.set(t.name);
    this.description.set(t.description ?? '');
    this.sortOrder.set(t.sortOrder);
    this.isActive.set(t.isActive);
    this.editing.set(true);
  }

  protected cancel(): void {
    this.editing.set(false);
    this.reset();
  }

  private reset(): void {
    this.name.set('');
    this.description.set('');
    this.sortOrder.set(0);
    this.isActive.set(true);
    this.submitted.set(false);
    this.serverErrors.set({});
    this.summary.set([]);
  }

  protected async save(deactivationConfirmed = false): Promise<void> {
    this.submitted.set(true);
    this.serverErrors.set({});
    this.summary.set([]);
    if (this.name().trim() === '') {
      this.summary.set(['Enter a name.']);
      return;
    }

    const id = this.editingId();
    const original = this.rows().find((r) => r.assetTypeId === id);
    if (!deactivationConfirmed && original?.isActive && !this.isActive()) {
      this.deactivateTarget.set(original);
      this.deactivateOpen.set(true);
      return;
    }
    const description = this.description().trim() || undefined;
    this.busy.set(true);
    try {
      if (id === null) {
        const created = await firstValueFrom(
          this.api.createAssetType({
            name: this.name().trim(),
            description,
            sortOrder: this.sortOrder(),
          }),
        );
        this.announcement.set(
          `Asset type ${created.name} created. Add its fields with Edit fields.`,
        );
        this.notify.success(`Asset type ${created.name} created`);
      } else {
        const current = this.rows().find((r) => r.assetTypeId === id)!;
        const updated = await firstValueFrom(
          this.api.updateAssetType(id, {
            name: this.name().trim(),
            description,
            sortOrder: this.sortOrder(),
            isActive: this.isActive(),
            rowVersion: current.rowVersion,
          }),
        );
        this.announcement.set(`Asset type ${updated.name} saved.`);
        this.notify.success(`Asset type ${updated.name} saved`);
      }
      this.editing.set(false);
      this.reset();
      await this.load();
    } catch (err) {
      const errors = serverFormErrors(err);
      this.serverErrors.set(errors.fields);
      this.summary.set(
        errors.conflict
          ? ['Someone else changed this asset type. Cancel and reopen it to see the latest.']
          : errors.summary,
      );
    } finally {
      this.busy.set(false);
    }
  }

  /** Activating needs no confirmation; deactivating asks first. */
  protected onToggle(t: AssetTypeResponse): void {
    if (!t.isActive) {
      void this.toggleActive(t);
      return;
    }
    this.deactivateTarget.set(t);
    this.deactivateOpen.set(true);
  }

  protected confirmDeactivate(): void {
    const t = this.deactivateTarget();
    this.deactivateOpen.set(false);
    if (!t) return;
    if (this.editing() && this.editingId() === t.assetTypeId) {
      void this.save(true);
    } else {
      void this.toggleActive(t);
    }
  }

  protected async toggleActive(t: AssetTypeResponse): Promise<void> {
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.updateAssetType(t.assetTypeId, {
          name: t.name,
          description: t.description,
          sortOrder: t.sortOrder,
          isActive: !t.isActive,
          rowVersion: t.rowVersion,
        }),
      );
      this.rows.update((list) => list.map((r) => (r.assetTypeId === t.assetTypeId ? updated : r)));
      this.announcement.set(`${updated.name} ${updated.isActive ? 'activated' : 'deactivated'}.`);
    } catch {
      await this.load(); // failures are toasted by the HTTP layer; show the latest state
    } finally {
      this.busy.set(false);
    }
  }
}
