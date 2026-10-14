import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { formatDateTimeText, parseDateTimeText } from './date-parse';

/** Value of a native `<input type="date">` / `datetime-local` (`yyyy-mm-dd`, `yyyy-mm-ddThh:mm`) as a local Date. */
function fromNative(value: string, withTime: boolean): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!m) return null;
  return withTime
    ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0))
    : new Date(+m[1], +m[2] - 1, +m[3]);
}

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Date (or date and time) control of the form engine (UAT2-02). Typing is parsed explicitly (`date-parse.ts`): ISO, `m/d/yyyy` and
 * `Mon d, yyyy` all work, the text is never rewritten while the user types, and text that cannot be read is KEPT and reported
 * through `textInvalid` so the form can show an inline error instead of silently clearing it. A calendar button opens the
 * browser's own date picker for people who prefer to click.
 */
@Component({
  selector: 'mf-date-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="di">
      <input
        #field
        class="p-inputtext p-component di__input"
        type="text"
        autocomplete="off"
        spellcheck="false"
        [id]="inputId()"
        [value]="text()"
        [placeholder]="placeholder()"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [attr.aria-describedby]="describedBy() || null"
        (input)="onInput($any($event.target).value)"
        (blur)="commit()"
        (keydown.enter)="commit()"
      />
      <button
        type="button"
        class="di__button"
        [attr.aria-label]="pickLabel()"
        (click)="openPicker()"
      >
        <i class="pi pi-calendar" aria-hidden="true"></i>
      </button>
      <input
        #native
        class="di__native"
        tabindex="-1"
        aria-hidden="true"
        [attr.type]="withTime() ? 'datetime-local' : 'date'"
        (change)="onNative($any($event.target).value)"
      />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .di {
      position: relative;
      display: flex;
      align-items: stretch;
      gap: 0.25rem;
    }
    .di__input {
      flex: 1 1 auto;
      min-width: 0;
    }
    .di__button {
      flex: none;
      min-width: 2.5rem;
      border: 1px solid var(--mf-border-strong, #9ca3af);
      border-radius: var(--mf-radius, 6px);
      background: var(--mf-surface, #fff);
      color: var(--mf-text, #111827);
      cursor: pointer;
    }
    .di__native {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 1px;
      height: 1px;
      padding: 0;
      border: 0;
      opacity: 0;
      pointer-events: none;
    }
  `,
})
export class DateInput {
  readonly inputId = input.required<string>();
  readonly value = input<Date | null>(null);
  readonly withTime = input(false);
  readonly invalid = input(false);
  readonly describedBy = input('');
  /** Field label, for the calendar button's accessible name. */
  readonly label = input('date');

  /** The date the user entered, or null when the text is empty or cannot be read. */
  readonly valueChange = output<Date | null>();
  /** True while the field holds text that is not a date; the host shows the error. */
  readonly textInvalid = output<boolean>();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly native = viewChild.required<ElementRef<HTMLInputElement>>('native');

  protected readonly text = signal('');
  protected readonly placeholder = computed(() =>
    this.withTime() ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd',
  );
  protected readonly pickLabel = computed(() => `Choose ${this.label()} from a calendar`);
  /** The last value this control emitted, so the echo from the model does not rewrite the text being typed. */
  private lastEmitted: Date | null | undefined;

  constructor() {
    // Show a value set from outside (seed, native picker), but never overwrite what the user is typing.
    effect(() => {
      const value = this.value();
      untracked(() => {
        if (this.lastEmitted !== undefined && sameInstant(value, this.lastEmitted)) return;
        this.lastEmitted = value;
        this.text.set(value ? formatDateTimeText(value, this.withTime()) : '');
      });
    });
  }

  protected onInput(raw: string): void {
    this.text.set(raw);
    const parsed = parseDateTimeText(raw, this.withTime());
    // Pass on every reading that is valid while typing, so the form follows; the text itself is left alone.
    if (parsed || raw.trim() === '') {
      this.emit(parsed);
      this.textInvalid.emit(false);
    } else {
      this.emit(null);
    }
  }

  /** Leaving the field (or Enter): normalise a readable date, report an unreadable one and keep its text. */
  protected commit(): void {
    const raw = this.field().nativeElement.value;
    const parsed = parseDateTimeText(raw, this.withTime());
    if (raw.trim() === '') {
      this.emit(null);
      this.textInvalid.emit(false);
    } else if (parsed) {
      this.emit(parsed);
      this.text.set(formatDateTimeText(parsed, this.withTime()));
      this.textInvalid.emit(false);
    } else {
      this.emit(null);
      this.textInvalid.emit(true);
    }
  }

  protected openPicker(): void {
    const el = this.native().nativeElement;
    const current = parseDateTimeText(this.field().nativeElement.value, this.withTime());
    if (current) {
      const day = formatDateTimeText(current, false);
      el.value = this.withTime() ? `${day}T${formatDateTimeText(current, true).slice(11)}` : day;
    }
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  }

  protected onNative(value: string): void {
    const date = fromNative(value, this.withTime());
    if (!date) return;
    this.text.set(formatDateTimeText(date, this.withTime()));
    this.emit(date);
    this.textInvalid.emit(false);
    this.field().nativeElement.focus();
  }

  private emit(date: Date | null): void {
    this.lastEmitted = date;
    this.valueChange.emit(date);
  }
}
