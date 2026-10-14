import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { normalizeNumber } from '../pipes/matter-ref.pipe';

/**
 * Why a Client/Matter number input is invalid, or `null` when it is a valid 1-5 digit number (addendum B, FND-08).
 * Copy follows the UX copy deck (8.3).
 */
export function numberProblem(raw: string | null | undefined, noun: string): string | null {
  const text = (raw ?? '').trim();
  if (text === '') return `Enter a ${noun}.`;
  if (!/^\d+$/.test(text)) return 'Use digits only.';
  if (text.length > 5) return 'Use at most 5 digits.';
  if (/^0+$/.test(text)) return 'A number cannot be all zeros.';
  return null;
}

/**
 * Number input (UX `mf-number-input`, section 5.8): accepts 1 to 5 digits, previews the zero-padded value live
 * ("Will be saved as 00343.") and replaces the text with the normalized value on blur.
 */
@Component({
  selector: 'mf-number-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mf-field">
      <label class="mf-field__label" [attr.for]="inputId()">
        {{ label() }}
        @if (required()) {
          <span class="mf-field__req">(required)</span>
        }
      </label>
      <input
        class="mf-field__input mf-field__input--mono"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        [id]="inputId()"
        [name]="inputId()"
        [disabled]="disabled()"
        [value]="value()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="describedBy()"
        (input)="onInput($event)"
        (blur)="onBlur()"
      />
      @if (!error() && normalized(); as n) {
        <p class="mf-field__preview" data-preview [id]="inputId() + '-preview'">
          Will be saved as {{ n }}.
          @if (extraPreview()) {
            {{ extraPreview() }}
          }
        </p>
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
})
export class NumberInput {
  readonly label = input.required<string>();
  /** Used in messages: "Enter a client number." */
  readonly noun = input('number');
  readonly inputId = input('mf-number');
  readonly help = input('');
  readonly required = input(true);
  readonly disabled = input(false);
  /** Extra preview text after the padded value, e.g. "Combined reference: 00343-00012". */
  readonly extraPreview = input('');
  /** Message from the server (duplicate, format) shown until the text changes. */
  readonly serverError = input<string | null>(null);
  /** Parent sets this on submit so untouched fields show their errors. */
  readonly showErrors = input(false);

  readonly value = model('');

  protected readonly touched = signal(false);
  private readonly editedSinceServerError = signal(false);

  protected readonly normalized = computed(() => normalizeNumber(this.value()));
  protected readonly problem = computed(() => numberProblem(this.value(), this.noun()));
  protected readonly error = computed(() => {
    if (this.touched() || this.showErrors()) {
      const problem = this.problem();
      if (problem) return problem;
    }
    return this.editedSinceServerError() ? null : this.serverError();
  });
  protected readonly describedBy = computed(() => {
    const id = this.inputId();
    const parts = [this.error() ? `${id}-error` : null, this.help() ? `${id}-help` : null].filter(
      Boolean,
    );
    return parts.length ? parts.join(' ') : null;
  });

  constructor() {
    // A new server message is shown even if the user already edited the text before submitting.
    effect(() => {
      this.serverError();
      untracked(() => this.editedSinceServerError.set(false));
    });
  }

  protected onInput(event: Event): void {
    this.editedSinceServerError.set(true);
    this.value.set((event.target as HTMLInputElement).value);
  }

  protected onBlur(): void {
    this.touched.set(true);
    const n = this.normalized();
    if (n) this.value.set(n);
  }
}
