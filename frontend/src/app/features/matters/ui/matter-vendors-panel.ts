import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  MatterVendorResponse,
  MatterVendorsClient,
  VendorResponse,
  VendorsClient,
} from '../../../api/generated/api-client';
import { QuietRequests } from '../../../core/http/interceptors';
import { Badge } from '../../../shared/ui/badge';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { SectionPanel } from '../../../shared/ui/section-panel';
import { StateBlock } from '../../../shared/ui/state-block';
import { Tip } from '../../../shared/ui/tip';
import { panelLoader } from '../../my-matters/panel-loader';
import { VendorCategory } from '../../vendors/vendor-badges';
import { VendorDialog } from '../../vendors/vendor-dialog';
import { MatterVendorsDialog } from './matter-vendors-dialog';

/** Rows shown before "Show All N": three at 1366x768, five from 900 px of window height (the same cap as the Team panel above it). */
const TALL_WINDOW = '(min-height: 900px)';

/** The reason shown in place of Edit and "+ Engage Vendor" for a person who may read the vendors but not link them. */
export const VENDOR_LINK_REASON = 'Needs Vendor.Link';

/**
 * The Vendors panel of the matter Summary (epic #1373, issue #1379; mockup `docs/design/mockups/vendor-management`, "Summary: side column"): the second expandable panel of the side column,
 * under Team (`mf-section-panel`). The Summary shows it only to a person with `Vendor.View`; without it the Team panel takes the whole column. Header: chevron, "Vendors", the count chip, the red
 * "n Blacklisted" chip (so a fold never hides it) and the text button Edit. Rows (the API lists Blacklisted vendors first): the vendor name (a name button that opens the Vendor pop-up), a flag when a
 * contact is marked Do Not Hire, and the category chip; at most three rows (five on a tall window) and then "Show All N", which opens a read-only 768 px dialog with every vendor. Usually there is
 * none or one: no vendors is ONE line, "Vendors 0, No vendors linked, + Engage Vendor"; one is one compact row. Edit and "+ Engage Vendor" need `Vendor.Link`; without it Edit is disabled and the
 * panel footer says "Needs Vendor.Link". Edit opens `mf-matter-vendors-dialog` (changes are applied on Save). Folding is per visit.
 */
