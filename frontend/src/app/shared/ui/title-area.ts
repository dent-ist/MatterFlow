import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  model,
  viewChild,
} from '@angular/core';

/** The counter is announced (politely) from this many characters, and whenever the field has an error (E1, #320). */
export const COUNTER_ANNOUNCE_FROM = 180;

const PHONE_WIDTH = 420;
const PHONE_MAX_ROWS = 6;

/** `text` on one line: every run of line breaks (typed, pasted) and the spaces around it becomes a single space. */
export function stripLineBreaks(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ');
}

/**
 * A long single-line value (a task title, 200 characters) in an auto-growing textarea: `minRows` (2) growing to `maxRows` (4), then it
 * scrolls inside itself. Line breaks never get in: Enter does nothing (it does not submit either) and pasted breaks become spaces. The
 * counter "142 / 200" is always visible as text (not colour only); a polite status announces it from 180 characters and on error.
 * Same look and error pattern as `mf-text-field` (label above, error beneath); used by the Edit dialog and Create task (#320).
 */
@Component({
  selector: 'mf-title-area',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mf-field ta">
      <label class="mf-field__label" [attr.for]="inputId()">
        {{ label() }}
        @if (required()) {
          <span class="mf-field__req">(required)</span>
        }
      </label>
      <textarea
        #area
        class="mf-field__input ta__input"
        [id]="inputId()"
        [name]="inputId()"
        [rows]="minRows()"
        [attr.maxlength]="maxLength()"
        [value]="value()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="describedBy()"
        (input)="onInput()"
        (keydown.enter)="$event.preventDefault()"
      ></textarea>
      <div class="ta__foot">
        <span class="ta__count" [id]="inputId() + '-count'" data-title-count
          >{{ value().length }} / {{ maxLength() }}</span
        >
        <span class="mf-sr-only" role="status" aria-live="polite" data-title-count-live>{{
          announce()
        }}</span>
      </div>
      @if (error(); as e) {
        <p class="mf-field__error" role="alert" [id]="inputId() + '-error'">
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
        </p>
      }
    </div>
  `,
  styleUrl: './form-field.scss',
  styles: `
    .ta {
      max-width: none;
    }
    .ta__input {
      display: block;
      width: 100%;
      min-width: 0;
      resize: none;
      overflow-y: hidden;
      padding: var(--mf-s2) var(--mf-s3);
      overflow-wrap: anywhere;
    }
    .ta__foot {
      display: flex;
      justify-content: flex-end;
    }
    .ta__count {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class TitleArea implements AfterViewInit {
  readonly label = input.required<string>();
  readonly inputId = input.required<string>();
  readonly required = input(false);
  readonly maxLength = input(200);
  readonly minRows = input(2);
  readonly maxRows = input(4);
  /** Error message to show (the parent decides when: on submit or from the server). */
  readonly error = input<string | null>(null);

  readonly value = model('');

  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');

  protected readonly describedBy = computed(() => {
    const id = this.inputId();
    return [this.error() ? `${id}-error` : null, `${id}-count`].filter(Boolean).join(' ');
  });

  protected readonly announce = computed(() =>
    this.value().length >= COUNTER_ANNOUNCE_FROM || this.error()
      ? `${this.value().length} of ${this.maxLength()} characters`
      : '',
  );

  constructor() {
    // A value set from outside (the dialog opens with the saved title) re-measures the box.
    effect(() => {
      this.value();
      this.minRows();
      this.maxRows();
      queueMicrotask(() => this.grow());
    });
  }

  ngAfterViewInit(): void {
    this.grow();
  }

  protected onInput(): void {
    const el = this.area().nativeElement;
    const clean = stripLineBreaks(el.value);
    if (clean !== el.value) {
      const caret = el.selectionStart - (el.value.length - clean.length);
      el.value = clean;
      el.setSelectionRange(Math.max(0, caret), Math.max(0, caret));
    }
    this.value.set(el.value);
    this.grow();
  }

  /** Height follows the content between `minRows` and `maxRows` lines; beyond that the box scrolls inside itself. */
  private grow(): void {
    const el = this.area().nativeElement;
    if (typeof getComputedStyle !== 'function') return;
    const style = getComputedStyle(el);
    const font = parseFloat(style.fontSize) || 16;
    const lineHeight = parseFloat(style.lineHeight) || font * 1.4;
    const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const border =
      (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    const min = lineHeight * this.minRows() + pad + border;
    // 200 characters need about six lines on a phone, so the box grows further there before it scrolls.
    const rows =
      el.clientWidth < PHONE_WIDTH ? Math.max(this.maxRows(), PHONE_MAX_ROWS) : this.maxRows();
    const max = lineHeight * rows + pad + border;
    el.style.height = 'auto';
    const wanted = el.scrollHeight + border;
    const height = Math.min(Math.max(wanted, min), max);
    el.style.height = `${height}px`;
    el.style.overflowY = wanted > max + 1 ? 'auto' : 'hidden';
  }
}
