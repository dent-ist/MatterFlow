import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AssetTypeResponse,
  AssetTypesClient,
  FormOwnerKind,
  FormsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { PageTitle, shortTitleText } from '../../../core/title/page-title';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { focusFirstInvalid } from '../../../shared/forms/focus-invalid';
import {
  HasUnsavedChanges,
  LeaveConfirmService,
} from '../../../shared/guards/unsaved-changes.guard';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Crumb } from '../../../shared/ui/page-header';
import { RecordHeader, RecordAction } from '../../../shared/ui/record-header';
import { RecordSkeleton } from '../../../shared/ui/record-skeleton';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { TextField } from '../../../shared/ui/text-field';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { focusStatusAfterAction } from '../after-action';
import { ADMIN_LIST, ListReturn } from '../list-return';
import { dialogCopy } from '../shared/dialog-copy';
import { ADMIN_FIELD_LIMITS } from '../shared/field-limits';
import { FormStatusCell } from '../shared/form-status-cell';
import { notFoundError } from './asset-type-form-designer-api';

/** The tabs of the record (`?tab=`); the Assets tab is for people who may see assets. */
export type AssetTypeTab = 'overview' | 'fields' | 'assets';

export const ASSET_TYPE_TAB_LABEL: Record<AssetTypeTab, string> = {
  overview: 'Overview',
  fields: 'Fields',
  assets: 'Assets',
};

/** The tab the address asks for; a new type has the Overview only, and the Assets tab needs `Asset.View`. */
export function assetTypeTabOf(
  value: string | null | undefined,
  isNew: boolean,
  canSeeAssets: boolean,
): AssetTypeTab {
  if (isNew) return 'overview';
  if (value === 'fields') return 'fields';
  if (value === 'assets' && canSeeAssets) return 'assets';
  return 'overview';
}

/** The units of a size field: B to TB add up after conversion, Items (files, pages, documents) never mix with bytes. */
export const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'Items'] as const;

/** A first guess for the unit from the field key (`volume_gb` is GB); the person can change it. */
export function suggestUnit(key: string): string {
  const match = /_(b|kb|mb|gb|tb)$/i.exec(key);
  return match ? match[1].toUpperCase() : 'Items';
}

interface Model {
  name: string;
  description: string;
}

const EMPTY: Model = { name: '', description: '' };

const modelKey = (m: Model): string =>
  JSON.stringify({ name: m.name.trim(), description: m.description.trim() });

/**
 * Admin: the Asset Type record page (UX S17, #635, #636, #638). `/admin/asset-types/new` is the same page with a plain header. A record header
 * (name, Active / Inactive, Edit, Activity, the primary Edit fields, an overflow with Deactivate or Activate) over tabs Overview | Fields (n) |
 * Assets (n) (`?tab=`, replaced, not added). Overview is the 720 px form card (Name and Description with their counters, a validation summary at
 * the top, focus on the first field to fix, a footer that shows only while there is something to save) with the unsaved-changes guard; Fields
 * summarises the published form and the open draft; Assets counts the assets and links to them. Needs `AssetType.Manage`.
 */
@Component({
  selector: 'mf-asset-type-record-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActivityDrawer,
    ConfirmDialog,
    FormStatusCell,
    MfDatePipe,
    RecordHeader,
    RecordSkeleton,
    RecordState,
    RouterLink,
    Tabs,
    TextField,
  ],
  templateUrl: './asset-type-record-page.html',
  styleUrl: './asset-type-record-page.scss',
})
export class AssetTypeRecordPage implements HasUnsavedChanges {
  /** Route parameter `id`; absent on `/admin/asset-types/new`. */
  readonly id = input<string | undefined>(undefined);
  /** `?tab=`: `fields` or `assets`; anything else is Overview. */
  readonly tab = input<string | undefined>(undefined);