@Component({
  selector: 'mf-matter-vendors-panel',
  imports: [
    SectionPanel,
    VendorCategory,
    Badge,
    StateBlock,
    Tip,
    FormDialog,
    MatterVendorsDialog,
    VendorDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .vp__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .vp__row {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-grid-row-h-compact);
      padding: var(--mf-s1) var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
      min-width: 0;
    }
    .vp__row:hover {
      background: var(--mf-row-hover);
    }
    .vp__row--bad {
      background: var(--mf-sem-overdue-bg);
    }
    .vp__main {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
    }
    .vp__main .mf-btn {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vp__flag {
      flex: none;
      color: var(--mf-danger);
      font-size: var(--mf-icon-sm);
    }
    .vp__foot {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-grid-row-h-compact);
      padding: 0 var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
    }
    .vp__why {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .vp__why .pi {
      font-size: var(--mf-icon-sm);
    }
    .vp__sp {
      flex: 1 1 auto;
    }
    .vp__sk {
      height: var(--mf-grid-row-h-compact);
      border-top: 1px solid var(--mf-border-soft);
    }
    .vp__sk::before {
      content: '';
      display: block;
      width: 60%;
      height: var(--mf-s3);
      margin: calc((var(--mf-grid-row-h-compact) - var(--mf-s3)) / 2) var(--mf-s3);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
    }
    .vp__err {
      padding: var(--mf-s2) var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
    }
    /* Show All: the same rows without the cap, with the services in a column of their own. */
    .vp__all {
      display: block;
    }
    .vp__list--all {
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
    }
    .vp__list--all .vp__row:first-child {
      border-top: 0;
    }
    .vp__svc {
      flex: none;
      width: var(--mf-col-email-w);
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vp__heads {
      display: flex;
      gap: var(--mf-s2);
      padding: 0 var(--mf-s3) var(--mf-s1);
      font-size: var(--mf-fs-sm);
      font-weight: var(--mf-fw-semibold);
    }
    .vp__heads span:first-child {
      flex: 1 1 auto;
    }
    .vp__heads span:nth-child(2) {
      flex: none;
      width: var(--mf-col-email-w);
    }
    .vp__heads span:last-child {
      flex: none;
      width: var(--mf-col-status-w);
    }
    .vp__list--all mf-vendor-category {
      flex: none;
      width: var(--mf-col-status-w);
    }
  `,
  template: `
    <mf-section-panel
      title="Vendors"
      key="vendors"
      [count]="total()"
      [empty]="state() === 'ready' && total() === 0"
      emptyText="No vendors linked"
      [(expanded)]="open"
    >
      @if (blacklisted() > 0) {
        <mf-badge
          mfPanelChip
          tone="danger"
          icon="pi-ban"
          data-blacklisted-chip
          [mfTip]="blacklistedNames()"
          >{{ blacklisted() }} Blacklisted</mf-badge
        >
      }
      @if (state() === 'ready' && total() === 0 && !canLink()) {
        <span mfPanelAction class="vp__why" data-vendor-reason>
          <i class="pi pi-lock" aria-hidden="true"></i> {{ reason }}
        </span>
      }
      @if (state() === 'ready' && total() === 0 && canLink()) {
        <button
          mfPanelAction
          type="button"
          class="mf-btn mf-btn--text"
          aria-label="Engage a vendor"
          data-vendor-engage
          (click)="openEdit()"
        >
          <i class="pi pi-plus" aria-hidden="true"></i> Engage Vendor
        </button>
      }
      @if (state() === 'ready' && total() > 0) {
        <button
          mfPanelAction
          type="button"
          class="mf-btn mf-btn--text"
          aria-label="Edit Vendors"
          data-vendor-edit
          [attr.aria-disabled]="canLink() ? null : 'true'"
          [attr.aria-describedby]="canLink() ? null : reasonId"
          (click)="canLink() && openEdit()"
        >
          <i class="pi pi-pencil" aria-hidden="true"></i> Edit
        </button>
      }

      @if (state() === 'loading') {
        <div role="status" aria-label="Loading the vendors" data-vendors-loading>
          <div class="vp__sk"></div>
        </div>
      } @else if (state() === 'error') {
        <div class="vp__err" data-vendors-error>
          <mf-state-block kind="error">
            Couldn't load the vendors.
            <button type="button" mfStateAction class="mf-btn" (click)="vendors.load()">
              Retry
            </button>
          </mf-state-block>
        </div>
      } @else {
        <ul class="vp__list" aria-label="Linked vendors">
          @for (v of shown(); track v.vendorId) {
            <li class="vp__row" [class.vp__row--bad]="v.category === 'BLACKLISTED'" data-vendor-row>
              <span class="vp__main">
                <button
                  type="button"
                  class="mf-btn mf-btn--text mf-btn--name"
                  data-vendor-name
                  [mfTip]="v.name"
                  (click)="openVendor(v.vendorId)"
                >
                  {{ v.name }}
                </button>
              </span>
              @if (v.hasDoNotHireContact) {
                <i
                  class="pi pi-flag vp__flag"
                  data-do-not-hire
                  role="img"
                  aria-label="A contact is marked Do Not Hire"
                  mfTip="A contact is marked Do Not Hire"
                ></i>
              }
              <mf-vendor-category [category]="v.category" />
            </li>
          }
        </ul>
        @if (!canLink() || rows().length > cap()) {
          <div class="vp__foot">
            @if (!canLink()) {
              <span class="vp__why" [id]="reasonId" data-vendor-reason>
                <i class="pi pi-lock" aria-hidden="true"></i> {{ reason }}
              </span>
            }
            <span class="vp__sp"></span>
            @if (rows().length > cap()) {
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-vendors-show-all
                (click)="allOpen.set(true)"
              >
                Show All {{ total() }}
              </button>
            }
          </div>
        }
      }
    </mf-section-panel>

    @if (allOpen()) {
      <mf-form-dialog
        size="large"
        [title]="'Vendors (' + total() + ')'"
        [subtitle]="matterName() + ' (' + matterRef() + ')'"
        secondaryLabel="Close"
        [showPrimary]="false"
        [visible]="allOpen()"
        (visibleChange)="allOpen.set($event)"
      >
        <div class="vp__all" data-vendors-all>
          @if (blacklisted() > 0) {
            <p class="pg-banner pg-banner--danger" role="note" data-vendors-all-banner>
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              <span
                ><strong>{{ blacklisted() }} Blacklisted.</strong>
                {{ blacklisted() === 1 ? 'This vendor is' : 'These vendors are' }} linked to this
                matter. Review {{ blacklisted() === 1 ? 'it' : 'them' }} before more work goes
                there.</span
              >
            </p>
          }
          <div class="vp__heads" aria-hidden="true">
            <span>Vendor</span>
            <span>Services</span>
            <span>Category</span>
          </div>
          <ul class="vp__list vp__list--all" aria-label="Linked vendors">
            @for (v of rows(); track v.vendorId) {
              <li
                class="vp__row"
                [class.vp__row--bad]="v.category === 'BLACKLISTED'"
                data-vendor-all-row
              >
                <span class="vp__main">
                  <button
                    type="button"
                    class="mf-btn mf-btn--text mf-btn--name"
                    [mfTip]="v.name"
                    (click)="openVendor(v.vendorId)"
                  >
                    {{ v.name }}
                  </button>
                </span>
                @if (v.hasDoNotHireContact) {
                  <i
                    class="pi pi-flag vp__flag"
                    role="img"
                    aria-label="A contact is marked Do Not Hire"
                    mfTip="A contact is marked Do Not Hire"
                  ></i>
                }
                <span class="vp__svc" [mfTip]="v.services.join(', ')">{{
                  v.services.join(', ')
                }}</span>
                <mf-vendor-category [category]="v.category" />
              </li>
            }
          </ul>
        </div>
      </mf-form-dialog>
    }

    @if (editUsed()) {
      <mf-matter-vendors-dialog
        [matterId]="matterId()"
        [matterRef]="matterRef()"
        [matterName]="matterName()"
        [vendors]="rows()"
        [(visible)]="editOpen"
        (changed)="vendors.load()"
      />
    }

    @if (popupUsed()) {
      <mf-vendor-dialog
        [vendor]="popupVendor()"
        [(visible)]="popupOpen"
        (saved)="vendors.load()"
        (deleted)="vendors.load()"
        (changedList)="vendors.load()"
      />
    }
  `,
})
export class MatterVendorsPanel {
  readonly matterId = input.required<number>();
  /** The CM Number, the subtitle of the dialogs. */
  readonly matterRef = input('');
  readonly matterName = input('');
  /** Edit and "+ Engage Vendor" (`Vendor.Link`); without it Edit is disabled and the footer says why. */
  readonly canLink = input(false);

  private readonly api = inject(MatterVendorsClient);
  private readonly vendorsApi = inject(VendorsClient);
  private readonly quiet = inject(QuietRequests);
  private readonly destroyed = signal(false);

  protected readonly reason = VENDOR_LINK_REASON;
  protected readonly reasonId = 'vendors-panel-why';

  protected readonly vendors = panelLoader(
    () => this.matterId(),
    () => this.api.listMatterVendors(this.matterId()),
  );
  protected readonly state = this.vendors.state;
  protected readonly rows = computed<readonly MatterVendorResponse[]>(
    () => this.vendors.data() ?? [],
  );
  protected readonly total = computed(() => this.rows().length);
  protected readonly blacklisted = computed(
    () => this.rows().filter((v) => v.category === 'BLACKLISTED').length,
  );
  protected readonly blacklistedNames = computed(() =>
    this.rows()
      .filter((v) => v.category === 'BLACKLISTED')
      .map((v) => v.name)
      .join(', '),
  );

  protected readonly open = signal(true);
  protected readonly allOpen = signal(false);
  protected readonly editUsed = signal(false);
  protected readonly editOpen = signal(false);
  protected readonly popupUsed = signal(false);
  protected readonly popupOpen = signal(false);
  protected readonly popupVendor = signal<VendorResponse | null>(null);

  private readonly tall = signal(false);
  protected readonly cap = computed(() => (this.tall() ? 5 : 3));
  protected readonly shown = computed(() => this.rows().slice(0, this.cap()));

  constructor() {
    if (typeof matchMedia === 'function') {
      const query = matchMedia(TALL_WINDOW);
      this.tall.set(query.matches);
      const listener = (e: MediaQueryListEvent): void => this.tall.set(e.matches);
      query.addEventListener('change', listener);
      inject(DestroyRef).onDestroy(() => {
        this.destroyed.set(true);
        query.removeEventListener('change', listener);
      });
    }
  }

  protected openEdit(): void {
    this.editUsed.set(true);
    this.editOpen.set(true);
  }

  /** A vendor name opens the Vendor pop-up (read only without Vendor.Manage); the full record is read first. */
  protected async openVendor(vendorId: number): Promise<void> {
    try {
      const vendor = await firstValueFrom(
        this.quiet.run(() => this.vendorsApi.getVendor(vendorId)),
      );
      if (this.destroyed()) return;
      this.allOpen.set(false);
      this.popupVendor.set(vendor);
      this.popupUsed.set(true);
      this.popupOpen.set(true);
    } catch {
      // The vendor is gone or the person may not read it: the panel stays as it is and the next reload shows the truth.
      this.vendors.load();
    }
  }
}
