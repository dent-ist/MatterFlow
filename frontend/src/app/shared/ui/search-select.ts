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
import { PickerOption, PickerSearch } from './entity-picker';

/**
 * A searchable dropdown (the combobox pattern of ARIA 1.2, issue #928): ONE text box that shows the choice ("All clients" while there is none), opens a list of
 * every option when it is focused or clicked, narrows the list as the person types, and closes with Escape. The first entry of the list is the "all" choice
 * (it clears the filter). Arrow keys move, Enter chooses, Tab leaves without changing anything. It looks and measures like the other filter controls (the form-field
 * control, the row height token), so a row of filters stays one height.
 *
 * The list is either given (`options`, filtered here as the person types) or asked for (`search`, called with what was typed, debounced; an empty text asks for the
 * first options). Which one is used is up to the caller: a short, known list is given; a list too long to read is asked for.
 */
@Component({
  selector: 'mf-search-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './form-field.scss',
  styles: `
    .ss__box {
      position: relative;
      display: grid;
    }
    .ss__input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      padding-right: 2rem;
      text-overflow: ellipsis;
    }
    .ss__chev {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      width: 2rem;
      justify-content: center;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      cursor: pointer;
    }
    .ss__list {
      position: absolute;
      top: 100%;
      left: 0;
      z-index: 10;
      box-sizing: border-box;
      min-width: 100%;
      max-width: min(28rem, 90vw);
      max-height: 16rem;
      margin: 2px 0 0;
      padding: 0;
      overflow: auto;
      list-style: none;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      box-shadow: var(--mf-shadow-2);
    }
    .ss__option,
    .ss__note {
      padding: var(--mf-s2) var(--mf-s3);
    }
    .ss__option {
      cursor: pointer;
    }
    .ss__option--active,
    .ss__option:hover {
      background: var(--mf-selected-bg);
    }
    .ss__option--chosen {
      font-weight: 700;
    }
    .ss__note {
      color: var(--mf-text-muted);
    }
    @media (max-width: 639.98px) {
      .ss__option,
      .ss__note {
        min-height: 44px;
        display: flex;
        align-items: center;
      }
    }
  `,
  template: `
    <div class="mf-field">
      @if (!hideLabel()) {
        <label class="mf-field__label" [attr.for]="inputId()">{{ label() }}</label>
      }
      <div class="ss__box">
        <input
          class="mf-field__input ss__input"
          type="text"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          data-search-select
          [id]="inputId()"
          [attr.aria-label]="hideLabel() ? label() : null"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="inputId() + '-list'"
          [attr.aria-activedescendant]="activeId()"
          [value]="shown()"
          (focus)="onFocus($event)"
          (click)="show()"
          (input)="onInput($event)"
          (keydown)="onKey($event)"
          (blur)="leave()"
        />
        <i class="ss__chev pi pi-chevron-down" aria-hidden="true" (mousedown)="toggle($event)"></i>
        @if (open() && rows().length > 0) {
          <ul
            class="ss__list"
            role="listbox"
            [id]="inputId() + '-list'"
            [attr.aria-label]="label()"
          >
            @for (o of rows(); track o.id ?? 'all'; let i = $index) {
              <li
                role="option"
                class="ss__option"
                [id]="inputId() + '-opt-' + i"
                [class.ss__option--active]="i === active()"
                [class.ss__option--chosen]="isChosen(o)"
                [attr.aria-selected]="isChosen(o)"
                [attr.data-option]="o.id ?? 'all'"
                (mousedown)="$event.preventDefault(); choose(o)"
              >
                {{ o.label }}
              </li>
            }
          </ul>
        } @else if (open()) {
          <!-- No option to list: the note is a status message, not a listbox without options (axe aria-required-children). -->
          <div class="ss__list ss__note" role="status" data-search-note>{{ note() }}</div>
        }
        <span class="mf-sr-only" role="status" aria-live="polite">{{ announcement() }}</span>
      </div>
    </div>
  `,
})
export class SearchSelect implements OnDestroy {
  /** The name of the field. Shown above the box, or only as its accessible name (`aria-label`) when {@link hideLabel} is set. */
  readonly label = input.required<string>();
  /** No visible label: the placeholder ("All clients") says what the box is and `label` is its accessible name (issue #941). */
  readonly hideLabel = input(false);
  readonly inputId = input.required<string>();
  /** The choice that means "no filter" ("All clients"): the first entry of the list and what the box says while nothing is chosen. */
  readonly allLabel = input.required<string>();
  /** The whole list, when it is known; narrowed here as the person types. */
  readonly options = input<readonly PickerOption[] | null>(null);
  /** The list is asked for instead (used when `options` is null). */
  readonly search = input<PickerSearch | null>(null);
  readonly debounceMs = input(250);
  readonly selected = model<PickerOption | null>(null);

