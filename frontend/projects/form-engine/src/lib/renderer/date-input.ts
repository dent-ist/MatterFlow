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
import { formatDisplayDate, formatDisplayDateTime } from './date-format';
import { parseDateTimeText } from './date-parse';

/** Value of a native `<input type="date">` / `datetime-local` (`yyyy-mm-dd`, `yyyy-mm-ddThh:mm`) as a local Date. */
function fromNative(value: string, withTime: boolean): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!m) return null;
  return withTime
    ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0))
    : new Date(+m[1], +m[2] - 1, +m[3]);
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Native input value for a local Date: `yyyy-mm-dd`, plus `Thh:mm` when `withTime`. */
function toNative(date: Date, withTime: boolean): string {
  const day = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

/** `yyyy-MM-dd` (the storage and API form of a calendar date) as a local Date, or null. */
export function isoToDate(iso: string | null | undefined): Date | null {
  return iso ? fromNative(iso, false) : null;
}

/** A local Date as `yyyy-MM-dd`. */
export function dateToIso(date: Date): string {
  return toNative(date, false);
}

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * THE date (or date and time) control of the application (UXR-08, UAT2-02): one look and one behaviour on every screen, including the
 * form engine. Typing is parsed explicitly (`date-parse.ts`): `Oct 12, 2026`, `10/12/2026`, `10/12/26`, `2026-10-12` and `12 Oct 2026`
 * all work. The text is never rewritten while the user types; leaving the field rewrites a readable date as `Oct 12, 2026` (the way
 * the app displays dates), and text that cannot be read is KEPT and reported (inline message here, and `textInvalid`) instead of being
 * silently cleared. A format hint is always visible, and a calendar button opens the browser's own picker.
 *
 * Bind either a `Date` (`value` / `valueChange`) or a `yyyy-MM-dd` string (`isoValue` / `isoChange`, empty field = null).
 */
@Component({
  selector: 'mf-date-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="di">
      <input
        #field
        class="di__input"
        type="text"
        autocomplete="off"
        spellcheck="false"
        [id]="inputId()"
        [value]="text()"
        [placeholder]="placeholder()"
        [attr.aria-invalid]="showInvalid() ? 'true' : null"
        [attr.aria-describedby]="describedByIds()"
        (input)="onInput($any($event.target).value)"
        (blur)="commit()"
        (keydown.enter)="commit()"
      />
      <button
        type="button"
        class="di__button"
        [attr.aria-label]="pickLabel()"
        [title]="pickLabel()"
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
    <p class="di__hint" [id]="hintId()">{{ hint() }}</p>
    @if (showError() && badText()) {
      <p class="di__error" role="alert" [id]="errorId()">
        <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ errorText() }}
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .di {
      position: relative;
      display: flex;
      align-items: stretch;
      gap: var(--mf-s1, 0.25rem);
    }
    .di__input {
      flex: 1 1 auto;
      min-width: 0;
      min-height: var(--mf-row-h, 2.5rem);
      padding: 0 var(--mf-s3, 0.75rem);
      border: 1px solid var(--mf-border-strong, #6b7280);
      border-radius: var(--mf-radius, 4px);
      background: var(--mf-surface, #fff);
      color: var(--mf-text, #1b1f27);
      font: inherit;
    }
    .di__input[aria-invalid='true'] {
      border-color: var(--mf-danger, #b42318);
    }
    .di__button {
      flex: none;
      min-width: var(--mf-row-h, 2.5rem);
      border: 1px solid var(--mf-border-strong, #6b7280);
      border-radius: var(--mf-radius, 4px);
      background: var(--mf-surface, #fff);
      color: var(--mf-text, #1b1f27);
      cursor: pointer;
    }
    .di__button:hover {
      background: var(--mf-surface-alt, #eef0f4);
    }
    .di__hint,
    .di__error {
      margin: var(--mf-s1, 0.25rem) 0 0;
      font-size: var(--mf-fs-sm, 0.8125rem);
    }
    .di__hint {
      color: var(--mf-text-muted, #4b5563);
    }
    .di__error {
      color: var(--mf-danger, #b42318);
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
  /** The date as a local `Date` (use `isoValue` instead for a `yyyy-MM-dd` string). */
  readonly value = input<Date | null>(null);
  /** The date as `yyyy-MM-dd`; when this input is bound it wins over `value`. */
  readonly isoValue = input<string | null | undefined>(undefined);
  readonly withTime = input(false);
  /** The host has its own error for this field (shown by the host). */
  readonly invalid = input(false);
  /** Extra ids for `aria-describedby` (the control already references its own hint and error). */
  readonly describedBy = input('');
  /** Field label, for the calendar button's accessible name. */
  readonly label = input('date');
  /** Show the built-in message for text that is not a date. The form engine shows its own and turns this off. */
  readonly showError = input(true);
  /**
   * Emit only when the user leaves the field, presses Enter or picks from the calendar, not on every readable keystroke. Use it where
   * a change applies immediately (filters), so half-typed years like `10/1/20` never run a query.
   */
  readonly commitOnly = input(false);

  /** The date the user entered, or null when the text is empty or cannot be read. */
  readonly valueChange = output<Date | null>();
  /** Same as `valueChange`, as `yyyy-MM-dd` (or null). */
  readonly isoChange = output<string | null>();
  /** True while the field holds text that is not a date; hosts use it to block saving. */
  readonly textInvalid = output<boolean>();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly native = viewChild.required<ElementRef<HTMLInputElement>>('native');

  protected readonly text = signal('');
  protected readonly badText = signal(false);
  protected readonly placeholder = computed(() =>
    this.withTime() ? 'Oct 12, 2026, 2:30 PM' : 'Oct 12, 2026',
  );
  protected readonly hint = computed(() =>
    this.withTime()
      ? 'Type a date and time such as Oct 12, 2026, 2:30 PM or 10/12/2026 14:30, or use the calendar.'
      : 'Type a date such as Oct 12, 2026 or 10/12/2026, or use the calendar.',
  );
  protected readonly errorText = computed(() =>
    this.withTime()
      ? 'Enter a valid date and time, for example Oct 12, 2026, 2:30 PM.'
      : 'Enter a valid date, for example Oct 12, 2026 or 10/12/2026.',
  );
  protected readonly hintId = computed(() => `${this.inputId()}-hint`);
  protected readonly errorId = computed(() => `${this.inputId()}-text-error`);
  protected readonly pickLabel = computed(() => `Choose ${this.label()} from a calendar`);
  protected readonly showInvalid = computed(
    () => this.invalid() || (this.showError() && this.badText()),
  );
  protected readonly describedByIds = computed(
    () =>
      [this.hintId(), this.showError() && this.badText() ? this.errorId() : '', this.describedBy()]
        .filter(Boolean)
        .join(' ') || null,
  );
  /** The last value this control emitted, so the echo from the model does not rewrite the text being typed. */
  private lastEmitted: Date | null | undefined;

  constructor() {
    // Show a value set from outside (seed, native picker), but never overwrite what the user is typing.
    effect(() => {
      const iso = this.isoValue();
      const value = iso !== undefined ? isoToDate(iso) : this.value();
      const withTime = this.withTime();
      untracked(() => {
        if (this.lastEmitted !== undefined && sameInstant(value, this.lastEmitted)) return;
        this.lastEmitted = value;
        this.text.set(this.display(value, withTime));
        this.setBad(false);
      });
    });
  }

  private display(date: Date | null, withTime: boolean): string {
    if (!date) return '';
    return withTime ? formatDisplayDateTime(date) : formatDisplayDate(date);
  }

  /** Empties the field and any "not a date" message (for hosts that reset their form). */
  clear(): void {
    this.text.set('');
    this.setBad(false);
    this.emit(null);
  }

  protected onInput(raw: string): void {
    this.text.set(raw);
    if (this.commitOnly()) return; // the host applies the value only when the user leaves the field
    const parsed = parseDateTimeText(raw, this.withTime());
    // Pass on every reading that is valid while typing, so the form follows; the text itself is left alone.
    if (parsed || raw.trim() === '') {
      this.emit(parsed);
      this.setBad(false);
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
      this.setBad(false);
    } else if (parsed) {
      this.emit(parsed);
      this.text.set(this.display(parsed, this.withTime()));
      this.setBad(false);
    } else {
      this.emit(null);
      this.setBad(true);
    }
  }

  protected openPicker(): void {
    const el = this.native().nativeElement;
    const current = parseDateTimeText(this.field().nativeElement.value, this.withTime());
    if (current) el.value = toNative(current, this.withTime());
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
    this.text.set(this.display(date, this.withTime()));
    this.emit(date);
    this.setBad(false);
    this.field().nativeElement.focus();
  }

  private setBad(bad: boolean): void {
    if (this.badText() === bad) return;
    this.badText.set(bad);
    this.textInvalid.emit(bad);
  }

  private emit(date: Date | null): void {
    this.lastEmitted = date;
    this.valueChange.emit(date);
    this.isoChange.emit(date ? dateToIso(date) : null);
  }
}
