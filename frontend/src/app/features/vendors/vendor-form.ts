import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { VendorOptionView, VendorResponse } from '../../api/generated/api-client';
import { Dropdown, DropdownItem } from '../../shared/ui/dropdown';
import { Segmented } from '../../shared/ui/segmented';
import { TagChip } from '../../shared/ui/tag-chip';
import { TextField } from '../../shared/ui/text-field';
import { VENDOR_MESSAGES } from './vendor-text';

/** What the form edits: a vendor as the person types it (ids of the chosen services and areas, Tech AI names). */
export interface VendorDraft {
  name: string;
  website: string;
  category: string;
  serviceIds: readonly number[];
  areaIds: readonly number[];
  techAi: readonly string[];
  note: string;
}

export const MAX_TECH_AI = 30;
export const TECH_AI_LIMIT = 200;

export function emptyDraft(): VendorDraft {
  return {
    name: '',
    website: '',
    category: 'NEUTRAL',
    serviceIds: [],
    areaIds: [],
    techAi: [],
    note: '',
  };
}

export function draftOf(v: VendorResponse): VendorDraft {
  return {
    name: v.name,
    website: v.website ?? '',
    category: v.category,
    serviceIds: v.services.map((s) => s.id),
    areaIds: v.areas.map((a) => a.id),
    techAi: [...v.techAi],
    note: v.note ?? '',
  };
}