  private readonly api = inject(AssetTypesClient);
  private readonly forms = inject(FormsClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly leave = inject(LeaveConfirmService);
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);
  private readonly injector = inject(Injector);
  /** The exact list view this page was opened from: the crumb, Cancel and the links on to the designer return to it. */
  protected readonly back = new ListReturn(ADMIN_LIST.assetTypes, this.router);
  protected readonly listCrumb = this.back.crumb('Asset Types');

  /** The shared load flow of the record pages (#353): 404, 403 and failures show `mf-record-state`; the request is quiet (no toast). */
  protected readonly flow = new RecordLoadFlow('assetType');
  protected readonly state = this.flow.state;
  protected readonly assetType = signal<AssetTypeResponse | null>(null);
  protected readonly model = signal<Model>({ ...EMPTY });
  private readonly saved = signal<Model>({ ...EMPTY });
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly conflict = signal(false);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  /** The messages of the summary at the top, in field order. */
  protected readonly summary = computed(() => Object.values(this.fieldErrors()));
  protected readonly announcement = signal('');
  protected readonly activityOpen = signal(false);
  protected readonly deactivateOpen = signal(false);

  /** Size (epic #851): the NUMBER fields of the published form, the chosen default size field and unit, and the state of the two actions. */
  protected readonly numberFields = signal<{ key: string; label: string }[]>([]);
  protected readonly sizeKey = signal('');
  protected readonly sizeUnit = signal('');
  protected readonly sizeBusy = signal(false);
  protected readonly sizeError = signal('');
  protected readonly sizeUnits = SIZE_UNITS;
  protected readonly sizeDirty = computed(() => {
    const t = this.assetType();
    return (
      !!t && (this.sizeKey() !== (t.sizeFieldKey ?? '') || this.sizeUnit() !== (t.sizeUnit ?? ''))
    );
  });

