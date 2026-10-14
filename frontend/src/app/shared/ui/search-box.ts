import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { isSearchable } from '../search/search-meta';

/** Live search waits this long after the last key press (UXR-11). */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * The one search box for lists (UXR-11, UAT-06, UAT2-08): searches as you type after a 300 ms pause, immediately on Enter, and has a
 * clear (x) button. A hint line says so; a single letter is too short to search live, and the hint says that instead of showing nothing.
 * `value` is the committed text (from the URL); the box keeps its own draft while the user types.
 */
@Component({
  selector: 'mf-search-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sb">
      <label class="sb__label" [for]="inputId()">{{ label() }}</label>
      <div class="sb__field">
        <input
          class="sb__input"
          type="search"
          autocomplete="off"
          [id]="inputId()"
          [placeholder]="placeholder()"
          [value]="draft()"
          [attr.aria-describedby]="inputId() + '-hint'"
          (input)="onInput($any($event.target).value)"
          (keydown.enter)="$event.preventDefault(); commit($any($event.target).value)"
          (keydown.escape)="draft() && clear()"
        />
        @if (draft()) {
          <button
            type="button"
            class="sb__clear"
            [attr.aria-label]="'Clear ' + label().toLowerCase()"
            (click)="clear()"
          >
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        }
      </div>
      <span class="sb__hint" [id]="inputId() + '-hint'" data-search-hint>{{ hintText() }}</span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .sb {
      display: grid;
      gap: var(--mf-s1);
    }
    .sb__label {
      font-weight: 600;
      font-size: var(--mf-fs-sm);
    }
    .sb__field {
      position: relative;
      display: flex;
    }
    .sb__input {
      box-sizing: border-box;
      width: 100%;
      min-width: 240px;
      min-height: var(--mf-row-h);
      padding: 0 calc(var(--mf-s3) + 24px) 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    /* The browser draws its own clear glyph on type=search; ours replaces it. */
    .sb__input::-webkit-search-cancel-button {
      display: none;
    }
    .sb__clear {
      position: absolute;
      top: 50%;
      right: var(--mf-s1);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      transform: translateY(-50%);
      border: 0;
      border-radius: var(--mf-radius);
      background: transparent;
      color: var(--mf-text-muted);
      cursor: pointer;
    }
    .sb__clear:hover {
      background: var(--mf-surface-alt);
      color: var(--mf-text);
    }
    .sb__hint {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
  `,
})
export class SearchBox {
  /** The committed search text (usually the `q` query parameter). */
  readonly value = input('');
  readonly label = input('Search');
  readonly placeholder = input('');
  /** Unique id of the text input; also the prefix of the hint id. */
  readonly inputId = input.required<string>();
  /** Text after the box; the default explains live search. */
  readonly hint = input('');

  /** The text to search for (trimmed, empty when cleared). Emitted live, on Enter and on clear; never twice for the same text. */
  readonly searchChange = output<string>();

  protected readonly draft = signal('');
  private last = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected readonly tooShort = computed(() => {
    const text = this.draft().trim();
    return text.length === 1 && !isSearchable(text);
  });
  protected readonly hintText = computed(() =>
    this.tooShort()
      ? 'Type one more character to search, or press Enter to search for it now.'
      : this.hint() || 'Searches as you type. Press Enter to search now.',
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // A change of the committed value from outside (Clear filters, back button) replaces the draft.
    effect(() => {
      const committed = this.value() ?? '';
      untracked(() => {
        if (committed.trim() !== this.draft().trim()) this.draft.set(committed);
        this.last = committed.trim();
      });
    });
  }

  protected onInput(text: string): void {
    this.draft.set(text);
    clearTimeout(this.timer);
    const trimmed = text.trim();
    if (trimmed.length === 1 && !isSearchable(trimmed)) return; // too short to search live
    this.timer = setTimeout(() => this.commit(text), SEARCH_DEBOUNCE_MS);
  }

  protected commit(text: string): void {
    clearTimeout(this.timer);
    const trimmed = text.trim();
    if (trimmed === this.last) return;
    this.last = trimmed;
    this.searchChange.emit(trimmed);
  }

  protected clear(): void {
    this.draft.set('');
    this.commit('');
  }
}
