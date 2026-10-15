import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { Badge } from './badge';

/** One selectable record in an entity picker. */
export interface PickerOption {
  id: number;
  /** Primary text, for example `00343 Acme Corp`. */
  label: string;
  /** Marks inactive records (the picker shows an "inactive" tag and still lets the caller decide). */
  inactive?: boolean;
  /** A warning shown after the label with an icon (for example "Out of office until Oct 20"); the option stays selectable. */
  flag?: string;
}

export type PickerSearch = (query: string) => Promise<PickerOption[]>;

/**
 * Typeahead for Client/Matter/Project records (UX `mf-entity-picker`). Typing runs `search` (debounced); the chosen
 * record is shown as text with a "Change" action. Keyboard: Arrow keys move, Enter selects, Escape closes.
 */
@Component({
  imports: [Badge],
  selector: 'mf-entity-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mf-field">
      <label class="mf-field__label" [attr.for]="inputId()">
        {{ label() }}
        @if (required()) {
          <span class="mf-field__req">(required)</span>
        }
      </label>
      @if (selected(); as s) {
        <div class="mf-picker__chosen" data-chosen>
          <span>{{ s.label }}</span>
          @if (s.inactive) {
            <mf-badge>Inactive</mf-badge>
          }
          @if (s.flag) {
            <span class="mf-picker__flag mf-picker__flag--chosen" data-chosen-flag>
              <i class="pi pi-calendar-minus" aria-hidden="true"></i> {{ s.flag }}
            </span>
          }
          @if (!locked()) {
            <button
              type="button"
              class="mf-picker__change"
              [id]="inputId() + '-change'"
              (click)="clear()"
            >
              Change
            </button>
          }
        </div>
      } @else {
        <div class="mf-picker__box">
          <input
            class="mf-field__input"
            type="text"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            [id]="inputId()"
            [placeholder]="placeholder()"
            [attr.aria-expanded]="open()"
            [attr.aria-controls]="inputId() + '-list'"
            [attr.aria-activedescendant]="activeId()"
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.aria-describedby]="describedBy()"
            [value]="text()"
            (input)="onInput($event)"
            (keydown)="onKey($event)"
            (blur)="close()"
          />
          @if (open()) {
            <ul class="mf-picker__list" role="listbox" [id]="inputId() + '-list'">
              @if (loading()) {
                <li class="mf-picker__note" role="presentation">Searching...</li>
              } @else if (options().length === 0) {
                <li class="mf-picker__note" role="presentation">No matches.</li>
              }
              @for (o of options(); track o.id; let i = $index) {
                <li
                  role="option"
                  class="mf-picker__option"
                  [id]="inputId() + '-opt-' + i"
                  [attr.aria-selected]="i === active()"
                  [class.mf-picker__option--active]="i === active()"
                  (mousedown)="$event.preventDefault(); choose(o)"
                >
                  {{ o.label }}
                  @if (o.inactive) {
                    <mf-badge>Inactive</mf-badge>
                  }
                  @if (o.flag) {
                    <span class="mf-picker__flag" data-option-flag>
                      <i class="pi pi-calendar-minus" aria-hidden="true"></i> {{ o.flag }}
                    </span>
                  }
                </li>
              }
            </ul>
          }
        </div>
      }
      @if (help()) {
        <p class="mf-field__help" [id]="inputId() + '-help'">{{ help() }}</p>
      }
      @if (error(); as e) {
        <p class="mf-field__error" role="alert" [id]="inputId() + '-error'">
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
        </p>
      }
    </div>
  `,
  styleUrl: './form-field.scss',
  styles: `
    .mf-picker__box {
      position: relative;
      display: grid;
    }
    .mf-picker__list {
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
    .mf-picker__option,
    .mf-picker__note {
      padding: var(--mf-s2) var(--mf-s3);
    }
    .mf-picker__option {
      cursor: pointer;
    }
    .mf-picker__option--active,
    .mf-picker__option:hover {
      background: var(--mf-selected-bg);
    }
    .mf-picker__note {
      color: var(--mf-text-muted);
    }
    .mf-picker__flag--chosen {
      display: inline;
    }
    .mf-picker__flag {
      display: block;
      color: var(--mf-warning);
      font-size: var(--mf-fs-xs);
    }
    .mf-picker__chosen {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      min-height: var(--mf-row-h);
    }
    .mf-picker__change {
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class EntityPicker implements OnDestroy {
  readonly label = input.required<string>();
  readonly inputId = input.required<string>();
  readonly search = input.required<PickerSearch>();
  readonly placeholder = input('');
  readonly help = input('');
  readonly required = input(false);
  /** A locked pick (for example the Client of an existing Matter) has no "Change" action. */
  readonly locked = input(false);
  readonly error = input<string | null>(null);
  readonly debounceMs = input(250);

  readonly selected = model<PickerOption | null>(null);

  protected readonly text = signal('');
  protected readonly options = signal<PickerOption[]>([]);
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly active = signal(-1);
  protected readonly activeId = computed(() =>
    this.active() >= 0 ? `${this.inputId()}-opt-${this.active()}` : null,
  );
  protected readonly describedBy = computed(() => {
    const id = this.inputId();
    const parts = [this.error() ? `${id}-error` : null, this.help() ? `${id}-help` : null].filter(
      Boolean,
    );
    return parts.length ? parts.join(' ') : null;
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  ngOnDestroy(): void {
    clearTimeout(this.timer);
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

  protected choose(option: PickerOption): void {
    const hadFocus = this.hasFocus();
    this.selected.set(option);
    this.text.set('');
    this.options.set([]);
    this.open.set(false);
    this.active.set(-1);
    // The input is replaced by the chosen text and its Change button: keep keyboard focus in the picker (UAT2-03).
    if (hadFocus) this.focusLater(`${this.inputId()}-change`);
  }

  protected clear(): void {
    this.selected.set(null);
    this.focusLater(this.inputId());
  }

  private hasFocus(): boolean {
    const active = document.activeElement;
    return !!active && this.host.nativeElement.contains(active);
  }

  /** Focuses an element of the picker once the view has re-rendered. */
  private focusLater(id: string): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[id="${id}"]`)?.focus());
  }

  protected close(): void {
    this.open.set(false);
    this.active.set(-1);
  }

  private async run(query: string): Promise<void> {
    const id = ++this.requestId;
    if (query.trim() === '') {
      this.options.set([]);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const found = await this.search()(query.trim());
      if (id === this.requestId) {
        this.options.set(found);
        // The list may have been closed by a blur while the request ran (a dialog moving focus); the person is still typing here.
        if (this.hasFocus()) this.open.set(true);
      }
    } catch {
      if (id === this.requestId) this.options.set([]);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