  protected readonly limits = ADMIN_FIELD_LIMITS;
  protected readonly isNew = computed(() => this.id() === undefined);
  protected readonly canSeeAssets = computed(() => this.auth.has('Asset.View'));
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));
  protected readonly current = computed<AssetTypeTab>(() =>
    assetTypeTabOf(this.tab(), this.isNew(), this.canSeeAssets()),
  );
  protected readonly dirty = computed(() => modelKey(this.model()) !== modelKey(this.saved()));
  /** The footer (Save, Cancel) is there only while there is something to save: always on a new type, else when the Overview has edits. */
  protected readonly showFooter = computed(
    () => this.current() === 'overview' && (this.isNew() || this.dirty()),
  );

  /** The name the header shows: the saved one (edits in the field do not retitle the page until they are saved). */
  protected readonly headerName = computed(() =>
    this.isNew() ? 'New asset type' : (this.assetType()?.name ?? 'Asset type'),
  );
  protected readonly parents = computed<Crumb[]>(() => [
    { label: 'Administration', plain: true },
    this.listCrumb,
  ]);
  protected readonly backTo = computed(() => ({
    label: 'Asset Types',
    link: this.back.tree,
    state: this.listCrumb.state,
  }));
  protected readonly noFields = computed(() => {
    const t = this.assetType();
    return !!t && (t.publishedFormVersionNo === undefined || t.publishedFormVersionNo === null);
  });
  protected readonly fieldTotal = computed<number | undefined>(() => {
    const t = this.assetType();
    return this.noFields() ? undefined : (t?.fieldCount ?? undefined);
  });

  protected readonly tabs = computed<MfTab[]>(() => {
    const t = this.assetType();
    const list: MfTab[] = [
      { key: 'overview', label: ASSET_TYPE_TAB_LABEL.overview },
      {
        key: 'fields',
        label: ASSET_TYPE_TAB_LABEL.fields,
        ...(this.fieldTotal() !== undefined ? { count: this.fieldTotal() } : {}),
        ...(this.isNew() ? { disabledReason: 'Create the asset type first.' } : {}),
      },
    ];
    if (this.canSeeAssets()) {
      list.push({
        key: 'assets',
        label: ASSET_TYPE_TAB_LABEL.assets,
        ...(typeof t?.assetCount === 'number' ? { count: t.assetCount } : {}),
        ...(this.isNew() ? { disabledReason: 'Create the asset type first.' } : {}),
      });
    }
    return list;
  });

  /** The actions of the header: Edit, Activity, the primary Edit fields and, in the overflow, Deactivate or Activate. None on a new type. */
  protected readonly headerActions = computed<RecordAction[]>(() => {
    const t = this.assetType();
    if (!t) return [];
    const list: RecordAction[] = [
      { id: 'edit', role: 'edit', label: 'Edit', run: () => void this.editHere() },
    ];
    if (this.canSeeActivity()) {
      list.push({
        id: 'activity',
        role: 'activity',
        label: 'Activity',
        icon: 'pi-history',
        run: () => this.activityOpen.set(true),
      });
    }
    list.push({
      id: 'edit-fields',
      role: 'primary',
      label: 'Edit fields',
      icon: 'pi-pencil',
      run: () => void this.openFields(),
    });
    list.push({
      id: t.isActive ? 'deactivate' : 'activate',
      role: 'state',
      label: t.isActive ? 'Deactivate' : 'Activate',
      run: () => (t.isActive ? this.deactivateOpen.set(true) : void this.toggleActive(true)),
    });
    return list;
  });

  protected readonly deactivateCopy = computed(() =>
    dialogCopy.deactivateAssetType({ assets: this.assetType()?.assetCount ?? null }),
  );

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    // The tab title names the record, like the detail pages do, or the state ("Asset type not found", #541).
    effect(() => {
      const state = this.state();
      const name = this.assetType()?.name;
      if (state === 'notFound' || state === 'forbidden' || state === 'error') {
        this.pageTitle.set(recordStateTitle('assetType', state));
      } else if (this.isNew()) this.pageTitle.set('New asset type');
      else if (name) this.pageTitle.set(shortTitleText(name));
    });
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  readonly saveForLeaveLabel = 'Save and leave';

  /** "Save and leave" of the leave question: saves; false (the person stays) when it did not save. */
  async saveForLeave(): Promise<boolean> {
    return this.save();
  }

  protected async load(id: string | undefined): Promise<void> {
    this.failure.set('');
    this.conflict.set(false);
    await this.flow.run(
      () => {
        if (id === undefined) return Promise.resolve(null);
        // An address that is not a number names no asset type: the same 404 as an id that does not exist.
        if (!/^\d+$/.test(id))
          return Promise.reject(notFoundError(`There is no asset type '${id}'.`));
        return firstValueFrom(this.api.getAssetType(Number(id)));
      },
      (t) => {
        this.assetType.set(t);
        this.apply(t ? this.modelOf(t) : { ...EMPTY });
        this.sizeKey.set(t?.sizeFieldKey ?? '');
        this.sizeUnit.set(t?.sizeUnit ?? '');
        if (t) void this.loadNumberFields(t);
      },
    );
  }

  /** The NUMBER fields of the published form, the choices for the size field. A type without a published form has none. */
  private async loadNumberFields(t: AssetTypeResponse): Promise<void> {
    this.numberFields.set([]);
    if (t.publishedFormVersionNo === undefined || t.publishedFormVersionNo === null) return;
    try {
      const definition = await firstValueFrom(
        this.forms.findFormDefinition(FormOwnerKind.AssetType, t.assetTypeId),
      );
      const version = await firstValueFrom(
        this.forms.getPublishedFormVersion(definition.formDefinitionId),
      );
      this.numberFields.set(
        version.fields
          .filter((f) => f.control === 'NUMBER')
          .map((f) => ({ key: f.key, label: f.label })),
      );
    } catch {
      // The size card then offers no field; the rest of the page is unaffected.
      this.numberFields.set([]);
    }
  }

  protected pickSizeField(key: string): void {
    this.sizeKey.set(key);
    if (!key) {
      this.sizeUnit.set('');
    } else if (!this.sizeUnit()) {
      this.sizeUnit.set(suggestUnit(key));
    }
    this.sizeError.set('');
  }

  protected async saveSize(): Promise<void> {
    const t = this.assetType();
    if (!t || this.sizeBusy()) return;
    if (this.sizeKey() && !this.sizeUnit()) {
      this.sizeError.set('Choose the unit of the size field.');
      return;
    }
    this.sizeBusy.set(true);
    this.sizeError.set('');
    try {
      const updated = await firstValueFrom(
        this.api.setAssetTypeSizeField(t.assetTypeId, {
          sizeFieldKey: this.sizeKey() || undefined,
          sizeUnit: this.sizeUnit() || undefined,
          rowVersion: t.rowVersion,
        }),
      );
      this.assetType.set(updated);
      this.sizeKey.set(updated.sizeFieldKey ?? '');
      this.sizeUnit.set(updated.sizeUnit ?? '');
      this.announcement.set(updated.sizeFieldKey ? 'Size field saved.' : 'Size field cleared.');
      this.notify.success(updated.sizeFieldKey ? 'Size field saved.' : 'Size field cleared.');
    } catch (e) {
      const errors = serverFormErrors(e);
      if (errors.conflict) this.conflict.set(true);
      else
        this.sizeError.set(
          errors.fields['sizeFieldKey'] ??
            errors.fields['sizeUnit'] ??
            (e instanceof Error ? e.message : 'Couldn’t save the size field. Try again.'),
        );
    } finally {
      this.sizeBusy.set(false);
    }
  }

  /** Rebuilds the filter index of this type's assets from their saved values (safe to repeat). */
  protected async reindex(): Promise<void> {
    const t = this.assetType();
    if (!t || this.sizeBusy()) return;
    this.sizeBusy.set(true);
    this.sizeError.set('');
    try {
      const result = await firstValueFrom(this.api.reindexAssetType(t.assetTypeId));
      const message = `Index rebuilt for ${result.assetsProcessed} ${result.assetsProcessed === 1 ? 'asset' : 'assets'}.`;
      this.announcement.set(message);
      this.notify.success(message);
    } catch (e) {
      this.sizeError.set(e instanceof Error ? e.message : 'Couldn’t rebuild the index. Try again.');
    } finally {
      this.sizeBusy.set(false);
    }
  }

  protected retry(): void {
    void this.load(this.id());
  }

  private modelOf(t: AssetTypeResponse): Model {
    return { name: t.name, description: t.description ?? '' };
  }

  private apply(m: Model): void {
    this.model.set(m);
    this.saved.set({ ...m });
    this.fieldErrors.set({});
  }

  protected patch(change: Partial<Model>): void {
    this.model.set({ ...this.model(), ...change });
    this.fieldErrors.set({});
  }

  /** Shows the problems (summary at the top plus the message under each field) and puts focus on the first field to fix. */
  private showErrors(errors: Record<string, string>): void {
    this.fieldErrors.set(errors);
    if (this.current() !== 'overview') void this.go('overview');
    focusFirstInvalid(this.injector);
  }

  protected cancel(): void {
    if (this.isNew()) {
      void this.router.navigateByUrl(this.back.tree, { state: this.listCrumb.state });
      return;
    }
    // The edits are dropped: the record goes back to what was saved.
    this.model.set({ ...this.saved() });
    this.fieldErrors.set({});
    this.announcement.set('Changes discarded.');
  }

  /** Edit in the header: the fields are always editable, so it takes the person to the name. */
  protected async editHere(): Promise<void> {
    if (this.current() !== 'overview') await this.go('overview');
    afterNextRender(() => document.getElementById('at-name')?.focus(), {
      injector: this.injector,
    });
  }

  /** Edit fields (header and Fields tab): the form designer of the type; a dirty page asks first (the route's leave guard). */
  protected async openFields(): Promise<void> {
    const t = this.assetType();
    if (t)
      await this.router.navigate(['/admin/asset-types', t.assetTypeId, 'form'], this.back.extras);
  }

  /** Opens a tab. Edits ask first (Stay, Leave, or Save and leave). The address is replaced, not added, so Back leaves the page. */
  protected async select(key: string): Promise<boolean> {
    const to = assetTypeTabOf(key, this.isNew(), this.canSeeAssets());
    if (to === this.current()) return true;
    if (!this.isNew() && this.dirty()) {
      const leave = await this.leave.ask({
        label: this.saveForLeaveLabel,
        run: () => this.saveForLeave(),
      });
      if (!leave) return false;
      if (this.dirty()) {
        this.model.set({ ...this.saved() });
        this.fieldErrors.set({});
      }
    }
    await this.go(to);
    return true;
  }

  private go(tab: AssetTypeTab): Promise<boolean> {
    return this.router.navigate([], {
      queryParams: { tab: tab === 'overview' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Saves the form (Create on `/new`, else Save changes). Resolves true when it was saved. */
  protected async save(): Promise<boolean> {
    const m = this.model();
    const name = m.name.trim();
    if (!name) {
      this.showErrors({ name: 'Enter a name.' });
      return false;
    }
    this.busy.set(true);
    this.failure.set('');
    this.conflict.set(false);
    try {
      const current = this.assetType();
      const description = m.description.trim() || undefined;
      if (!current) {
        const created = await firstValueFrom(this.api.createAssetType({ name, description }));
        this.apply(this.modelOf(created));
        this.notify.success(`Asset type ${created.name} created`);
        // Lands on the Fields tab (the next thing to set up); the address is replaced so Back returns to where New was opened.
        await this.router.navigate(['/admin/asset-types', created.assetTypeId], {
          queryParams: { tab: 'fields' },
          replaceUrl: true,
          state: this.back.carry,
        });
        return true;
      }
      const updated = await firstValueFrom(
        this.api.updateAssetType(current.assetTypeId, {
          name,
          description,
          sortOrder: current.sortOrder,
          isActive: current.isActive,
          rowVersion: current.rowVersion,
        }),
      );
      this.assetType.set(updated);
      this.apply(this.modelOf(updated));
      this.announcement.set(`${updated.name} saved.`);
      this.notify.success('Saved.');
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private fail(e: unknown): void {
    const errors = serverFormErrors(e);
    if (errors.conflict) this.conflict.set(true);
    else if (Object.keys(errors.fields).length > 0) this.showErrors(errors.fields);
    else this.failure.set(e instanceof Error ? e.message : 'Couldn’t save. Try again.');
  }

  /** After a conflict: take the latest saved version (dropping local edits). */
  protected async reload(): Promise<void> {
    await this.load(this.id());
  }

  protected async confirmDeactivate(): Promise<void> {
    await this.toggleActive(false);
  }

  /** Deactivate or Activate from the header overflow. It changes only the state: edits in the form stay as they are. */
  protected async toggleActive(active: boolean): Promise<void> {
    const current = this.assetType();
    if (!current || this.busy()) return;
    this.busy.set(true);
    this.failure.set('');
    this.conflict.set(false);
    let done = false;
    try {
      const s = this.saved();
      const updated = await firstValueFrom(
        this.api.updateAssetType(current.assetTypeId, {
          name: s.name.trim(),
          description: s.description.trim() || undefined,
          sortOrder: current.sortOrder,
          isActive: active,
          rowVersion: current.rowVersion,
        }),
      );
      // The saved version follows the server; a form with edits keeps them.
      const keep = this.dirty() ? this.model() : null;
      this.assetType.set(updated);
      this.apply(this.modelOf(updated));
      if (keep) this.model.set(keep);
      this.announcement.set(`${updated.name} ${active ? 'activated' : 'deactivated'}.`);
      this.notify.success(active ? 'Asset type activated.' : 'Asset type deactivated.');
      done = true;
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
    // A failure keeps the dialog open with its message; a conflict means the question is stale.
    if (done || this.conflict()) this.deactivateOpen.set(false);
    if (done) focusStatusAfterAction(this.injector);
  }
}
