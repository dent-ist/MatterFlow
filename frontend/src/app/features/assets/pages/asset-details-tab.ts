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
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DynamicForm, FormDefinition } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { AssetResponse, FormsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FORM_SCHEMA_READ_PERMISSIONS, toFormDefinition } from '../../../shared/forms/form-schema';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { AssignNumberButton } from '../../../shared/ui/assign-number-button';
import { CopyButton } from '../../../shared/ui/copy-button';
import { DetailField, DetailsCard } from '../../../shared/ui/details-card';
import { StatusChip } from '../../../shared/ui/status-chip';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { AssetDispositionHistory } from '../disposition/asset-disposition-history';
import { dispositionOf } from '../disposition/asset-disposition';
import { matterLinkOf } from '../../../shared/ui/matter-link';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';

/**
 * The Details tab of the asset record page (UX S08): the matter, type, external reference (a link when it is a URL, with a copy button),
 * description and dates in the shared Details card (D-44f), then the type-specific values read-only with the form version they were captured under in a second card titled "<Type> Fields" with a count chip.
 * The matter reference is a link only for a person with `Matter.View` and the schema is requested only when the endpoint would answer it
 * (`FORM_SCHEMA_READ_PERMISSIONS`); otherwise one muted sentence stands in for the fields (decision V).
 */
@Component({
  selector: 'mf-asset-details-tab',
  imports: [
    NumericDatePipe,
    MatterRef,
    CopyButton,
    AssignNumberButton,
    DynamicForm,
    StatusChip,
    AssetDispositionHistory,
    DetailsCard,
    DetailField,
  ],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <div class="ad__cols">
      <mf-details-card title="Details" data-section="asset" data-details>
        @if (asset().assetNumber; as number) {
          <div mfDetailField label="Asset Number" data-asset-number>
            <!-- One line with an ellipsis (the whole number is the tooltip and the copy button copies all of it). -->
            <span class="ad__ref">
              <span class="pg-mono ad__ref-text" [attr.title]="number" data-number-value>{{
                number
              }}</span>
              <mf-copy-button [text]="number" label="asset number" />
            </span>
          </div>
        } @else if (asset().assetTypeNumberingEnabled) {
          <div mfDetailField label="Asset Number" data-asset-number>
            <span class="ad__muted" data-not-assigned>Not assigned</span>
            @if (canAssign()) {
              <mf-assign-number-button
                [assetId]="asset().assetId"
                [rowVersion]="asset().rowVersion"
                (assigned)="assigned.emit($event)"
                (stale)="stale.emit()"
              />
            }
          </div>
        }
        <div mfDetailField label="Matter" data-matter>
          <mf-matter-ref [value]="asset().matterRef" [link]="matterLink()" />
          <span>{{ asset().matterName }}</span>
        </div>
        <div mfDetailField label="Type" data-type>{{ asset().assetTypeName }}</div>
        <div mfDetailField label="Disposition" data-disposition>
          <mf-status-chip kind="disposition" [code]="disposition().code" />
          @if (asset().dispositionChangedAtUtc) {
            <span class="ad__muted"> since {{ asset().dispositionChangedAtUtc | mfNum }}</span>
          }
          @if (asset().dispositionNote) {
            <span class="ad__muted" data-disposition-note>
              &ldquo;{{ asset().dispositionNote }}&rdquo;</span
            >
          }
        </div>
        @if (asset().sizeValue !== undefined && asset().sizeValue !== null) {
          <div mfDetailField label="Size" data-size>
            {{ asset().sizeValue }} {{ asset().sizeUnit }}
          </div>
        }
        <div mfDetailField label="External Reference" data-external-reference>
          @if (!asset().externalReference) {
            Not provided
          } @else {
            <!-- One line with an ellipsis (the whole value is the tooltip and the copy button copies all of it). -->
            <span class="ad__ref">
              @if (isUrl(asset().externalReference!)) {
                <a
                  class="mf-link ad__ref-text"
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
        </div>
        <div mfDetailField label="Created">{{ asset().createdAtUtc | mfNum }}</div>
        @if (asset().modifiedAtUtc) {
          <div mfDetailField label="Last Updated">{{ asset().modifiedAtUtc | mfNum }}</div>
        }
        <div mfDetailField label="Description" wide>
          @if (asset().description) {
            <!-- Six lines, then "Show More" (only when the text is longer than that). -->
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
                {{ expanded() ? 'Show Less' : 'Show More' }}
              </button>
            }
          } @else {
            Not provided
          }
        </div>
        <div mfDetailField label="Disposition History" wide data-disposition-history-row>
          <mf-asset-disposition-history
            [assetId]="asset().assetId"
            [version]="asset().rowVersion"
          />
        </div>
      </mf-details-card>
      @if (schema(); as definition) {
        <mf-details-card
          [title]="asset().assetTypeName + ' Fields'"
          [count]="definition.fields.length"
          data-section="fields"
          data-type-fields-title
        >
          <div data-type-fields>
            <mf-dynamic-form [definition]="definition" [values]="values()" [readOnly]="true" />
          </div>
        </mf-details-card>
      } @else {
        <mf-details-card [title]="asset().assetTypeName + ' Fields'" data-section="fields">
          @if (hasForm() && !canReadSchema()) {
            <p class="pg-muted" data-fields-unavailable>
              Type fields are not available with your access.
            </p>
          } @else {
            <p class="pg-muted" data-no-fields>This asset has no type-specific values.</p>
          }
        </mf-details-card>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: var(--mf-s3) var(--mf-s4);
    }
    .ad__muted {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    /* The Details card, then the type's fields in a second card (D-44f): stacked, full width. */
    .ad__cols {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
    }
    .ad__ref {
      flex: 1 1 0;
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
  `,
})
export class AssetDetailsTab {
  readonly asset = input.required<AssetResponse>();
  /** An old asset got its number (Assign Number): the page takes the new asset. */
  readonly assigned = output<AssetResponse>();
  /** The asset changed meanwhile: the page reloads. */
  readonly stale = output<void>();

  private readonly forms = inject(FormsClient);
  private readonly auth = inject(AuthStore);
  private readonly pickerContext = inject(AssetPickerContext);

  protected readonly canAssign = computed(
    () => this.auth.has('Asset.Edit') && this.asset().isActive,
  );
  protected readonly disposition = computed(() => dispositionOf(this.asset().dispositionCode));
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
