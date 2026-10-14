import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssetLookupItem, AssetsClient } from '../../api/generated/api-client';

/**
 * Supplies the Matter whose Assets a picker offers when the host cannot pass it as an input (the form engine creates pickers
 * from a type, so it can only set the documented picker inputs). The page that owns the Matter lists it in its `providers` and
 * keeps `matterId` current.
 */
@Injectable()
export class AssetPickerContext {
  readonly matterId = signal<number | null>(null);
}

interface Choice {
  id: number;
  label: string;
  detail: string;
  inactive: boolean;
}

const toChoice = (a: AssetLookupItem): Choice => ({
  id: a.assetId,
  label: a.displayName,
  detail: a.assetTypeName,
  inactive: !a.isActive,
});

/**
 * Asset typeahead limited to ONE Matter (an Asset belongs to a single Matter, and Tasks link only Assets of their own Matter).
 * Satisfies the form engine's `ReferencePicker` contract, so it is the `MF_ASSET_PICKER` implementation, and it is the picker of
 * the Task Assets tab. Inputs: `value` (asset id, two-way), `disabled`, `readOnly`, `invalid`, `inputId`, `label`, and `matterId`
 * (otherwise the `AssetPickerContext` of the host page). Keyboard: arrows move, Enter selects, Escape closes.
 */
