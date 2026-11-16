import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormDialog } from '../../../../shared/ui/form-dialog';
import { TextField } from '../../../../shared/ui/text-field';

/** What the dialog hands back: the secret VALUE (it is sent once and then forgotten) and its expiry date (`yyyy-MM-dd`). */
export interface SecretDraft {
  readonly secret: string;
  readonly expiresOn: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Set Client Secret / Replace Client Secret (#1395; the write-only secret pattern of docs/ux/design-guidelines.md): one default-width `mf-form-dialog` with a MASKED field and the
 * date the secret expires. The value is never shown again, never stored in the browser and never returned by the API; the dialog says so. A pasted Secret ID (a GUID) is caught here
 * with the same words as the server. The secret saves at once (it is not part of Save Changes on the page): the page sends `(save)` and shows the server's answer in `saveError`
 * or the field messages in `secretError` and `expiresError`. Dates follow D-60: the field is the browser date control, the page shows the numeric form.
 */
@Component({
  selector: 'mf-secret-dialog',
  imports: [FormDialog, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .sd__date {
      display: grid;
      gap: var(--mf-s1);
      margin-top: var(--mf-s3);
    }
    .sd__lead {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
    }
  `,
  template: `
    <mf-form-dialog
      [title]="replacing() ? 'Replace Client Secret' : 'Set Client Secret'"
      [primaryLabel]="replacing() ? 'Replace Secret' : 'Set Secret'"
      [dirty]="secret() !== '' || expires() !== ''"
      [busy]="busy()"
      [error]="saveError()"
      [(visible)]="open"
      (submitted)="submit()"
    >
      <form novalidate (submit)="$event.preventDefault(); submit()" data-secret-form>
        <p class="sd__lead">
          Paste the secret Value from the app registration (Certificates and secrets). Entra ID
          shows it only once. LPT Hub stores it encrypted and never shows it again.
        </p>
        <mf-text-field
          inputId="sd-secret"
          label="Client Secret"
          type="password"
          [required]="true"
          [maxLength]="512"
          help="The Value, not the Secret ID. It is not shown again after you save."
          [error]="secretMessage()"
          [(value)]="secret"
        />
        <div class="sd__date mf-field">
          <label class="mf-field__label" for="sd-expires"
            >Expires On <span class="mf-field__req">(required)</span></label
          >
          <input
            id="sd-expires"
            type="date"
            lang="en-US"
            class="mf-control mf-control--fill"
            data-secret-expires
            aria-describedby="sd-expires-help"
            [value]="expires()"
            [attr.aria-invalid]="expiresMessage() ? 'true' : null"
            (input)="expires.set($any($event.target).value)"
          />
          <p class="mf-field__help" id="sd-expires-help">
            The expiry date shown next to the secret. LPT Hub warns 30 days before it.
          </p>
          @if (expiresMessage(); as e) {
            <p class="mf-field__error" role="alert" data-expires-error>
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
            </p>
          }
        </div>
      </form>
    </mf-form-dialog>
  `,
})
export class SecretDialog {
  /** Whether the dialog is open. */
  readonly open = model(false);
  /** True when a secret is stored already (the words say Replace). */
  readonly replacing = input(false);
  readonly busy = input(false);
  /** The server's message about the secret field and the date field, and any other failure (footer). */
  readonly secretError = input('');
  readonly expiresError = input('');
  readonly saveError = input('');

  readonly save = output<SecretDraft>();

  protected readonly secret = signal('');
  protected readonly expires = signal('');
  private readonly submitted = signal(false);

  protected readonly secretMessage = computed(() => {
    const value = this.secret().trim();
    if (this.submitted() && value === '') return 'Enter the client secret.';
    if (GUID.test(value))
      return 'That looks like the Secret ID. Paste the Value of the secret instead (shown once when the secret is created).';
    return this.secretError();
  });
  protected readonly expiresMessage = computed(() =>
    this.submitted() && this.expires() === ''
      ? 'Enter the date the secret expires.'
      : this.expiresError(),
  );

  constructor() {
    // The dialog starts empty each time it opens and is emptied again when it closes: a secret never stays in the page between two uses.
    effect(() => {
      this.open();
      untracked(() => {
        this.secret.set('');
        this.expires.set('');
        this.submitted.set(false);
      });
    });
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.secret().trim() === '' || GUID.test(this.secret().trim()) || this.expires() === '')
      return;
    // The value stays here only until the server answers (a refusal keeps it so it can be corrected); closing the dialog empties it.
    this.save.emit({ secret: this.secret().trim(), expiresOn: this.expires() });
  }
}