/** Whether two drafts differ (the unsaved-changes question, D-31). */
export function draftChanged(a: VendorDraft, b: VendorDraft): boolean {
  const same = (x: readonly unknown[], y: readonly unknown[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    a.name.trim() !== b.name.trim() ||
    a.website.trim() !== b.website.trim() ||
    a.category !== b.category ||
    !same([...a.serviceIds].sort(), [...b.serviceIds].sort()) ||
    !same([...a.areaIds].sort(), [...b.areaIds].sort()) ||
    !same(a.techAi, b.techAi) ||
    a.note.trim() !== b.note.trim()
  );
}

/**
 * The vendor fields (epic #1373, issue #1378; mockup `vendor-edit`): Name and Website side by side, Category (Preferred, Neutral or Blacklisted, the segmented switch), Services and Areas (multi-select
 * dropdowns over the lists of Administration > Lists), Tech AI (a list of AI systems or services, one per line, added with the Add button) and Note. Used by New Vendor and by the Overview tab
 * of the vendor pop-up in edit mode. The page owns the draft and the save; this component only edits the draft (`draft`) and shows the errors it is given.
 */
@Component({
  selector: 'mf-vendor-form',
  imports: [TextField, Segmented, Dropdown, TagChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* A large dialog (768 px) is the standard two-column form (D-32, D-35). */
    .vf {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s4);
    }
    .vf__wide {
      grid-column: 1 / -1;
    }
    .vf__seg {
      width: fit-content;
    }
    .vf__ai {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      margin: 0 0 var(--mf-s2);
      padding: 0;
      list-style: none;
    }
    .vf__ai-none {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .vf__ai-add {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      max-width: 32rem;
    }
    .vf__ai-add mf-text-field {
      flex: 1 1 auto;
      min-width: 0;
    }
    .vf__ai-btn {
      flex: none;
      /* The label sits above the field: the button lines up with the 36 px input. */
      margin-top: calc(var(--mf-fs-md) * 1.5 + var(--mf-s1));
    }
  `,
  template: `
    <div class="vf" data-vendor-form>
      <mf-text-field
        inputId="vendor-name"
        label="Name"
        [required]="true"
        [maxLength]="200"
        [error]="errors()['name'] ?? null"
        [value]="draft().name"
        (valueChange)="patch({ name: $event })"
      />
      <mf-text-field
        inputId="vendor-website"
        label="Website"
        [maxLength]="300"
        [error]="errors()['website'] ?? null"
        [value]="draft().website"
        (valueChange)="patch({ website: $event })"
      />
      <div class="mf-field vf__wide">
        <span class="mf-field__label" id="vendor-category-label"
          >Category <span class="mf-field__req">(required)</span></span
        >
        <div
          mfSegmented
          class="vf__seg"
          role="group"
          aria-labelledby="vendor-category-label"
          data-vendor-category-switch
        >
          <button
            type="button"
            class="mf-btn"
            data-category="PREFERRED"
            [attr.aria-pressed]="draft().category === 'PREFERRED'"
            (click)="patch({ category: 'PREFERRED' })"
          >
            <i class="pi pi-verified" aria-hidden="true"></i> Preferred
          </button>
          <button
            type="button"
            class="mf-btn"
            data-category="NEUTRAL"
            [attr.aria-pressed]="draft().category === 'NEUTRAL'"
            (click)="patch({ category: 'NEUTRAL' })"
          >
            <i class="pi pi-minus-circle" aria-hidden="true"></i> Neutral
          </button>
          <button
            type="button"
            class="mf-btn"
            data-category="BLACKLISTED"
            [attr.aria-pressed]="draft().category === 'BLACKLISTED'"
            (click)="patch({ category: 'BLACKLISTED' })"
          >
            <i class="pi pi-ban" aria-hidden="true"></i> Blacklisted
          </button>
        </div>
        <span class="mf-field__help" data-category-help>{{ categoryHelp() }}</span>
        @if (errors()['category']; as e) {
          <p class="mf-field__error" role="alert">{{ e }}</p>
        }
      </div>
      <div class="mf-field">
        <span class="mf-field__label" id="vendor-services-label">Services</span>
        <mf-dropdown
          buttonId="vendor-services"
          label="Services"
          placeholder="None chosen"
          [field]="true"
          [fill]="true"
          [multi]="true"
          [neutralValue]="null"
          [items]="serviceItems()"
          [values]="serviceValues()"
          (valuesChange)="patch({ serviceIds: toIds($event) })"
        />
        <span class="mf-field__help">Pick every service the vendor offers.</span>
        @if (errors()['serviceIds']; as e) {
          <p class="mf-field__error" role="alert">{{ e }}</p>
        }
      </div>
      <div class="mf-field">
        <span class="mf-field__label" id="vendor-areas-label">Areas</span>
        <mf-dropdown
          buttonId="vendor-areas"
          label="Areas"
          placeholder="None chosen"
          [field]="true"
          [fill]="true"
          [multi]="true"
          [neutralValue]="null"
          [items]="areaItems()"
          [values]="areaValues()"
          (valuesChange)="patch({ areaIds: toIds($event) })"
        />
        <span class="mf-field__help">Where the vendor works.</span>
        @if (errors()['areaIds']; as e) {
          <p class="mf-field__error" role="alert">{{ e }}</p>
        }
      </div>
      <div class="mf-field vf__wide">
        <span class="mf-field__label" id="vendor-ai-label">Tech AI</span>
        @if (draft().techAi.length) {
          <ul class="vf__ai" aria-labelledby="vendor-ai-label" data-tech-ai-list>
            @for (a of draft().techAi; track a) {
              <li>
                <mf-tag-chip
                  icon="pi-microchip-ai"
                  [removable]="true"
                  [name]="a"
                  (remove)="dropAi(a)"
                  >{{ a }}</mf-tag-chip
                >
              </li>
            }
          </ul>
        } @else {
          <p class="vf__ai-none" data-tech-ai-none>No AI systems added.</p>
        }
        <form class="vf__ai-add" novalidate (submit)="$event.preventDefault(); addAi()">
          <mf-text-field
            inputId="vendor-ai-new"
            label="AI System or Service"
            [maxLength]="200"
            [error]="aiError() || errors()['techAi'] || null"
            [value]="aiText()"
            (valueChange)="aiText.set($event)"
          />
          <button type="submit" class="mf-btn vf__ai-btn" data-add-tech-ai>
            <i class="pi pi-plus" aria-hidden="true"></i> Add
          </button>
        </form>
        <span class="mf-field__help">For example Relativity aiR. Add one at a time.</span>
      </div>
      <div class="vf__wide">
        <mf-text-field
          inputId="vendor-note"
          label="Note"
          [multiline]="true"
          [maxLength]="2000"
          [counter]="true"
          [error]="errors()['note'] ?? null"
          [value]="draft().note"
          (valueChange)="patch({ note: $event })"
        />
      </div>
    </div>
  `,
})
export class VendorForm {
  /** The vendor being typed; the form writes every change back. */
  readonly draft = model.required<VendorDraft>();
  /** The services and areas of Administration > Lists (all of them; a deactivated one is offered only while the vendor has it). */
  readonly services = input<readonly VendorOptionView[]>([]);
  readonly areas = input<readonly VendorOptionView[]>([]);
  /** Messages by field (`name`, `website`, `category`, `serviceIds`, `areaIds`, `techAi`, `note`): the page's own and the server's. */
  readonly errors = input<Readonly<Partial<Record<string, string>>>>({});

  protected readonly categoryHelp = computed(() => {
    switch (this.draft().category) {
      case 'BLACKLISTED':
        return 'Blacklisted vendors stay visible and show a warning whenever someone links them. Put the reason in Note.';
      case 'PREFERRED':
        return 'Preferred is for a vendor the firm is happy to use.';
      default:
        return 'Neutral is the default for a vendor with no rating either way.';
    }
  });

  protected readonly aiText = signal('');
  protected readonly aiError = signal('');

  protected readonly serviceItems = computed(() =>
    this.itemsOf(this.services(), this.draft().serviceIds),
  );
  protected readonly areaItems = computed(() => this.itemsOf(this.areas(), this.draft().areaIds));
  protected readonly serviceValues = computed(() => this.draft().serviceIds.map(String));
  protected readonly areaValues = computed(() => this.draft().areaIds.map(String));

  private itemsOf(list: readonly VendorOptionView[], chosen: readonly number[]): DropdownItem[] {
    return list
      .filter((o) => o.isActive || chosen.includes(o.id))
      .map((o) => ({ value: String(o.id), label: o.isActive ? o.name : `${o.name} (inactive)` }));
  }

  protected toIds(values: readonly string[]): number[] {
    return values.map(Number).filter((n) => Number.isFinite(n));
  }

  protected patch(change: Partial<VendorDraft>): void {
    this.draft.set({ ...this.draft(), ...change });
  }

  protected addAi(): void {
    const text = this.aiText().replace(/\s+/g, ' ').trim();
    this.aiError.set('');
    if (!text) return;
    if (this.draft().techAi.some((a) => a.toLowerCase() === text.toLowerCase())) {
      this.aiError.set(`${text} is already in the list.`);
      return;
    }
    if (this.draft().techAi.length >= MAX_TECH_AI) {
      this.aiError.set(`At most ${MAX_TECH_AI} entries.`);
      return;
    }
    this.patch({ techAi: [...this.draft().techAi, text] });
    this.aiText.set('');
  }

  protected dropAi(name: string): void {
    this.patch({ techAi: this.draft().techAi.filter((a) => a !== name) });
  }

  /** The name check shared by New Vendor and Save Changes. */
  static nameError(draft: VendorDraft): string | null {
    return draft.name.trim() === '' ? VENDOR_MESSAGES.name : null;
  }
}
