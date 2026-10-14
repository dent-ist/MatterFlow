import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

/** Labelled text input or textarea with help and error text (UX forms pattern 5.3: label above, error beneath). */
@Component({
  selector: 'mf-text-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mf-field">
      <label class="mf-field__label" [attr.for]="inputId()">
        {{ label() }}
        @if (required()) {
          <span class="mf-field__req">(required)</span>
        }
      </label>
      @if (multiline()) {
        <textarea
          class="mf-field__input mf-field__input--area"
          rows="4"
          [id]="inputId()"
          [name]="inputId()"
          [attr.maxlength]="maxLength()"
          [value]="value()"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          (input)="onInput($event)"
        ></textarea>
      } @else {
        <input
          class="mf-field__input"
          type="text"
          autocomplete="off"
          [id]="inputId()"
          [name]="inputId()"
          [attr.maxlength]="maxLength()"
          [value]="value()"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          (input)="onInput($event)"
        />
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
export class TextField {
  readonly label = input.required<string>();
  readonly inputId = input.required<string>();
  readonly help = input('');
  readonly required = input(false);
  readonly multiline = input(false);
  readonly maxLength = input<number | null>(null);
  /** Error message to show (the parent decides when: on submit or from the server). */
  readonly error = input<string | null>(null);

  readonly value = model('');

  protected readonly describedBy = computed(() => {
    const id = this.inputId();
    const parts = [this.error() ? `${id}-error` : null, this.help() ? `${id}-help` : null].filter(
      Boolean,
    );
    return parts.length ? parts.join(' ') : null;
  });

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement | HTMLTextAreaElement).value);
  }
}