  protected readonly open = signal(false);
  /** What the person typed since the list opened; null shows the choice itself. */
  protected readonly typed = signal<string | null>(null);
  protected readonly active = signal(-1);
  protected readonly loading = signal(false);
  private readonly remote = signal<readonly PickerOption[]>([]);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  /** The box shows what was typed, else the choice, else the "all" label. */
  protected readonly shown = computed(
    () => this.typed() ?? this.selected()?.label ?? this.allLabel(),
  );

  /** The options that match what was typed (a given list is narrowed here, an asked-for list already is). */
  private readonly matching = computed<readonly PickerOption[]>(() => {
    const given = this.options();
    if (given === null) return this.remote();
    const q = (this.typed() ?? '').trim().toLowerCase();
    return q === '' ? given : given.filter((o) => o.label.toLowerCase().includes(q));
  });

  /** The "all" entry, then the matches (the "all" entry stays while nothing is typed, and goes once the person is searching). */
  protected readonly rows = computed<{ id: number | null; label: string }[]>(() => {
    const searching = (this.typed() ?? '').trim() !== '';
    const all = searching ? [] : [{ id: null, label: this.allLabel() }];
    return [...all, ...this.matching()];
  });

  protected readonly note = computed(() => (this.loading() ? 'Searching...' : 'No matches.'));

  protected readonly activeId = computed(() =>
    this.open() && this.active() >= 0 ? `${this.inputId()}-opt-${this.active()}` : null,
  );

  protected readonly announcement = computed(() => {
    if (!this.open()) return '';
    const n = this.matching().length;
    return n === 0 ? 'No matches' : n === 1 ? '1 match' : `${n} matches`;
  });

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  protected isChosen(o: { id: number | null }): boolean {
    return (this.selected()?.id ?? null) === o.id;
  }

  protected onFocus(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
    this.show();
  }

  protected show(): void {
    if (this.open()) return;
    this.open.set(true);
    const at = this.rows().findIndex((o) => this.isChosen(o));
    this.active.set(at);
    if (this.options() === null) void this.run('');
  }

  protected toggle(event: MouseEvent): void {
    event.preventDefault();
    const input = this.host.nativeElement.querySelector<HTMLInputElement>('input');
    if (this.open()) {
      this.close();
    } else {
      input?.focus();
      this.show();
    }
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.typed.set(value);
    this.open.set(true);
    this.active.set(-1);
    if (this.options() === null) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.run(value), this.debounceMs());
    }
    if (this.rows().length > 0) this.active.set(0);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.rows().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) this.show();
        else if (count > 0) this.active.set((this.active() + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!this.open()) this.show();
        else if (count > 0) this.active.set((this.active() - 1 + count) % count);
        break;
      case 'Home':
      case 'End':
        // Keys of the text box (move the caret) unless the list is open and the person is not typing.
        if (this.open() && this.typed() === null && count > 0) {
          event.preventDefault();
          this.active.set(event.key === 'Home' ? 0 : count - 1);
        }
        break;
      case 'Enter':
        if (this.open() && this.active() >= 0 && this.active() < count) {
          event.preventDefault();
          this.choose(this.rows()[this.active()]);
        }
        break;
      case 'Escape':
        if (this.open()) {
          // Closes the list only: a dialog around the control (the phone's Filters sheet) stays open.
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        break;
    }
  }

  protected choose(o: { id: number | null; label: string }): void {
    this.selected.set(o.id === null ? null : (o as PickerOption));
    this.close();
  }

  protected leave(): void {
    this.close();
  }

  private close(): void {
    this.open.set(false);
    this.typed.set(null);
    this.active.set(-1);
    clearTimeout(this.timer);
  }

  private async run(query: string): Promise<void> {
    const search = this.search();
    if (!search) return;
    const id = ++this.requestId;
    this.loading.set(true);
    try {
      const found = await search(query.trim());
      if (id !== this.requestId) return;
      this.remote.set(found);
      if (this.open() && (this.typed() ?? '').trim() !== '') this.active.set(found.length ? 0 : -1);
    } catch {
      if (id === this.requestId) this.remote.set([]);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
