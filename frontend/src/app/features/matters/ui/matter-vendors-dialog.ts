import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  MatterVendorResponse,
  MatterVendorsClient,
  VendorLookupItem,
  VendorsClient,
} from '../../../api/generated/api-client';
import { QuietRequests } from '../../../core/http/interceptors';
import { NotificationService } from '../../../core/notify/notification.service';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { Tip } from '../../../shared/ui/tip';
import { VendorCategory } from '../../vendors/vendor-badges';
import { VENDOR_PICKER_MESSAGES, VendorPicker } from '../../vendors/vendor-picker';

/** The messages of the dialog (D-20: sentences are sentence case). */
export const VENDORS_DIALOG_MESSAGES = {
  intro:
    'Type in the last row to find a vendor and pick it. A new empty row appears after each one. Blacklisted vendors need a tick. Nothing is saved until Save Changes.',
  needTick: 'Tick the Blacklisted warning.',
  tick: 'I have read this and still want to link it',
  noReason: 'No reason is written in the vendor note.',
} as const;

/** One line of the dialog: a vendor linked to the matter, or just picked. */
interface VendorRow {
  /** Stable for the list while the dialog is open. */
  key: number;
  vendorId: number;
  name: string;
  services: string;
  category: string;
  /** The saved link, or null for a vendor picked in this dialog. */
  link: MatterVendorResponse | null;
  /** The Blacklisted warning has been read and ticked (only a vendor picked here needs it). */
  ack: boolean;
  /** The vendor's note, the reason a Blacklisted vendor is Blacklisted ('' when none; null while it loads). */
  reason: string | null;
}

/**
 * Edit Vendors (epic #1373, issue #1379; mockup screen `matter-vendors-edit`): a large (768 px) `mf-form-dialog` for the vendors of a matter, the same pattern as Edit Team. The linked vendors are a
 * list (icon, name, the muted services, the category chip, a Remove icon button); under it is ALWAYS one empty row, the vendor combobox (`mf-vendor-picker`): type to search, pick, and the vendor
 * joins the list and a new empty row appears. A vendor that is not in the list is added on the Vendors page (there is no Create option). A Blacklisted vendor that is picked shows its reason (the vendor's
 * note) and the tick "I have read this and still want to link it"; Save Changes stays disabled until it is ticked (the API also refuses without `confirmBlacklisted`). Nothing is saved until Save Changes,
 * whose footer-side summary says what will change ("2 added, 1 removed."). A dirty Cancel asks "You have unsaved changes. Discard them?" (D-31).
 *
 * Save applies the difference with the existing endpoints, one after the other: removals, then additions. When one of them fails the dialog closes, the panel reloads to show the vendors as
 * they are now, and a warning says so.
 */