@Component({
  selector: 'mf-asset-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (readOnly()) {
      <span data-readonly>{{
        chosen()?.label ?? (value() ? 'Asset ' + value() : 'Not provided')
      }}</span>
    } @else if (chosen(); as c) {
      <div class="ap__chosen" data-chosen>
        <span>{{ c.label }}</span>
        <span class="ap__detail">{{ c.detail }}</span>
        @if (c.inactive) {
          <span class="ap__tag">inactive</span>
        }
        @if (!disabled()) {
          <button type="button" class="ap__change" (click)="clear()">Change</button>
        }
      </div>
    } @else if (value() && !loadFailed()) {
      <span class="ap__muted" role="status">Loading asset...</span>
    } @else {
      <div class="ap__box">
        <input
          class="ap__input"
          type="text"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          [id]="inputId()"
          [attr.aria-label]="label()"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="inputId() + '-list'"
          [attr.aria-activedescendant]="active() >= 0 ? inputId() + '-opt-' + active() : null"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [disabled]="disabled() || !effectiveMatter()"
          [placeholder]="
            effectiveMatter() ? 'Search assets in this matter' : 'Choose a matter first'
          "
          [value]="text()"
          (input)="onInput($event)"
          (focus)="onFocus()"
          (keydown)="onKey($event)"
          (blur)="close()"
        />
        @if (open()) {
          <ul class="ap__list" role="listbox" [id]="inputId() + '-list'">
            @if (loading()) {
              <li class="ap__note" role="presentation">Searching...</li>
            } @else if (options().length === 0) {
              <li class="ap__note" role="presentation">No assets in this matter match.</li>
            }
            @for (o of options(); track o.id; let i = $index) {
              <li
                role="option"
                class="ap__option"
                [id]="inputId() + '-opt-' + i"
                [attr.aria-selected]="i === active()"
                [class.ap__option--active]="i === active()"
                (mousedown)="$event.preventDefault(); choose(o)"
              >
                {{ o.label }} <span class="ap__detail">{{ o.detail }}</span>
                @if (o.inactive) {
                  <span class="ap__tag">inactive</span>
                }
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .ap__box {
      position: relative;
      display: grid;
    }
    .ap__input {
      min-height: var(--mf-row-h);
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .ap__input[aria-invalid='true'] {
      border-color: var(--mf-danger);
    }
    .ap__list {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      z-index: 10;
      margin: 2px 0 0;
      padding: 0;
      list-style: none;
      max-height: 16rem;
      overflow: auto;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      box-shadow: var(--mf-shadow-2);
    }
    .ap__option,
    .ap__note {
      padding: var(--mf-s2) var(--mf-s3);
    }
    .ap__option {
      cursor: pointer;
    }
    .ap__option--active,
    .ap__option:hover {
      background: var(--mf-selected-bg);
    }
    .ap__note,
    .ap__muted,
    .ap__detail {
      color: var(--mf-text-muted);
    }
    .ap__detail {
      margin-left: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .ap__chosen {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-row-h);
    }
    .ap__change {
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    .ap__tag {
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius);
      background: var(--mf-st-cancel-bg);
      color: var(--mf-st-cancel-fg);
      font-size: var(--mf-fs-xs);
    }
  `,
})
export class AssetPicker implements OnDestroy {
  /** The selected asset id, or null. */
  readonly value = model<number | null>(null);
  readonly disabled = input(false);
  readonly readOnly = input(false);
  readonly invalid = input(false);
  readonly inputId = input('asset-picker');
  readonly label = input('Asset');
  /** The Matter to offer Assets of; falls back to the host page's `AssetPickerContext`. */
  readonly matterId = input<number | null>(null);
  /** Debounce of the search, in milliseconds. */
  readonly debounceMs = input(250);

  private readonly api = inject(AssetsClient);
  private readonly context = inject(AssetPickerContext, { optional: true });

  protected readonly effectiveMatter = computed(
    () => this.matterId() ?? this.context?.matterId() ?? null,
  );
  protected readonly text = signal('');
  protected readonly options = signal<Choice[]>([]);
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly active = signal(-1);
  protected readonly loadFailed = signal(false);
  protected readonly chosen = signal<Choice | null>(null);

  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  constructor() {
    // Show the name of a pre-set value (edit forms, read-only display).
    effect(() => {
      const id = this.value();
      untracked(() => {
        if (id === null || id === undefined) {
          this.chosen.set(null);
        } else if (this.chosen()?.id !== id) {
          void this.resolve(id);
        }
      });
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  private async resolve(id: number): Promise<void> {
    this.loadFailed.set(false);
    this.chosen.set(null);
    try {
      const asset = await firstValueFrom(this.api.getAsset(id));
      if (this.value() === id) {
        this.chosen.set({
          id,
          label: asset.displayName,
          detail: asset.assetTypeName,
          inactive: !asset.isActive,
        });
      }
    } catch {
      if (this.value() === id) this.loadFailed.set(true);
    }
  }

  protected onFocus(): void {
    if (this.text() === '' && this.options().length === 0) void this.run('');
    this.open.set(true);
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.text.set(value);
    this.open.set(true);
    this.active.set(-1);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(value), this.debounceMs());
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.options().length;
    if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault();
      this.open.set(true);
      this.active.set((this.active() + 1) % count);
    } else if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault();
      this.active.set((this.active() - 1 + count) % count);
    } else if (event.key === 'Enter' && this.active() >= 0) {
      event.preventDefault();
      this.choose(this.options()[this.active()]);
    } else if (event.key === 'Escape') {
      this.close();
    }
  }

  protected choose(option: Choice): void {
    this.chosen.set(option);
    this.value.set(option.id);
    this.text.set('');
    this.options.set([]);
    this.open.set(false);
    this.active.set(-1);
  }

  protected clear(): void {
    this.chosen.set(null);
    this.value.set(null);
  }

  protected close(): void {
    this.open.set(false);
    this.active.set(-1);
  }

  private async run(query: string): Promise<void> {
    const matter = this.effectiveMatter();
    const id = ++this.requestId;
    if (!matter) {
      this.options.set([]);
      return;
    }
    this.loading.set(true);
    try {
      const found = await firstValueFrom(
        this.api.lookupAssets(matter, query.trim() || undefined, undefined, 20),
      );
      if (id === this.requestId) this.options.set(found.map(toChoice));
    } catch {
      if (id === this.requestId) this.options.set([]);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
