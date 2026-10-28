import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { AssetDataNumberField, AssetDataTypeRow } from '../../../api/generated/api-client';
import { OptionsMenu } from '../../../shared/ui/options-menu';
import { SIZE_UNITS } from '../data-model';
import { SizeChoice } from '../data-selection';

/** The asset types that have a number field to choose from, with their fields. */
export interface SizeGroup {
  typeId: number;
  name: string;
  fields: readonly AssetDataNumberField[];
  /** The key of the type's own default size field, if it has one. */
  defaultKey: string | null;
}

/** The types of a Data answer that offer a choice: those with a number field other than the default one. */
export function sizeGroups(types: readonly AssetDataTypeRow[]): SizeGroup[] {
  return types
    .filter((t) => t.numberFields.some((f) => !f.isDefault))
    .map((t) => ({
      typeId: t.assetTypeId,
      name: t.name,
      fields: t.numberFields,
      defaultKey: t.numberFields.find((f) => f.isDefault)?.key ?? null,
    }));
}

/**
 * "Size fields" of the selection bar (epic #893, issue #931): which number fields mean size. Every asset type has its own default size field (set on the asset type);
 * here the person ticks one or more other number fields of a type to measure them as well or instead. A field that is not the default needs its unit (GB, MB, Items ...)
 * and is applied once it has one. Un-ticking every extra field goes back to the type's default. The choice belongs to the view: it is not stored on the asset type.
 */
@Component({
  selector: 'mf-data-size-pick',
  imports: [OptionsMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .sp__label {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .sp__help {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .sp__group {
      display: grid;
      gap: 0;
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .sp__group legend {
      padding: var(--mf-s1) 0;
      font-weight: 700;
    }
    .sp__row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
    }
    .sp__check {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
      cursor: pointer;
    }
    .sp__check input {
      flex: none;
      width: 16px;
      height: 16px;
      margin: 0;
    }
    .sp__tag {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    @media (max-width: 639.98px) {
      .sp__check,
      .sp__row {
        min-height: 44px;
      }
    }
  `,
  template: `
    <span class="sp__label">Size fields</span>
    <mf-options-menu
      label="Size fields"
      [text]="summary()"
      [triggerName]="summary() + ', choose size fields'"
      icon="pi-chevron-down"
      align="start"
      [wide]="wide()"
    >
      <p class="sp__help">
        Tick the number fields that mean size. Without a tick an asset type uses its own.
      </p>
      @for (g of groups(); track g.typeId) {
        <fieldset class="sp__group" [attr.data-size-type]="g.typeId">
          <legend>{{ g.name }}</legend>
          @for (f of g.fields; track f.key) {
            <div class="sp__row">
              <label class="sp__check">
                <input
                  type="checkbox"
                  [attr.data-size-field]="g.typeId + ':' + f.key"
                  [checked]="isOn(g, f.key)"
                  (change)="toggle(g, f, $event)"
                />
                <span>{{ f.label }}</span>
                @if (f.isDefault) {
                  <span class="sp__tag">default, {{ f.unit }}</span>
                }
              </label>
              @if (isOn(g, f.key) && !f.isDefault) {
                <select
                  class="mf-control mf-control--compact"
                  [attr.data-size-unit]="g.typeId + ':' + f.key"
                  [attr.aria-label]="'Unit of ' + f.label"
                  (change)="unit(g, f, $any($event.target).value)"
                >
                  <option value="" [selected]="!unitOf(g, f.key)">Choose a unit</option>
                  @for (u of units; track u) {
                    <option [value]="u" [selected]="u === unitOf(g, f.key)">{{ u }}</option>
                  }
                </select>
              }
            </div>
          }
        </fieldset>
      }
    </mf-options-menu>
  `,
})
export class DataSizePick {
  readonly types = input.required<readonly AssetDataTypeRow[]>();
  readonly choices = input<readonly SizeChoice[]>([]);
  readonly wide = input(false);
  readonly changed = output<SizeChoice[]>();

  protected readonly units = SIZE_UNITS;
  protected readonly groups = computed(() => sizeGroups(this.types()));

  /** Fields ticked whose unit is still missing: `typeId:key`. */
  private readonly pending = signal<readonly string[]>([]);

  protected readonly summary = computed(() => {
    const n = this.choices().length;
    return n === 0 ? 'Default' : `${n} ${n === 1 ? 'field' : 'fields'}`;
  });

  private explicit(g: SizeGroup): SizeChoice[] {
    return this.choices().filter((c) => c.typeId === g.typeId);
  }

  /** Ticked now: what was chosen for the type, or its default when nothing was; plus a ticked field waiting for its unit. */
  protected isOn(g: SizeGroup, key: string): boolean {
    if (this.pending().includes(`${g.typeId}:${key}`)) return true;
    const explicit = this.explicit(g);
    return explicit.length > 0 ? explicit.some((c) => c.key === key) : g.defaultKey === key;
  }

  protected unitOf(g: SizeGroup, key: string): string {
    return this.explicit(g).find((c) => c.key === key)?.unit ?? '';
  }

  /** The new choices of one type, normalised: only the default ticked is "nothing chosen". */
  private emitType(g: SizeGroup, next: SizeChoice[]): void {
    const others = this.choices().filter((c) => c.typeId !== g.typeId);
    const onlyDefault = next.length > 0 && next.every((c) => c.key === g.defaultKey);
    this.changed.emit([...others, ...(onlyDefault ? [] : next)]);
  }

  protected toggle(g: SizeGroup, f: AssetDataNumberField, event?: Event): void {
    const key = `${g.typeId}:${f.key}`;
    if (this.pending().includes(key)) {
      this.pending.update((p) => p.filter((k) => k !== key));
      return;
    }

    const on = this.isOn(g, f.key);
    // What is ticked now, as choices (the default when nothing was chosen).
    let current = this.explicit(g);
    if (current.length === 0 && g.defaultKey)
      current = [{ typeId: g.typeId, key: g.defaultKey, unit: null }];

    if (on) {
      const next = current.filter((c) => c.key !== f.key);
      if (next.length === 0) {
        // never nothing: the type keeps what it has, and the box stays ticked
        if (event) (event.target as HTMLInputElement).checked = true;
        return;
      }
      this.emitType(g, next);
      return;
    }

    if (f.isDefault) {
      this.emitType(g, [...current, { typeId: g.typeId, key: f.key, unit: null }]);
    } else {
      this.pending.update((p) => [...p, key]);
    }
  }

  protected unit(g: SizeGroup, f: AssetDataNumberField, unit: string): void {
    if (!unit) return;
    const key = `${g.typeId}:${f.key}`;
    this.pending.update((p) => p.filter((k) => k !== key));
    let current = this.explicit(g);
    if (current.length === 0 && g.defaultKey)
      current = [{ typeId: g.typeId, key: g.defaultKey, unit: null }];
    const next = current.filter((c) => c.key !== f.key);
    this.emitType(g, [...next, { typeId: g.typeId, key: f.key, unit }]);
  }
}
