import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DynamicForm, FormDefinition } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { AssetResponse, FormsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FORM_SCHEMA_READ_PERMISSIONS, toFormDefinition } from '../../../shared/forms/form-schema';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { CopyButton } from '../../../shared/ui/copy-button';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { matterLinkOf } from '../../../shared/ui/matter-link';

/**
 * The Details tab of the asset record page (UX S08): the matter, type, external reference (a link when it is a URL, with a copy button),
 * description and dates, then the type-specific values read-only with the form version they were captured under (section "<Type> fields (n)").
 * The matter reference is a link only for a person with `Matter.View` and the schema is requested only when the endpoint would answer it
 * (`FORM_SCHEMA_READ_PERMISSIONS`); otherwise one muted sentence stands in for the fields (decision V). One column up to 1100 px, two above.
 */
@Component({
  selector: 'mf-asset-details-tab',
  imports: [MatterRef, CopyButton, DynamicForm, MfDatePipe],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <h2 class="pg-sr">Details</h2>
    <div class="ad__cols">
      <section class="ad__sec" aria-labelledby="ad-asset-h" data-section="asset">
        <h3 id="ad-asset-h" class="ad__subtitle">Asset</h3>
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
                <!-- One line with an ellipsis (the whole value is the tooltip and the copy button copies all of it). -->
                <span class="ad__ref">
                  @if (isUrl(asset().externalReference!)) {
                    <a
                      class="pg-link ad__ref-text"
                      [href]="asset().externalReference"
                      [attr.title]="asset().externalReference"
                      target="_blank"
                      rel="noopener noreferrer"
                      >{{ asset().externalReference }}</a
                    >
                  } @else {
                    <span class="pg-mono ad__ref-text" [attr.title]="asset().externalReference">{{
                      asset().externalReference
                    }}</span>
                  }
                  <mf-copy-button [text]="asset().externalReference!" label="external reference" />
                </span>
              }
            </dd>
          </div>
          <div class="ad__f">
            <dt>Description</dt>
            <dd>
              @if (asset().description) {
                <!-- Six lines, then "Show more" (only when the text is longer than that). -->
                <div
                  #description
                  id="ad-description"
                  class="ad__desc"
                  [class.ad__desc--clamped]="!expanded()"
                  data-description
                >
                  {{ asset().description }}
                </div>
                @if (overflows() || expanded()) {
                  <button
                    type="button"
                    class="mf-btn mf-btn--text ad__more"
                    aria-controls="ad-description"
                    [attr.aria-expanded]="expanded()"
                    data-description-toggle
                    (click)="expanded.set(!expanded())"
                  >
                    {{ expanded() ? 'Show less' : 'Show more' }}
                  </button>
                }
              } @else {
                Not provided
              }
            </dd>
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
      </section>
      <section class="ad__sec" aria-labelledby="ad-values-h" data-section="fields">
        @if (schema(); as definition) {
          <h3 id="ad-values-h" class="ad__subtitle" data-type-fields-title>
            {{ asset().assetTypeName }} fields ({{ definition.fields.length }})
          </h3>
          <div data-type-fields>
            <mf-dynamic-form [definition]="definition" [values]="values()" [readOnly]="true" />
          </div>
        } @else {
          <h3 id="ad-values-h" class="ad__subtitle">{{ asset().assetTypeName }} fields</h3>
          @if (hasForm() && !canReadSchema()) {
            <p class="pg-muted" data-fields-unavailable>
              Type fields are not available with your access.
            </p>
          } @else {
            <p class="pg-muted" data-no-fields>This asset has no type-specific values.</p>
          }
        }
      </section>
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: var(--mf-s3) var(--mf-s4);
    }
    .ad__dl {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
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
    /* One column up to 1100 px, two columns above: the Asset section and the type's fields side by side. */
    .ad__cols {
      display: grid;
      gap: var(--mf-s4);
    }
    @media (min-width: 1100px) {
      .ad__cols {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
    }
    .ad__sec {
      min-width: 0;
    }
    .ad__ref {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      min-width: 0;
    }
    .ad__ref-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ad__desc {
      white-space: pre-line;
    }
    .ad__desc--clamped {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 6;
      line-clamp: 6;
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
  protected readonly matterLink = computed(() =>
    matterLinkOf(this.auth, this.asset().matterId, this.asset().matterCanOpen),
  );
  /** The form schema is requested only when the endpoint would answer (Task.View or a form-owner management permission). */
  protected readonly canReadSchema = computed(() => this.auth.hasAny(FORM_SCHEMA_READ_PERMISSIONS));
  protected readonly hasForm = computed(() => {
    const id = this.asset().formVersionId;
    return id !== undefined && id !== null;
  });

  private requestId = 0;

  private readonly injector = inject(Injector);
  private readonly description = viewChild<ElementRef<HTMLElement>>('description');
  /** The description is shown whole (Show less) or cut at six lines (Show more). */
  protected readonly expanded = signal(false);
  /** The text is longer than six lines at this width (measured; the button only exists then). */
  protected readonly overflows = signal(false);

  constructor() {
    effect(() => {
      const asset = this.asset();
      untracked(() => {
        this.pickerContext.matterId.set(asset.matterId);
        void this.loadSchema(asset);
        this.expanded.set(false);
      });
    });
    // Measure the clamp now and whenever the width changes (a phone turned, the window resized).
    effect((onCleanup) => {
      const box = this.description()?.nativeElement;
      if (!box) {
        this.overflows.set(false);
        return;
      }
      const measure = (): void => {
        if (this.expanded()) return; // the button stays while the text is open
        this.overflows.set(box.scrollHeight > box.clientHeight + 1);
      };
      afterNextRender(measure, { injector: this.injector });
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(box);
      onCleanup(() => observer.disconnect());
    });
  }

  /** The values are shown with the form version they were captured under; without a schema the base details still show. */
  private async loadSchema(asset: AssetResponse): Promise<void> {
    const id = ++this.requestId;
    if (
      asset.formVersionId === undefined ||
      asset.formVersionId === null ||
      !this.canReadSchema()
    ) {
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
