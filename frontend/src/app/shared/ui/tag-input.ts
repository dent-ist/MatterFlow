import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** The limits of a step tag (the same numbers the server enforces: `StepTagRules`). */
export const TAG_MAX_LENGTH = 40;
export const TAG_MAX_COUNT = 20;

/** Trims and collapses inner whitespace. */
export function normalizeTagText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** True when the text holds a control or invisible formatting character (never allowed in a tag). */
export function hasControlCharacters(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      c <= 0x1f ||
      (c >= 0x7f && c <= 0x9f) ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x2064) ||
      c === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A free-form tag editor: type a tag and press Enter or comma to turn it into a chip (so does leaving the box), Backspace on an empty
 * box removes the last chip, every chip has a "Remove tag X" button. Suggestions (existing tags the page supplies for what was typed)
 * appear as a listbox the combobox controls with Up/Down/Enter; free text is always allowed. Tags are trimmed, inner whitespace is
 * collapsed, a tag already present (ignoring case) is not added twice, and the limits (40 characters, 20 tags, no control characters)
 * are explained inline. A polite live region announces each add and remove.
 */
@Component({
  selector: 'mf-tag-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ti">
      <label class="ti__label" [for]="inputId()">{{ label() }}</label>
      <div class="ti__anchor">
        <div class="ti__box" [class.ti__box--invalid]="!!problem() || !!error()">
          @for (tag of value(); track tag; let i = $index) {
            <span class="ti__chip" [attr.data-tag]="tag">
              <span class="ti__text" [attr.title]="tag">{{ tag }}</span>
              <button
                type="button"
                class="ti__remove"
                [attr.aria-label]="'Remove tag ' + tag"
                (click)="remove(i); $event.stopPropagation()"
              >
                <i class="pi pi-times" aria-hidden="true"></i>
              </button>
            </span>
          }
          <input
            #field
            class="ti__input"
            type="text"
            role="combobox"
            autocomplete="off"
            aria-autocomplete="list"
            [id]="inputId()"
            [attr.aria-expanded]="open()"
            [attr.aria-controls]="inputId() + '-list'"
            [attr.aria-activedescendant]="activeId()"
            [attr.aria-describedby]="describedBy()"
            [attr.aria-invalid]="problem() || error() ? 'true' : null"
            [placeholder]="value().length === 0 ? placeholder() : ''"
            [value]="draft()"
            (input)="onInput($any($event.target).value)"
            (keydown)="onKey($event)"
            (focus)="onFocus()"
            (blur)="onBlur()"
          />
        </div>
        <ul
          class="ti__list"
          role="listbox"
          [id]="inputId() + '-list'"
          [attr.aria-label]="label() + ' suggestions'"
          [hidden]="!open()"
        >
          @for (option of visible(); track option; let i = $index) {
            <li
              role="option"
              class="ti__option"
              [id]="inputId() + '-opt-' + i"
              [class.ti__option--active]="i === active()"
              [attr.aria-selected]="i === active()"
              (mousedown)="$event.preventDefault(); add(option)"
            >
              {{ option }}
            </li>
          }
        </ul>
      </div>
      @if (problem() || error(); as message) {
        <p class="ti__error" role="alert" [id]="inputId() + '-error'">
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ message }}
        </p>
      }
      <p class="ti__help" [id]="inputId() + '-help'">{{ help() }}</p>
      <p class="ti__sr" role="status" aria-live="polite" data-tag-announce>{{ announcement() }}</p>
      <p class="ti__sr" role="status" aria-live="polite" data-tag-suggestions>
        {{ suggestionStatus() }}
      </p>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .ti {
      display: grid;
      gap: var(--mf-s1);
      max-width: 480px;
    }
    .ti__anchor {
      position: relative;
    }
    .ti__label {
      font-weight: 600;
    }
    .ti__box {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1);
      box-sizing: border-box;
      min-height: var(--mf-row-h);
      padding: var(--mf-s1) var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      cursor: text;
    }
    .ti__box:focus-within {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .ti__box--invalid {
      border-color: var(--mf-danger);
    }
    .ti__chip {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface-alt);
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
      line-height: 1.5;
    }
    .ti__text {
      min-width: 0;
      padding: 0 var(--mf-s1) 0 var(--mf-s3);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ti__remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      margin-right: 2px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--mf-text-muted);
      cursor: pointer;
    }
    .ti__remove:hover {
      background: var(--mf-border);
      color: var(--mf-text);
    }
    .ti__remove:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .ti__remove .pi {
      font-size: 0.7rem;
    }
    .ti__input {
      flex: 1 1 8rem;
      min-width: 6rem;
      min-height: 28px;
      padding: 0 var(--mf-s1);
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      font-size: var(--mf-fs-md);
    }
    .ti__list {
      position: absolute;
      top: calc(100% + 2px);
      left: 0;
      z-index: 20;
      width: 100%;
      max-height: 14rem;
      margin: 0;
      padding: var(--mf-s1) 0;
      overflow: auto;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-2, var(--mf-shadow-1));
      list-style: none;
    }
    .ti__list[hidden] {
      display: none;
    }
    .ti__option {
      padding: var(--mf-s2) var(--mf-s3);
      cursor: pointer;
    }
    .ti__option:hover,
    .ti__option--active {
      background: var(--mf-surface-alt);
    }
    .ti__option--active {
      box-shadow: inset 3px 0 0 var(--mf-primary);
    }
    .ti__help,
    .ti__error {
      margin: 0;
      font-size: var(--mf-fs-sm);
    }
    .ti__help {
      color: var(--mf-text-muted);
    }
    .ti__error {
      color: var(--mf-danger);
    }
    .ti__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class TagInput {
  readonly inputId = input.required<string>();
  readonly label = input('Tags');
  readonly placeholder = input('');
  readonly help = input('');
  /** A server error for the field. */
  readonly error = input<string | null>(null);
  /** Existing tags that match what was typed (the page loads them when `queryChange` fires). */
  readonly suggestions = input<readonly string[]>([]);
  readonly maxTags = input(TAG_MAX_COUNT);
  readonly maxLength = input(TAG_MAX_LENGTH);

  /** The tags, in the order they were entered. */
  readonly value = model<string[]>([]);
  /** What the person is typing (also fires with an empty text when the box gets focus), so the page can load suggestions. */
  readonly queryChange = output<string>();

  protected readonly draft = signal('');
  protected readonly problem = signal<string | null>(null);
  protected readonly announcement = signal('');
  protected readonly active = signal(-1);
  private readonly focused = signal(false);
  private readonly closed = signal(false);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  /** Suggestions not already chosen and matching the draft, at most eight. */
  protected readonly visible = computed(() => {
    const chosen = new Set(this.value().map((t) => t.toLowerCase()));
    const needle = normalizeTagText(this.draft()).toLowerCase();
    return this.suggestions()
      .filter((s) => !chosen.has(s.toLowerCase()) && s.toLowerCase().includes(needle))
      .slice(0, 8);
  });
  protected readonly open = computed(
    () => this.focused() && !this.closed() && this.visible().length > 0,
  );
  protected readonly activeId = computed(() =>
    this.open() && this.active() >= 0 ? `${this.inputId()}-opt-${this.active()}` : null,
  );
  protected readonly suggestionStatus = computed(() => {
    if (!this.open()) return '';
    const n = this.visible().length;
    return n === 1 ? '1 suggestion available.' : `${n} suggestions available.`;
  });
  protected readonly describedBy = computed(() => {
    const id = this.inputId();
    return [this.problem() || this.error() ? `${id}-error` : null, `${id}-help`]
      .filter(Boolean)
      .join(' ');
  });

  focusInput(): void {
    this.field().nativeElement.focus();
  }

  protected onFocus(): void {
    this.focused.set(true);
    this.closed.set(false);
    this.queryChange.emit(this.draft());
  }

  protected onBlur(): void {
    this.focused.set(false);
    this.active.set(-1);
    // A tag that was typed but not confirmed is not lost when the person moves on (for example to Save).
    if (normalizeTagText(this.draft()) !== '' && this.addText(this.draft())) this.setDraft('');
  }

  protected onInput(text: string): void {
    this.problem.set(null);
    this.closed.set(false);
    this.active.set(-1);
    if (text.includes(',') || /[\r\n]/.test(text)) {
      // Typed or pasted with separators: every complete part becomes a tag, the rest stays in the box.
      const parts = text.split(/[,\r\n]/);
      const rest = parts.pop() ?? '';
      let failed = false;
      for (const part of parts) {
        if (normalizeTagText(part) !== '' && !this.addText(part)) failed = true;
      }
      this.setDraft(failed ? text : rest);
      return;
    }
    this.draft.set(text);
    this.queryChange.emit(text);
  }

  protected onKey(event: KeyboardEvent): void {
    const options = this.visible();
    switch (event.key) {
      case 'Enter': {
        const picked = this.open() && this.active() >= 0 ? options[this.active()] : null;
        if (picked) {
          event.preventDefault();
          this.add(picked);
        } else if (normalizeTagText(this.draft()) !== '') {
          event.preventDefault();
          this.add(this.draft());
        }
        break;
      }
      case ',':
        event.preventDefault();
        if (normalizeTagText(this.draft()) !== '') this.add(this.draft());
        break;
      case 'Backspace':
        if (this.draft() === '' && this.value().length > 0) {
          event.preventDefault();
          this.remove(this.value().length - 1);
        }
        break;
      case 'ArrowDown':
        if (options.length > 0) {
          event.preventDefault();
          this.closed.set(false);
          this.active.set((this.active() + 1) % options.length);
        }
        break;
      case 'ArrowUp':
        if (options.length > 0) {
          event.preventDefault();
          this.closed.set(false);
          this.active.set(this.active() <= 0 ? options.length - 1 : this.active() - 1);
        }
        break;
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.closed.set(true);
          this.active.set(-1);
        }
        break;
    }
  }

  /** Adds the text as a tag (or a suggestion, in its own spelling) and clears the box when it was accepted. */
  protected add(text: string): void {
    if (this.addText(text)) this.setDraft('');
    this.active.set(-1);
    this.focusInput();
  }

  protected remove(index: number): void {
    const tag = this.value()[index];
    if (tag === undefined) return;
    const next = this.value().filter((_, i) => i !== index);
    this.value.set(next);
    this.problem.set(null);
    this.announce(`Removed tag ${tag}. ${this.countText(next.length)}`);
    this.focusInput();
  }

  private setDraft(text: string): void {
    this.draft.set(text);
    this.field().nativeElement.value = text;
    this.queryChange.emit(text);
  }

  /** Validates and appends one tag; returns false (with the reason shown) when it was refused, true when added or already there. */
  private addText(raw: string): boolean {
    if (hasControlCharacters(raw)) {
      this.problem.set('A tag cannot contain control characters.');
      return false;
    }
    let text = normalizeTagText(raw);
    if (text === '') return true;
    if (text.length > this.maxLength()) {
      this.problem.set(
        `A tag can have at most ${this.maxLength()} characters (this one has ${text.length}).`,
      );
      return false;
    }
    const key = text.toLowerCase();
    const known = this.suggestions().find((s) => s.toLowerCase() === key);
    if (known) text = known;
    const existing = this.value().find((t) => t.toLowerCase() === key);
    if (existing) {
      this.problem.set(null);
      this.announce(`${existing} is already added.`);
      return true;
    }
    if (this.value().length >= this.maxTags()) {
      this.problem.set(
        `A step can have at most ${this.maxTags()} tags. Remove one to add another.`,
      );
      return false;
    }
    const next = [...this.value(), text];
    this.value.set(next);
    this.problem.set(null);
    this.announce(`Added tag ${text}. ${this.countText(next.length)}`);
    return true;
  }

  private countText(n: number): string {
    return n === 0 ? 'No tags.' : n === 1 ? '1 tag.' : `${n} tags.`;
  }

  private announce(text: string): void {
    // A repeated message (the same tag added twice) is still read: clear it first.
    this.announcement.set('');
    queueMicrotask(() => this.announcement.set(text));
  }
}
