import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DynamicForm, FormDefinition } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { AssetResponse, FormsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { CopyButton } from '../../../shared/ui/copy-button';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { matterLinkOf } from '../../../shared/ui/matter-link';

/**
 * The Details tab of the asset record page (UX S08): the matter, type, external reference (a link when it is a URL, with a copy button),
 * description and dates, then the type-specific values read-only with the form version they were captured under. The matter reference is
 * a link only for a person with `Matter.View` (decision V). The tab loads the form schema itself, so the page shell stays small.
 */
@Component({
  selector: 'mf-asset-details-tab',
  imports: [MatterRef, CopyButton, DynamicForm, MfDatePipe],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <h2 class="pg-sr">Details</h2>
    <dl class="ad__dl" data-details>
      <div class="ad__f" data-matter>
        <dt>Matter</dt>
        <dd>
          <mf-matter-ref [value]="asset().matterRef" [link]="matterLink()" />
          {{ asset().matterName }}
        </dd>
      </div>
      <div class="ad__f" data-type>
        <dt>Type</dt>
        <dd>{{ asset().assetTypeName }}</dd>
      </div>
      <div class="ad__f" data-external-reference>
        <dt>External reference</dt>
        <dd>
          @if (!asset().externalReference) {
            Not provided
          } @else {
            @if (isUrl(asset().externalReference!)) {
              <a
                class="pg-link"
                [href]="asset().externalReference"
                target="_blank"
                rel="noopener noreferrer"
                >{{ asset().externalReference }}</a
              >
            } @else {
              <span class="pg-mono">{{ asset().externalReference }}</span>
            }
            <mf-copy-button [text]="asset().externalReference!" label="external reference" />
          }
        </dd>
      </div>
      <div class="ad__f">
        <dt>Description</dt>
        <dd>{{ asset().description || 'Not provided' }}</dd>
      </div>
      <div class="ad__f">
        <dt>Created</dt>
        <dd>{{ asset().createdAtUtc | mfDate }}</dd>
      </div>
      @if (asset().modifiedAtUtc) {
        <div class="ad__f">
          <dt>Last changed</dt>
          <dd>{{ asset().modifiedAtUtc | mfDate }}</dd>
        </div>
      }
    </dl>
    @if (schema(); as definition) {
      <section class="ad__values" aria-labelledby="ad-values-h" data-type-fields>
        <h3 id="ad-values-h" class="ad__subtitle">{{ asset().assetTypeName }} fields</h3>
        <mf-dynamic-form [definition]="definition" [values]="values()" [readOnly]="true" />
      </section>
    } @else {
      <p class="pg-muted" data-no-fields>This asset has no type-specific values.</p>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: var(--mf-s3) var(--mf-s4);
    }
    .ad__dl {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: var(--mf-s2) var(--mf-s4);
      margin: 0;
    }
    .ad__f {
      min-width: 0;
    }
    .ad__f dt {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .ad__f dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .ad__values {
      margin-top: var(--mf-s3);
    }
    .ad__subtitle {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
    }
  `,
})
export class AssetDetailsTab {
  readonly asset = input.required<AssetResponse>();

  private readonly forms = inject(FormsClient);
  private readonly auth = inject(AuthStore);
  private readonly pickerContext = inject(AssetPickerContext);

  protected readonly schema = signal<FormDefinition | null>(null);
  protected readonly values = computed<Record<string, unknown>>(() => ({
    ...(this.asset().formValues ?? {}),
  }));
  protected readonly matterLink = computed(() => matterLinkOf(this.auth, this.asset().matterId));

  private requestId = 0;

  constructor() {
    effect(() => {
      const asset = this.asset();
      untracked(() => {
        this.pickerContext.matterId.set(asset.matterId);
        void this.loadSchema(asset);
      });
    });
  }

  /** The values are shown with the form version they were captured under; without a schema the base details still show. */
  private async loadSchema(asset: AssetResponse): Promise<void> {
    const id = ++this.requestId;
    if (asset.formVersionId === undefined || asset.formVersionId === null) {
      this.schema.set(null);
      return;
    }
    try {
      const detail = await firstValueFrom(this.forms.getFormVersionSchema(asset.formVersionId));
      if (id !== this.requestId) return;
      const definition = toFormDefinition(detail);
      this.schema.set(definition.fields.length > 0 ? definition : null);
    } catch {
      if (id === this.requestId) this.schema.set(null);
    }
  }

  protected isUrl(text: string): boolean {
    return /^https?:\/\/\S+$/i.test(text.trim());
  }
}
