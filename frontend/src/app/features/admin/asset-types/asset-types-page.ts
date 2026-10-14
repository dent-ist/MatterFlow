import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { AssetTypeResponse, AssetTypesClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { TextField } from '../../../shared/ui/text-field';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ActiveBadge } from '../../../shared/ui/badge';
import { PageHeader } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Admin: Asset Types (UX S17). Name, description, order and active flag are edited here; the type's own fields are edited in the
 * form designer (`Edit fields`), which versions them. Types are deactivated, never deleted, so existing Assets keep working.
 * Needs `AssetType.Manage`.
 */
@Component({
  selector: 'mf-asset-types-page',
  imports: [PageHeader, ActiveBadge, ConfirmDialog, ErrorReference, RouterLink, Button, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-page-header
      heading="Asset types"
      description="Each type has its own fields. Fields are versioned; changing them never alters saved values."
    >
      @if (canManage()) {
        <p-button mfActions label="New asset type" icon="pi pi-plus" (onClick)="startCreate()" />
      }
    </mf-page-header>

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
            class="pg-input"
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
        <div class="pg-actions">
          <p-button
            type="submit"
            [label]="busy() ? 'Saving...' : editingId() ? 'Save changes' : 'Create asset type'"
            [disabled]="busy()"
          />
          <p-button label="Cancel" severity="secondary" (onClick)="cancel()" />
        </div>
      </form>
    }

    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading asset types...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert">
          We couldn't load the asset types.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (rows().length === 0) {
          <div class="pg-state" data-empty>No asset types yet.</div>
        } @else {
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
                <th scope="col"><span class="pg-sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>
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
                  <td class="pg-row-actions">
                    @if (canManage()) {
                      <div class="pg-row-actions__inner">
                        <p-button
                          label="Edit"
                          size="small"
                          severity="secondary"
                          [attr.aria-label]="'Edit ' + t.name"
                          (onClick)="startEdit(t)"
                        />
                        <p-button
                          [label]="t.isActive ? 'Deactivate' : 'Activate'"
                          size="small"
                          severity="secondary"
                          [disabled]="busy()"
                          (onClick)="onToggle(t)"
                        />
                      </div>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      }
    }
  `,
  styles: `
    .pg-subtitle {
      margin: 0;
      font-size: var(--mf-fs-h3);
    }
    /* Actions stay inside the cell: the column shrinks to its buttons and they never wrap over the next row (UXR-05). */
    td.pg-row-actions {
      width: 1%;
      white-space: nowrap;
    }
    .pg-row-actions__inner {
      display: flex;
      gap: var(--mf-s2);
      justify-content: flex-end;
    }
    .pg-table {
      table-layout: auto;
    }
    td .pg-link {
      margin-left: var(--mf-s3);
    }
  `,
})
export class AssetTypesPage implements OnInit {
  private readonly api = inject(AssetTypesClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);

  protected readonly canManage = computed(() => this.auth.has('AssetType.Manage'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<AssetTypeResponse[]>([]);
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

  ngOnInit(): void {
    void this.load();
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const page = await firstValueFrom(
        this.api.listAssetTypes(undefined, undefined, 1, 100, 'sortOrder'),
      );
      this.rows.set(page.items);
      this.state.set('ready');
    } catch {
      this.state.set('error');
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
