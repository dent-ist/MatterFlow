import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Badge, BadgeTone } from '../../shared/ui/badge';

/** What the API calls a vendor's category (`PREFERRED`, `NEUTRAL`, `BLACKLISTED`) in the words of the screens (D-12: the chip always has the icon and the word, never colour alone). */
export interface VendorCategoryView {
  label: string;
  tone: BadgeTone;
  icon: string;
}

export const VENDOR_CATEGORIES: readonly { value: string; label: string }[] = [
  { value: 'PREFERRED', label: 'Preferred' },
  { value: 'NEUTRAL', label: 'Neutral' },
  { value: 'BLACKLISTED', label: 'Blacklisted' },
];

export function vendorCategory(code: string): VendorCategoryView {
  switch (code) {
    case 'BLACKLISTED':
      return { label: 'Blacklisted', tone: 'danger', icon: 'pi-ban' };
    case 'PREFERRED':
      return { label: 'Preferred', tone: 'success', icon: 'pi-verified' };
    default:
      // Neutral is a plain, unflagged category (issue #1385): the grey badge, no warning colour.
      return { label: 'Neutral', tone: 'neutral', icon: 'pi-minus-circle' };
  }
}

/** `<mf-vendor-category [category]="v.category" />`: Preferred (green, verified icon), Neutral (grey, minus icon) or Blacklisted (red, ban icon), the one status chip (`mf-badge`). */
@Component({
  selector: 'mf-vendor-category',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-badge [tone]="view().tone" [icon]="view().icon" data-vendor-category>{{
    view().label
  }}</mf-badge>`,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
})
export class VendorCategory {
  readonly category = input.required<string>();
  protected readonly view = computed(() => vendorCategory(this.category()));
}

/** The flags of a vendor contact, in the words of the screens. `NONE` is "No note". */
export const CONTACT_FLAGS: readonly { value: string; label: string; icon: string }[] = [
  { value: 'NONE', label: 'No Note', icon: '' },
  { value: 'RECOMMENDED', label: 'Recommended', icon: 'pi-thumbs-up' },
  { value: 'DO_NOT_HIRE', label: 'Do Not Hire', icon: 'pi-ban' },
];

/** `<mf-contact-flag [flag]="c.flag" />`: Recommended (green), Do Not Hire (red) or the muted words "No note". */
@Component({
  selector: 'mf-contact-flag',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (flag()) {
      @case ('DO_NOT_HIRE') {
        <mf-badge tone="danger" icon="pi-ban" data-contact-flag="DO_NOT_HIRE">Do Not Hire</mf-badge>
      }
      @case ('RECOMMENDED') {
        <mf-badge tone="success" icon="pi-thumbs-up" data-contact-flag="RECOMMENDED"
          >Recommended</mf-badge
        >
      }
      @default {
        <span class="cf__none" data-contact-flag="NONE">No note</span>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .cf__none {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class ContactFlag {
  readonly flag = input.required<string>();
}