@Component({
  selector: 'mf-matter-vendors-dialog',
  imports: [FormDialog, VendorPicker, VendorCategory, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .vd__intro {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .vd__heads {
      padding: 0 var(--mf-s3) var(--mf-s1);
      font-size: var(--mf-fs-sm);
      font-weight: var(--mf-fw-semibold);
    }
    .vd__rows {
      max-height: 20rem;
      overflow-y: auto;
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
    }
    .vd__rows:empty {
      display: none;
    }
    .vd__row {
      padding: var(--mf-s1) var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
    }
    .vd__row:first-child {
      border-top: 0;
    }
    .vd__row--added {
      background: var(--mf-sem-info-bg);
    }
    .vd__line {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: calc(var(--mf-ctl-h) + var(--mf-s2));
    }
    .vd__icon {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-icon-md);
    }
    .vd__text {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vd__name {
      font-weight: var(--mf-fw-semibold);
    }
    .vd__sub {
      margin-left: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .vd__warn {
      margin: 0 0 var(--mf-s2);
    }
    .vd__warn-body {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s1);
    }
    .vd__tick {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      font-weight: var(--mf-fw-semibold);
      cursor: pointer;
    }
    .vd__add {
      margin-top: var(--mf-s2);
    }
    .vd__summary {
      margin: var(--mf-s3) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <mf-form-dialog
      size="large"
      title="Edit Vendors"
      [subtitle]="matterName() + ' (' + matterRef() + ')'"
      primaryLabel="Save Changes"
      [busy]="busy()"
      [dirty]="dirty()"
      [canSubmit]="canSave()"
      focusId="vendor-add"
      [(visible)]="visible"
      (submitted)="save()"
    >
      <p class="vd__intro" data-vendors-intro>{{ intro }}</p>
      <div class="vd__heads" aria-hidden="true">Vendor</div>
      <div class="vd__rows" role="list" aria-label="Vendors on this matter" data-vendor-rows>
        @for (r of rows(); track r.key) {
          <div
            class="vd__row"
            role="listitem"
            data-vendor-row
            [class.vd__row--added]="!r.link"
            [attr.data-added]="!r.link ? '' : null"
          >
            <div class="vd__line">
              <i class="pi pi-truck vd__icon" aria-hidden="true"></i>
              <span class="vd__text" [mfTip]="r.name + (r.services ? ', ' + r.services : '')">
                <span class="vd__name" data-row-name>{{ r.name }}</span>
                <span class="vd__sub">{{ r.services }}</span>
              </span>
              @if (!r.link) {
                <span class="mf-sr-only">To be added</span>
              }
              <mf-vendor-category [category]="r.category" />
              <button
                type="button"
                class="mf-btn mf-btn--icon"
                data-remove-row
                [attr.aria-label]="'Remove ' + r.name"
                [mfTip]="'Remove ' + r.name"
                (click)="remove(r.key)"
              >
                <i class="pi pi-trash" aria-hidden="true"></i>
              </button>
            </div>
            @if (needsTick(r)) {
              <div
                class="pg-banner pg-banner--danger vd__warn"
                role="note"
                data-blacklisted-warning
              >
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                <div class="vd__warn-body">
                  <span
                    ><strong>Blacklisted.</strong>{{ ' ' }}
                    <span data-blacklisted-reason>{{ reasonOf(r) }}</span></span
                  >
                  <label class="vd__tick">
                    <input
                      type="checkbox"
                      data-blacklisted-tick
                      [checked]="r.ack"
                      (change)="setAck(r.key, $any($event.target).checked)"
                    />
                    {{ tick }}
                  </label>
                </div>
              </div>
            }
          </div>
        }
      </div>
      <div class="vd__add" data-vendor-add-row>
        <mf-vendor-picker
          inputId="vendor-add"
          label="Add a Vendor"
          [taken]="takenIds()"
          takenLabel="Linked"
          [error]="pickError()"
          (picked)="add($event)"
          (draftChange)="draftChanged($event)"
        />
      </div>
      <p class="vd__summary" data-vendors-summary role="status">{{ summary() }}</p>
    </mf-form-dialog>
  `,
})
export class MatterVendorsDialog {
  readonly matterId = input.required<number>();
  readonly matterRef = input('');
  readonly matterName = input('');
  /** The saved links (the panel's rows): the dialog starts from them each time it opens. */
  readonly vendors = input<readonly MatterVendorResponse[]>([]);
  readonly visible = model(false);
  /** The vendors changed (or a save stopped half way): the panel asks for them again. */
  readonly changed = output<void>();

  private readonly api = inject(MatterVendorsClient);
  private readonly vendorsApi = inject(VendorsClient);
  private readonly notify = inject(NotificationService);
  private readonly quiet = inject(QuietRequests);

  protected readonly intro = VENDORS_DIALOG_MESSAGES.intro;
  protected readonly tick = VENDORS_DIALOG_MESSAGES.tick;
  protected readonly rows = signal<readonly VendorRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly pickError = signal<string | null>(null);
  private readonly draft = signal('');
  private readonly removed = signal<readonly MatterVendorResponse[]>([]);
  private nextKey = 1;

  protected readonly takenIds = computed(() => this.rows().map((r) => r.vendorId));
  protected readonly changes = computed(() => ({
    added: this.rows().filter((r) => !r.link).length,
    removed: this.removed().length,
  }));
  protected readonly dirty = computed(() => {
    const c = this.changes();
    return c.added + c.removed > 0 || this.draft().trim() !== '';
  });
  /** A vendor picked here that is Blacklisted and whose warning is not ticked yet. */
  protected readonly missingTick = computed(() =>
    this.rows().some((r) => this.needsTick(r) && !r.ack),
  );
  /** Save stays disabled until something changed and every Blacklisted warning is ticked. */
  protected readonly canSave = computed(() => {
    const c = this.changes();
    return c.added + c.removed > 0 && !this.missingTick();
  });
  protected readonly summary = computed(() => {
    const c = this.changes();
    const parts = [
      c.added ? `${c.added} added` : '',
      c.removed ? `${c.removed} removed` : '',
    ].filter(Boolean);
    const done = parts.length ? parts.join(', ') + '.' : 'No changes yet.';
    return this.missingTick() ? `${done} ${VENDORS_DIALOG_MESSAGES.needTick}` : done;
  });

  constructor() {
    // Each opening starts from the saved links.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.rows.set(this.vendors().map((v) => this.savedRow(v)));
        this.removed.set([]);
        this.draft.set('');
        this.pickError.set(null);
      });
    });
  }

  private savedRow(v: MatterVendorResponse): VendorRow {
    return {
      key: this.nextKey++,
      vendorId: v.vendorId,
      name: v.name,
      services: v.services.join(', '),
      category: v.category,
      link: v,
      ack: false,
      reason: '',
    };
  }

  protected needsTick(r: VendorRow): boolean {
    return !r.link && r.category === 'BLACKLISTED';
  }

  protected reasonOf(r: VendorRow): string {
    return r.reason === null
      ? 'Loading the reason...'
      : r.reason || VENDORS_DIALOG_MESSAGES.noReason;
  }

  protected setAck(key: number, value: boolean): void {
    this.rows.update((all) => all.map((r) => (r.key === key ? { ...r, ack: value } : r)));
  }

  protected remove(key: number): void {
    const row = this.rows().find((r) => r.key === key);
    if (!row) return;
    this.rows.update((all) => all.filter((r) => r.key !== key));
    if (row.link) this.removed.update((all) => [...all, row.link!]);
  }

  /** A vendor was picked in the empty row: it joins the list; a Blacklisted one reads its reason (the vendor's note). */
  protected add(v: VendorLookupItem): void {
    if (this.rows().some((r) => r.vendorId === v.vendorId)) return;
    // A vendor unlinked in this dialog and picked again is the saved link again: nothing to add and nothing to remove.
    const back = this.removed().find((l) => l.vendorId === v.vendorId);
    if (back) {
      this.removed.update((all) => all.filter((l) => l !== back));
      this.rows.update((all) => [...all, this.savedRow(back)]);
      return;
    }
    const blacklisted = v.category === 'BLACKLISTED';
    const row: VendorRow = {
      key: this.nextKey++,
      vendorId: v.vendorId,
      name: v.name,
      services: v.services.join(', '),
      category: v.category,
      link: null,
      ack: false,
      reason: blacklisted ? null : '',
    };
    this.rows.update((all) => [...all, row]);
    if (blacklisted) void this.loadReason(row.key, v.vendorId);
  }

  private async loadReason(key: number, vendorId: number): Promise<void> {
    let reason = '';
    try {
      reason = (
        (await firstValueFrom(this.quiet.run(() => this.vendorsApi.getVendor(vendorId)))).note ?? ''
      ).trim();
    } catch {
      reason = '';
    }
    this.rows.update((all) => all.map((r) => (r.key === key ? { ...r, reason } : r)));
  }

  protected draftChanged(text: string): void {
    this.draft.set(text);
    if (this.pickError()) this.pickError.set(null);
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    // Free text is never a value: something typed in the empty row and not picked stops the save.
    if (this.draft().trim() !== '') {
      this.pickError.set(VENDOR_PICKER_MESSAGES.pick);
      return;
    }
    if (!this.canSave()) return;
    this.busy.set(true);
    let failed = false;
    try {
      for (const gone of this.removed()) {
        // The API answers 204 also when the link is already gone, so "removed by someone else" reads as success.
        await firstValueFrom(this.api.unlinkVendorFromMatter(this.matterId(), gone.vendorId));
      }
      for (const r of this.rows()) {
        if (!r.link) {
          await firstValueFrom(
            this.api.linkVendorToMatter(this.matterId(), {
              vendorId: r.vendorId,
              confirmBlacklisted: r.category === 'BLACKLISTED' && r.ack,
            }),
          );
        }
      }
    } catch {
      // The HTTP layer already toasted the reason; what was applied before the failure stays.
      failed = true;
    } finally {
      this.busy.set(false);
    }
    this.visible.set(false);
    this.changed.emit();
    if (failed) {
      this.notify.warn(
        'Vendors partly saved',
        'Some changes were not saved. The Vendors panel shows the vendors as they are now.',
      );
    } else {
      this.notify.success('Vendors saved', this.summary());
    }
  }
}
