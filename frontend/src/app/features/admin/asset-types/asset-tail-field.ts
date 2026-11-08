import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { TAIL_COUNTER, TAIL_MAX_LENGTH, hasCounter } from './tail-rules';

/** A CM Number longer than this is cut with an ellipsis inside the prefix (the whole text is its tooltip) so the tail keeps at least 200 px. */
const PREFIX_MAX = 16;

/**
 * The tail of an Asset Number (#1297, spec 1.2): the matter's CM Number as a grey read-only prefix in front of one editable mono tail box, a Counter button that
 * inserts `{###}` at the caret, the help line and the one message of the first rule the tail breaks. The page owns the value and the validation; this
 * component is the field row only. Not shared: it moves to `shared/ui` only if another form needs a fixed prefix.
 */
@Component({
  selector: 'mf-asset-tail-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/form-field.scss',
  styles: `
    .atf__row {
      display: flex;
      align-items: stretch;
      height: var(--mf-ctl-h);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .atf__row:focus-within {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .atf__row--invalid {
      border-color: var(--mf-danger);
    }
    .atf__row--disabled {
      background: var(--mf-surface-alt);
    }
    .atf__prefix {
      display: flex;
      align-items: center;
      flex: 0 1 auto;
      min-width: 0;
      padding: 0 var(--mf-s2) 0 var(--mf-s3);
      border-radius: var(--mf-radius) 0 0 var(--mf-radius);
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-md);
      white-space: nowrap;
    }
    .atf__prefix-text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .atf__input {
      flex: 1 1 200px;
      min-width: 0;
      padding: 0 var(--mf-s3) 0 var(--mf-s1);
      border: 0;
      border-radius: 0 var(--mf-radius) var(--mf-radius) 0;
      background: transparent;
      color: var(--mf-text);
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-md);
      outline: 0;
    }
    .atf__input:disabled {
      color: var(--mf-text-disabled);
      cursor: not-allowed;
    }
    .atf__insert {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .atf__insert-word {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <div class="mf-field">
      <label class="mf-field__label" [attr.for]="inputId()">
        After the CM Number <span class="mf-field__req">(required)</span>
      </label>
      <div
        class="atf__row"
        [class.atf__row--invalid]="!!error()"
        [class.atf__row--disabled]="disabled()"
        data-tail-row
      >
        <span class="atf__prefix" aria-hidden="true" [attr.title]="prefixTip()" data-tail-prefix>
          <span class="atf__prefix-text">{{ prefix() }}</span>
        </span>
        <input
          #box
          class="atf__input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          [id]="inputId()"
          [attr.maxlength]="maxLength"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="error() ? inputId() + '-error' : inputId() + '-help'"
          [disabled]="disabled()"
          [value]="tail()"
          (input)="tail.set($any($event.target).value)"
          (blur)="blurred.emit()"
          data-tail-input
        />
      </div>
      @if (error(); as message) {
        <p class="mf-field__error" role="alert" [id]="inputId() + '-error'" data-tail-error>
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
          {{ message }}
        </p>
      }
      <p class="mf-field__help" [id]="inputId() + '-help'">
        The name always starts with the CM Number of the matter. Add text before or after the
        counter if you need to, for example -M-{{ '{###}' }} or _{{ '{###}' }}-A. {{ '{###}' }} is
        the counter: the number of # characters is its minimum width.
      </p>
      <div class="atf__insert">
        <span class="atf__insert-word">Insert</span>
        <button
          type="button"
          class="mf-btn"
          [disabled]="disabled() || counterPresent()"
          [attr.title]="counterPresent() ? 'The tail already has a counter.' : 'Insert {###}'"
          aria-label="Insert Counter"
          (click)="insertCounter()"
          data-insert-counter
        >
          Counter
        </button>
      </div>
    </div>
  `,
})
export class AssetTailField {
  readonly inputId = input('an-tail');
  /** The CM Number shown in the grey prefix: the sample or the real latest numbered matter. */
  readonly cmNumber = input.required<string>();
  /** The tail text. */
  readonly tail = model('');
  /** The message of the first rule the tail breaks (empty or null: valid). */
  readonly error = input<string | null>(null);
  readonly disabled = input(false);
  /** The box lost focus (the page validates from the first blur on). */
  readonly blurred = output<void>();
  /** The Counter button inserted a token (the page validates from the first insert on). */
  readonly inserted = output<void>();

  protected readonly maxLength = TAIL_MAX_LENGTH;
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  protected readonly counterPresent = computed(() => hasCounter(this.tail()));
  protected readonly prefix = computed(() => {
    const cm = this.cmNumber();
    return cm.length > PREFIX_MAX ? `${cm.slice(0, PREFIX_MAX - 1)}…` : cm;
  });
  protected readonly prefixTip = computed(() =>
    this.cmNumber().length > PREFIX_MAX ? this.cmNumber() : null,
  );

  /** Inserts `{###}` at the caret, replacing a selection, and puts the caret after it; a box that never had focus appends. */
  protected insertCounter(): void {
    const input = this.box().nativeElement;
    if (hasCounter(input.value)) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.focus();
    input.setRangeText(TAIL_COUNTER, start, end, 'end');
    this.tail.set(input.value);
    this.inserted.emit();
  }
}
