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
import { IntegrationResponse } from '../../../../api/generated/api-client';
import { Dropdown } from '../../../../shared/ui/dropdown';
import { FormDialog } from '../../../../shared/ui/form-dialog';
import { TextField } from '../../../../shared/ui/text-field';
import { TYPE_HELP, TYPE_ITEMS } from './integration-text';

/** What the dialog hands back; the page saves it. */
export interface IntegrationDraft {
  readonly name: string;
  readonly typeCode: string;
  readonly baseUrl: string;
  readonly scope: string;
  readonly isEnabled: boolean;
}

/** An address the server accepts: https, a host, no user name and no fragment (the same rule as `CK_Integration_BaseUrl` and the API). */
export function isHttpsAddress(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.host !== '' && url.username === '' && url.hash === '';
  } catch {
    return false;
  }
}

/**
 * Add Integration / Edit Integration (#1395): a default-width (576 px) `mf-form-dialog` with Name, Type, Base URL, Scope and Enabled. The Base URL must be https (checked here on
 * submit and by the server); the Scope help names the usual form `api://<app-id>/.default`. The server's answers (a second Matter Lookup or Ethical Wall, a duplicate name, a stale
 * record) arrive as `fieldErrors` and `saveError` and stay in the dialog.
 */
@Component({
  selector: 'mf-integration-dialog',
  imports: [Dropdown, FormDialog, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .id__field {
      display: grid;
      gap: var(--mf-s1);
    }
    .id__enabled {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-ctl-h);
    }
  `,
  template: `
    <mf-form-dialog
      [title]="integration() ? 'Edit Integration' : 'Add Integration'"
      [primaryLabel]="integration() ? 'Save Changes' : 'Add Integration'"
      [dirty]="dirty()"
      [busy]="busy()"
      [error]="saveError()"
      [(visible)]="open"
      (submitted)="submit()"
    >
      <form novalidate (submit)="$event.preventDefault(); submit()" data-integration-form>
        <mf-text-field
          inputId="ig-name"
          label="Name"
          [required]="true"
          [maxLength]="100"
          [counter]="true"
          [error]="message('name')"
          [(value)]="name"
        />
        <div class="id__field mf-field">
          <label class="mf-field__label" for="ig-type">Type</label>
          <mf-dropdown
            field
            buttonId="ig-type"
            label="Type"
            data-integration-type
            [items]="typeItems"
            [value]="typeCode()"
            (valueChange)="typeCode.set($event)"
          />
          <p class="mf-field__help" data-type-help>{{ typeHelp() }}</p>
          @if (message('typeCode'); as e) {
            <p class="mf-field__error" role="alert" data-type-error>
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
            </p>
          }
        </div>
        <mf-text-field
          inputId="ig-base"
          label="Base URL"
          [maxLength]="500"
          help="The https address of the API, for example https://matters.example-firm.com/api."
          [error]="message('baseUrl')"
          [(value)]="baseUrl"
        />
        <mf-text-field
          inputId="ig-scope"
          label="Scope"
          [maxLength]="300"
          help="What LPT Hub asks Entra ID for, usually api://<app-id>/.default. IT gives you the app ID."
          [error]="message('scope')"
          [(value)]="scope"
        />
        <label class="id__enabled">
          <input
            type="checkbox"
            data-integration-enabled
            [checked]="enabled()"
            (change)="enabled.set($any($event.target).checked)"
          />
          Enabled
        </label>
      </form>
    </mf-form-dialog>
  `,
})
export class IntegrationDialog {
  readonly open = model(false);
  /** The integration being edited, or null for a new one. */
  readonly integration = input<IntegrationResponse | null>(null);
  readonly busy = input(false);
  /** The server's field messages (by field: `name`, `typeCode`, `baseUrl`, `scope`) and any other failure (footer). */
  readonly fieldErrors = input<Readonly<Record<string, string>>>({});
  readonly saveError = input('');

  readonly save = output<IntegrationDraft>();

  protected readonly typeItems = [...TYPE_ITEMS];
  protected readonly name = signal('');
  protected readonly typeCode = signal('OTHER');
  protected readonly baseUrl = signal('');
  protected readonly scope = signal('');
  protected readonly enabled = signal(true);
  private readonly submitted = signal(false);

  protected readonly typeHelp = computed(() => TYPE_HELP[this.typeCode()] ?? '');

  /** A client-side message first (after a submit), else what the server said about the field. */
  protected message(field: 'name' | 'typeCode' | 'baseUrl' | 'scope'): string {
    if (this.submitted()) {
      if (field === 'name' && this.name().trim() === '') return 'Enter a name.';
      const url = this.baseUrl().trim();
      if (field === 'baseUrl' && url !== '' && !isHttpsAddress(url))
        return 'Enter an address that starts with https:// and names a server.';
      const scope = this.scope().trim();
      if (field === 'scope' && scope !== '' && /\s/.test(scope))
        return 'Enter one scope without spaces, for example api://<app-id>/.default.';
    }
    return this.fieldErrors()[field] ?? '';
  }

  protected readonly dirty = computed(() => {
    const i = this.integration();
    return i
      ? this.name().trim() !== i.name ||
          this.typeCode() !== i.typeCode ||
          this.baseUrl().trim() !== (i.baseUrl ?? '') ||
          this.scope().trim() !== (i.scope ?? '') ||
          this.enabled() !== i.isEnabled
      : this.name().trim() !== '' || this.baseUrl().trim() !== '' || this.scope().trim() !== '';
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        const i = this.integration();
        this.name.set(i?.name ?? '');
        this.typeCode.set(i?.typeCode ?? 'OTHER');
        this.baseUrl.set(i?.baseUrl ?? '');
        this.scope.set(i?.scope ?? '');
        this.enabled.set(i?.isEnabled ?? true);
        this.submitted.set(false);
      });
    });
  }

  protected submit(): void {
    this.submitted.set(true);
    if (
      this.message('name') ||
      this.message('baseUrl') ||
      (this.scope().trim() !== '' && /\s/.test(this.scope().trim()))
    )
      return;
    this.save.emit({
      name: this.name().trim(),
      typeCode: this.typeCode(),
      baseUrl: this.baseUrl().trim(),
      scope: this.scope().trim(),
      isEnabled: this.enabled(),
    });
  }
}
