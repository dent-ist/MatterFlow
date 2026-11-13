import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  VendorAreasClient,
  VendorOptionView,
  VendorResponse,
  VendorServicesClient,
  VendorsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { NotificationService } from '../../core/notify/notification.service';
import { serverFormErrors } from '../../shared/forms/api-errors';
import { focusFirstInvalid } from '../../shared/forms/focus-invalid';
import { FormDialog } from '../../shared/ui/form-dialog';
import { NumericDatePipe } from '../../shared/ui/numeric-date';
import { MfTab, Tabs } from '../../shared/ui/tabs';
import { TagChip } from '../../shared/ui/tag-chip';
import { VendorCategory, vendorCategory } from './vendor-badges';
import { VendorContactsTab } from './vendor-contacts-tab';
import { VendorDraft, VendorForm, draftChanged, draftOf, emptyDraft } from './vendor-form';
import { VendorMattersTab } from './vendor-matters-tab';
import { VENDOR_MESSAGES, deleteFailure, linkedBlockText } from './vendor-text';

type TabKey = 'overview' | 'contacts' | 'matters';
type FootStep = 'none' | 'delete' | 'discard';

/** A website as a link target: only http and https are links, an address without a scheme gets https; anything else is shown as plain text. */
export function websiteHref(website: string | undefined | null): string | null {
  const w = (website ?? '').trim();
  if (!w) return null;
  if (/^https?:\/\//i.test(w)) return w;
  return /^[a-z][a-z0-9+.-]*:/i.test(w) ? null : `https://${w}`;
}

/**
 * The vendor pop-up (epic #1373, issue #1378; mockup `vendor-view`, `vendor-edit`, `vendor-new`): a large (768 px) `mf-form-dialog` in the "tabbed view dialog" shape of the guidelines. Header:
 * the vendor's name and category; under it a tab strip with Overview, Contacts (n) and Matters (n); the body scrolls inside a dialog of fixed height. It opens in VIEW mode (most visits are
 * reading); "Edit Vendor" turns the Overview tab into the form in the same dialog (the other tabs wait, the footer says Cancel and Save Changes). Footer in view mode: Delete Vendor at the left,
 * Close and Edit Vendor at the right; the delete question and the linked-matters block (409 `VENDOR_LINKED_TO_MATTERS` with the count) replace the footer buttons, so no dialog opens another
 * dialog (D-31). Without `Vendor.Manage` the same dialog is read only: no Edit, no Delete, no Add Contact or note buttons, and the footer says why. With no `vendor` it is New Vendor: the
 * same form in its own dialog, no tabs.
 */
@Component({
  selector: 'mf-vendor-dialog',
  imports: [
    FormDialog,
    Tabs,
    Button,
    TagChip,
    NumericDatePipe,
    VendorCategory,
    VendorForm,
    VendorContactsTab,
    VendorMattersTab,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .vd__tabs {
      flex: none;
      padding: 0 var(--mf-s2);
    }
    .vd__facts {
      display: grid;
      grid-template-columns: 9rem minmax(0, 1fr);
      gap: var(--mf-s3) var(--mf-s4);
      margin: 0;
    }
    .vd__facts dt {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: var(--mf-fw-semibold);
      padding-top: 2px;
    }
    .vd__facts dd {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .vd__none {
      color: var(--mf-text-muted);
    }
    .vd__tags {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .vd__ai {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .vd__note {
      margin: 0;
      white-space: pre-wrap;
    }
    .vd__banner {
      margin-bottom: var(--mf-s4);
    }
    .vd__foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
    }
    .vd__foot-text {
      flex: 1 1 18rem;
      min-width: 0;
      margin: 0;
      overflow-wrap: anywhere;
    }
    .vd__foot-text--muted {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .vd__foot-buttons {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
  `,
  template: `
    <mf-form-dialog
      size="large"
      [tabbed]="!isNew()"
      [title]="dialogTitle()"
      [subtitle]="subtitle()"
      [primaryLabel]="primaryLabel()"
      [secondaryLabel]="secondaryLabel()"
      [showPrimary]="showPrimary()"
      [ownSecondary]="editing() && !isNew()"
      [deleteLabel]="deleteLabel()"
      [footerReplaced]="footerReplaced()"
      [busy]="busy()"
      [error]="error()"
      [dirty]="editing() && dirty()"
      [focusId]="editing() ? 'vendor-name' : ''"
      [(visible)]="visible"
      (submitted)="submit()"
      (secondaryClick)="cancelEdit()"
      (deleted)="askDelete()"
    >
      @if (!isNew()) {
        <div mfDialogTabs class="vd__tabs">
          <mf-tabs
            label="Vendor"
            idPrefix="vendor"
            [tabs]="tabs()"
            [selected]="tab()"
            (tabChange)="pick($event)"
          />
        </div>
      }
      @if (editing()) {
        <div
          [attr.role]="isNew() ? null : 'tabpanel'"
          [attr.id]="isNew() ? null : 'vendor-panel'"
          [attr.aria-labelledby]="isNew() ? null : 'vendor-tab-overview'"
        >
          <mf-vendor-form
            [(draft)]="draft"
            [services]="services()"
            [areas]="areas()"
            [errors]="fieldErrors()"
          />
        </div>
      } @else if (current(); as v) {
        <div
          role="tabpanel"
          id="vendor-panel"
          [attr.aria-labelledby]="'vendor-tab-' + tab()"
          data-vendor-panel
        >
          @switch (tab()) {
            @case ('overview') {
              @if (v.category === 'BLACKLISTED') {
                <p class="pg-banner vd__banner" role="note" data-blacklisted-banner>
                  <i class="pi pi-ban" aria-hidden="true"></i>
                  <span
                    ><strong>Blacklisted.</strong> This vendor stays in lists and can still be
                    linked to a matter, but every place it appears carries this warning.</span
                  >
                </p>
              }
              <dl class="vd__facts" data-vendor-facts>
                <dt>Category</dt>
                <dd><mf-vendor-category [category]="v.category" /></dd>
                <dt>Website</dt>
                <dd data-fact-website>
                  @if (href(); as h) {
                    <a class="mf-link" [href]="h" target="_blank" rel="noopener noreferrer"
                      >{{ v.website }} <i class="pi pi-external-link" aria-hidden="true"></i
                      ><span class="mf-sr-only"> (opens in a new tab)</span></a
                    >
                  } @else if (v.website) {
                    {{ v.website }}
                  } @else {
                    <span class="vd__none">None</span>
                  }
                </dd>
                <dt>Services</dt>
                <dd data-fact-services>
                  @if (v.services.length) {
                    <ul class="vd__tags" aria-label="Services">
                      @for (s of v.services; track s.id) {
                        <li>
                          <mf-tag-chip [muted]="!s.isActive">{{ s.name }}</mf-tag-chip>
                        </li>
                      }
                    </ul>
                  } @else {
                    <span class="vd__none">None</span>
                  }
                </dd>
                <dt>Areas</dt>
                <dd data-fact-areas>
                  @if (v.areas.length) {
                    <ul class="vd__tags" aria-label="Areas">
                      @for (a of v.areas; track a.id) {
                        <li>
                          <mf-tag-chip [muted]="!a.isActive">{{ a.name }}</mf-tag-chip>
                        </li>
                      }
                    </ul>
                  } @else {
                    <span class="vd__none">None</span>
                  }
                </dd>
                <dt>Tech AI</dt>
                <dd data-fact-tech-ai>
                  @if (v.techAi.length) {
                    <ul class="vd__tags" aria-label="Tech AI">
                      @for (a of v.techAi; track a) {
                        <li>
                          <mf-tag-chip icon="pi-microchip-ai">{{ a }}</mf-tag-chip>
                        </li>
                      }
                    </ul>
                  } @else {
                    <span class="vd__none">None reported</span>
                  }
                </dd>
                <dt>Note</dt>
                <dd data-fact-note>
                  @if (v.note) {
                    <p class="vd__note">{{ v.note }}</p>
                  } @else {
                    <span class="vd__none">None</span>
                  }
                </dd>
                <dt>Last Updated</dt>
                <dd data-fact-updated>{{ v.modifiedAt | mfNum }}</dd>
              </dl>
            }
            @case ('contacts') {
              <mf-vendor-contacts-tab
                [vendorId]="v.vendorId"
                [canManage]="canManage()"
                (countChange)="contactCount.set($event)"
                (changed)="changedList.emit()"
              />
            }
            @case ('matters') {
              <mf-vendor-matters-tab
                [vendorId]="v.vendorId"
                (countChange)="matterCount.set($event)"
              />
            }
          }
        </div>
      }
      @if (footerReplaced()) {
        <div mfFooterReplace class="vd__foot" data-vendor-foot>
          @switch (step()) {
            @case ('delete') {
              @if (blockedCount() > 0) {
                <p class="vd__foot-text" role="alert" data-delete-blocked>
                  <strong>{{ current()?.name }} can't be deleted.</strong>
                  {{ blockedText() }}
                </p>
                <span class="vd__foot-buttons">
                  <p-button
                    label="Keep Vendor"
                    severity="secondary"
                    data-delete-keep
                    (onClick)="step.set('none')"
                  />
                </span>
              } @else {
                <p class="vd__foot-text" role="alert" data-delete-ask>
                  <strong>Delete {{ current()?.name }}?</strong> Its contacts stay in People. This
                  cannot be undone.
                  @if (deleteError()) {
                    <span data-delete-error> {{ deleteError() }}</span>
                  }
                </p>
                <span class="vd__foot-buttons">
                  <p-button
                    label="Keep Vendor"
                    severity="secondary"
                    data-delete-keep
                    (onClick)="step.set('none')"
                  />
                  <p-button
                    [label]="deleting() ? 'Deleting...' : 'Delete Vendor'"
                    severity="danger"
                    styleClass="mf-btn--solid"
                    data-delete-confirm
                    (onClick)="confirmDelete()"
                  />
                </span>
              }
            }
            @case ('discard') {
              <p class="vd__foot-text" role="alert" data-discard-ask>
                You have unsaved changes. Discard them?
              </p>
              <span class="vd__foot-buttons">
                <p-button
                  label="Keep Editing"
                  severity="secondary"
                  data-guard-keep
                  (onClick)="step.set('none')"
                />
                <p-button
                  label="Discard Changes"
                  severity="danger"
                  data-guard-discard
                  (onClick)="discard()"
                />
              </span>
            }
            @default {
              <p class="vd__foot-text vd__foot-text--muted" data-read-only>
                {{ readOnly }}
              </p>
              <span class="vd__foot-buttons">
                <p-button
                  label="Close"
                  severity="secondary"
                  data-panel-cancel
                  (onClick)="visible.set(false)"
                />
              </span>
            }
          }
        </div>
      }
    </mf-form-dialog>
  `,
})
export class VendorDialog {
  /** The vendor to show; null is New Vendor. */
  readonly vendor = input<VendorResponse | null>(null);
  /** Open in edit mode (the row menu's Edit Vendor). */
  readonly startInEdit = input(false);
  readonly visible = model(false);
  /** The vendor was created or saved: the page reloads its rows. */
  readonly saved = output<VendorResponse>();
  /** The vendor was deleted. */
  readonly deleted = output<void>();
  /** A contact was changed (the page reloads the counts when the dialog closes). */
  readonly changedList = output<void>();

  private readonly api = inject(VendorsClient);
  private readonly servicesApi = inject(VendorServicesClient);
  private readonly areasApi = inject(VendorAreasClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly injector = inject(Injector);

  protected readonly readOnly = VENDOR_MESSAGES.readOnly;
  protected readonly current = signal<VendorResponse | null>(null);
  protected readonly tab = signal<TabKey>('overview');
  protected readonly editing = signal(false);
  protected readonly draft = signal<VendorDraft>(emptyDraft());
  private readonly original = signal<VendorDraft>(emptyDraft());
  protected readonly services = signal<readonly VendorOptionView[]>([]);
  protected readonly areas = signal<readonly VendorOptionView[]>([]);
  protected readonly submitted = signal(false);
  protected readonly serverFields = signal<Record<string, string>>({});
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly step = signal<FootStep>('none');
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal('');
  /** The matters that block a delete: from the list row, or from the 409 answer. */
  private readonly linkedFromServer = signal(0);
  protected readonly contactCount = signal<number | null>(null);
  protected readonly matterCount = signal<number | null>(null);

  protected readonly canManage = computed(() => this.auth.has('Vendor.Manage'));
  protected readonly isNew = computed(() => this.vendor() === null);
  protected readonly dirty = computed(() => draftChanged(this.draft(), this.original()));
  protected readonly href = computed(() => websiteHref(this.current()?.website));

  protected readonly blockedCount = computed(() =>
    Math.max(this.linkedFromServer(), this.current()?.matterCount ?? 0),
  );
  protected readonly blockedText = computed(() => linkedBlockText(this.blockedCount()));

  protected readonly dialogTitle = computed(() =>
    this.isNew()
      ? 'New Vendor'
      : this.editing()
        ? 'Edit Vendor'
        : (this.current()?.name ?? 'Vendor'),
  );
  protected readonly subtitle = computed(() => {
    if (this.isNew()) return 'Contacts are added after the vendor is saved.';
    const v = this.current();
    if (!v) return '';
    return this.editing() ? v.name : vendorCategory(v.category).label;
  });
  protected readonly primaryLabel = computed(() =>
    this.isNew() ? 'Create Vendor' : this.editing() ? 'Save Changes' : 'Edit Vendor',
  );
  protected readonly secondaryLabel = computed(() =>
    this.editing() ? 'Cancel' : this.isNew() ? 'Cancel' : 'Close',
  );
  /** Edit mode and New show Save; view shows Edit Vendor for a person who may manage; read only shows nothing (the footer says why). */
  protected readonly showPrimary = computed(() => this.editing() || this.canManage());
  protected readonly deleteLabel = computed(() =>
    !this.isNew() && !this.editing() && this.canManage() ? 'Delete Vendor' : '',
  );
  /** The footer's buttons give way to a question (delete, discard) or, without Vendor.Manage, to the reason there is no Edit. */
  protected readonly footerReplaced = computed(
    () => this.step() !== 'none' || (!this.isNew() && !this.editing() && !this.canManage()),
  );

  protected readonly tabs = computed((): MfTab[] => {
    const editingNow = this.editing();
    const locked = editingNow ? 'Finish editing the vendor first.' : undefined;
    const v = this.current();
    return [
      { key: 'overview', label: 'Overview', icon: 'pi-info-circle' },
      {
        key: 'contacts',
        label: 'Contacts',
        icon: 'pi-users',
        count: this.contactCount() ?? v?.contactCount ?? 0,
        disabledReason: locked,
      },
      {
        key: 'matters',
        label: 'Matters',
        icon: 'pi-folder',
        count: this.matterCount() ?? v?.matterCount ?? 0,
        disabledReason: locked,
      },
    ];
  });

  protected readonly fieldErrors = computed((): Record<string, string> => {
    const out: Record<string, string> = { ...this.serverFields() };
    if (this.submitted() && !out['name']) {
      const own = VendorForm.nameError(this.draft());
      if (own) out['name'] = own;
    }
    return out;
  });

  constructor() {
    // Each opening starts from the vendor (or an empty New Vendor), in view mode unless asked for edit.
    effect(() => {
      if (!this.visible()) return;
      const v = this.vendor();
      const edit = this.startInEdit();
      untracked(() => {
        this.current.set(v);
        this.tab.set('overview');
        this.contactCount.set(null);
        this.matterCount.set(null);
        this.step.set('none');
        this.deleteError.set('');
        this.linkedFromServer.set(0);
        this.error.set('');
        this.submitted.set(false);
        this.serverFields.set({});
        if (v === null) this.beginEdit(emptyDraft());
        else if (edit && this.canManage()) this.beginEdit(draftOf(v));
        else this.editing.set(false);
        if (this.canManage() || v === null) void this.loadOptions();
      });
    });
    // A typed change drops the server's answer for that field.
    effect(() => {
      this.draft();
      untracked(() => {
        if (Object.keys(this.serverFields()).length) this.serverFields.set({});
      });
    });
  }

  private beginEdit(draft: VendorDraft): void {
    this.original.set(draft);
    this.draft.set(draft);
    this.editing.set(true);
    this.submitted.set(false);
    this.serverFields.set({});
    this.error.set('');
  }

  private async loadOptions(): Promise<void> {
    try {
      const [s, a] = await Promise.all([
        firstValueFrom(this.servicesApi.listVendorServices()),
        firstValueFrom(this.areasApi.listVendorAreas()),
      ]);
      this.services.set(s);
      this.areas.set(a);
    } catch {
      // The form then offers no choices; saving still works.
    }
  }

  protected pick(key: string): void {
    if (this.editing() || key === this.tab()) return;
    this.tab.set(key as TabKey);
  }

  /** The footer's primary button: New Vendor creates, edit mode saves, view mode starts editing. */
  protected submit(): void {
    if (!this.isNew() && !this.editing()) {
      const v = this.current();
      if (v && this.canManage()) {
        this.tab.set('overview');
        this.beginEdit(draftOf(v));
      }
      return;
    }
    void this.save();
  }

  /** Cancel in edit mode: back to the view, after the discard question when something was typed. */
  protected cancelEdit(): void {
    if (this.dirty()) {
      this.step.set('discard');
      return;
    }
    this.editing.set(false);
  }

  protected discard(): void {
    this.step.set('none');
    this.editing.set(false);
    this.error.set('');
  }

  private body(d: VendorDraft) {
    return {
      name: d.name.trim(),
      website: d.website.trim() || undefined,
      category: d.category,
      note: d.note.trim() || undefined,
      serviceIds: [...d.serviceIds],
      areaIds: [...d.areaIds],
      techAi: [...d.techAi],
    };
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.canManage()) return;
    this.submitted.set(true);
    if (VendorForm.nameError(this.draft())) {
      focusFirstInvalid(this.injector);
      return;
    }
    const existing = this.current();
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = existing
        ? await firstValueFrom(
            this.api.updateVendor(existing.vendorId, {
              ...this.body(this.draft()),
              rowVersion: existing.rowVersion,
            }),
          )
        : await firstValueFrom(this.api.createVendor(this.body(this.draft())));
      this.notify.success(existing ? 'Vendor updated' : 'Vendor created', `${saved.name}.`);
      this.saved.emit(saved);
      if (existing) {
        this.current.set(saved);
        this.editing.set(false);
      } else {
        this.visible.set(false);
      }
    } catch (err) {
      const failure = serverFormErrors(err);
      this.serverFields.set(failure.fields);
      if (Object.keys(failure.fields).length > 0) {
        focusFirstInvalid(this.injector);
      } else if (failure.conflict) {
        this.error.set(VENDOR_MESSAGES.conflict);
      } else {
        this.error.set(`${VENDOR_MESSAGES.failed} ${(err as Error)?.message ?? ''}`.trim());
      }
    } finally {
      this.busy.set(false);
    }
  }

  // ---- delete

  protected askDelete(): void {
    this.deleteError.set('');
    this.step.set('delete');
  }

  protected async confirmDelete(): Promise<void> {
    const v = this.current();
    if (!v || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set('');
    try {
      await firstValueFrom(this.api.deleteVendor(v.vendorId));
      this.notify.success('Vendor deleted', `${v.name} is deleted. Its contacts stay in People.`);
      this.deleted.emit();
      this.visible.set(false);
    } catch (err) {
      const failure = deleteFailure(err);
      if (failure.linked > 0) this.linkedFromServer.set(failure.linked);
      else this.deleteError.set(failure.text);
    } finally {
      this.deleting.set(false);
    }
  }
}
