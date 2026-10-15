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
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { DynamicForm, FormDefinition } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { AssetResponse, AssetsClient, FormsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { ActiveBadge, Badge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { CopyButton } from '../../../shared/ui/copy-button';
import { EntityActivity } from '../../../shared/ui/entity-activity';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { AssetLinkedTasks } from './asset-linked-tasks';

type Tab = 'details' | 'tasks' | 'history';
type LoadState = 'loading' | 'ready' | 'error';

let nextId = 0;

/**
 * The details of one Asset (UX S08), shown in the panel below the Assets grid: name with the type badge and the status, the Set inactive /
 * Set active and Edit actions, the Matter and external reference (copy button, link when it is a URL), a Details tab (fields, the
 * type-specific values shown with the form version they were captured under), a Linked Tasks tab and a History tab (Audit.View).
 * Assets are deactivated, never deleted. It loads the asset itself (lazily, with loading and error states) and reloads when `assetId`
 * changes, so one panel serves every selection.
 */
@Component({
  selector: 'mf-asset-details',
  imports: [
    Badge,
    ActiveBadge,
    ErrorReference,
    Button,
    HasPermissionDirective,
    ConfirmDialog,
    MatterRef,
    CopyButton,
    EntityActivity,
    DynamicForm,
    MfDatePipe,
    AssetLinkedTasks,
  ],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <header class="ad__head">
      <h2 class="ad__title" [id]="headingId" tabindex="-1" #heading>
        @if (asset(); as a) {
          @if (state() === 'ready') {
            {{ a.displayName }}
          } @else {
            Asset details
          }
        } @else {
          Asset details
        }
      </h2>
      @if (state() === 'ready' && asset(); as a) {
        <mf-badge tone="info" data-type-badge>{{ a.assetTypeName }}</mf-badge>
        <mf-active-badge [active]="a.isActive" data-status />
        <span class="ad__spacer"></span>
        <p-button
          *mfHasPermission="'Asset.Edit'"
          [label]="a.isActive ? 'Set inactive' : 'Set active'"
          severity="secondary"
          (onClick)="toggleOpen.set(true)"
        />
        @if (a.isActive) {
          <p-button
            *mfHasPermission="'Asset.Edit'"
            label="Edit"
            severity="secondary"
            (onClick)="go('/assets/' + a.assetId + '/edit')"
          />
        }
      } @else {
        <span class="ad__spacer"></span>
      }
      @if (closable()) {
        <button
          type="button"
          class="mf-btn mf-btn--text ad__close"
          aria-label="Close details"
          title="Close details (Esc)"
          data-close-details
          (click)="closed.emit()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      }
    </header>

    @switch (state()) {
      @case ('loading') {
        <div class="pg-state ad__state" role="status" aria-busy="true" data-loading>
          Loading the asset...
        </div>
      }
      @case ('error') {
        <div class="pg-alert ad__state" role="alert" data-error>
          We couldn't find that asset.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (asset(); as a) {
          @if (!a.isActive) {
            <div class="pg-banner ad__banner" role="note" data-inactive-banner>
              This asset is inactive. It keeps its history and existing task links, and can't be
              edited until it is reactivated.
            </div>
          }
          @if (!a.assetTypeIsActive) {
            <div class="pg-banner ad__banner" role="note" data-type-inactive-banner>
              The asset type {{ a.assetTypeName }} is inactive. This asset keeps working.
            </div>
          }

          <div class="pg-tabs ad__tabs" role="tablist" aria-label="Asset sections">
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === 'details'"
              (click)="tab.set('details')"
            >
              Details
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === 'tasks'"
              (click)="tab.set('tasks')"
            >
              Linked Tasks
            </button>
            @if (canSeeHistory()) {
              <button
                type="button"
                role="tab"
                [attr.aria-selected]="tab() === 'history'"
                (click)="tab.set('history')"
              >
                History
              </button>
            }
          </div>

          @switch (tab()) {
            @case ('details') {
              <dl class="ad__dl">
                <div class="ad__f" data-matter>
                  <dt>Matter</dt>
                  <dd>
                    <mf-matter-ref [value]="a.matterRef" [link]="['/matters', a.matterId]" />
                    {{ a.matterName }}
                  </dd>
                </div>
                <div class="ad__f" data-type>
                  <dt>Type</dt>
                  <dd>{{ a.assetTypeName }}</dd>
                </div>
                <div class="ad__f" data-external-reference>
                  <dt>External reference</dt>
                  <dd>
                    @if (!a.externalReference) {
                      Not provided
                    } @else {
                      @if (isUrl(a.externalReference)) {
                        <a
                          class="pg-link"
                          [href]="a.externalReference"
                          target="_blank"
                          rel="noopener noreferrer"
                          >{{ a.externalReference }}</a
                        >
                      } @else {
                        <span class="pg-mono">{{ a.externalReference }}</span>
                      }
                      <mf-copy-button [text]="a.externalReference" label="external reference" />
                    }
                  </dd>
                </div>
                <div class="ad__f">
                  <dt>Description</dt>
                  <dd>{{ a.description || 'Not provided' }}</dd>
                </div>
                <div class="ad__f">
                  <dt>Created</dt>
                  <dd>{{ a.createdAtUtc | mfDate }}</dd>
                </div>
                @if (a.modifiedAtUtc) {
                  <div class="ad__f">
                    <dt>Last changed</dt>
                    <dd>{{ a.modifiedAtUtc | mfDate }}</dd>
                  </div>
                }
              </dl>
              @if (schema(); as definition) {
                <section
                  class="ad__values"
                  [attr.aria-labelledby]="headingId + '-values'"
                  data-type-fields
                >
                  <h3 [id]="headingId + '-values'" class="ad__subtitle">
                    {{ a.assetTypeName }} fields
                  </h3>
                  <mf-dynamic-form
                    [definition]="definition"
                    [values]="values()"
                    [readOnly]="true"
                  />
                </section>
              } @else {
                <p class="pg-muted" data-no-fields>This asset has no type-specific values.</p>
              }
            }
            @case ('tasks') {
              <mf-asset-linked-tasks [assetId]="a.assetId" />
            }
            @case ('history') {
              <mf-entity-activity objectType="Asset" [objectId]="a.assetId" />
            }
          }

          <mf-confirm-dialog
            [title]="a.isActive ? 'Set asset inactive' : 'Reactivate asset'"
            [confirmLabel]="a.isActive ? 'Set inactive' : 'Set active'"
            [danger]="a.isActive"
            [busy]="busy()"
            [(visible)]="toggleOpen"
            (confirmed)="toggleActive()"
          >
            @if (a.isActive) {
              <p data-toggle-body>
                Set {{ a.displayName }} inactive? Assets are never deleted: its history and task
                links stay, but it can't be edited or linked to new tasks until it is active again.
              </p>
            } @else {
              <p data-toggle-body>Reactivate {{ a.displayName }}?</p>
            }
          </mf-confirm-dialog>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .ad__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      margin-bottom: var(--mf-s2);
    }
    .ad__title {
      margin: 0;
      font-size: var(--mf-fs-lg);
      overflow-wrap: anywhere;
    }
    .ad__title:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .ad__spacer {
      flex: 1 1 auto;
    }
    .ad__close {
      min-width: 32px;
      padding: 0 var(--mf-s2);
    }
    .ad__state,
    .ad__banner {
      margin-bottom: var(--mf-s2);
    }
    .ad__tabs {
      margin-bottom: var(--mf-s2);
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
export class AssetDetails {
  readonly assetId = input.required<string>();
  /** Shows the Close button (the Assets screen's panel); the page decides what closing means. */
  readonly closable = input(false);
  readonly closed = output<void>();
  /** The asset has been loaded (after every selection and reload). */
  readonly loaded = output<AssetResponse>();
  /** The asset changed here (set inactive / active); the list updates its row. */
  readonly changed = output<AssetResponse>();

  private readonly api = inject(AssetsClient);
  private readonly forms = inject(FormsClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly pickerContext = inject(AssetPickerContext);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly headingId = `ad-h-${nextId++}`;
  protected readonly state = signal<LoadState>('loading');
  protected readonly asset = signal<AssetResponse | null>(null);
  protected readonly schema = signal<FormDefinition | null>(null);
  protected readonly tab = signal<Tab>('details');
  protected readonly toggleOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly canSeeHistory = computed(() => this.auth.has('Audit.View'));
  protected readonly values = computed<Record<string, unknown>>(() => ({
    ...(this.asset()?.formValues ?? {}),
  }));

  private requestId = 0;
  private focusPending = false;

  constructor() {
    effect(() => {
      this.assetId();
      untracked(() => {
        this.tab.set('details');
        void this.load();
      });
    });
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    this.state.set('loading');
    try {
      const asset = await firstValueFrom(this.api.getAsset(Number(this.assetId())));
      if (id !== this.requestId) return;
      this.pickerContext.matterId.set(asset.matterId);
      // The values are shown with the form version they were captured under.
      const schema = await this.schemaOf(asset);
      if (id !== this.requestId) return;
      this.asset.set(asset);
      this.schema.set(schema);
      this.state.set('ready');
      this.loaded.emit(asset);
      if (this.focusPending) this.focusHeading();
    } catch {
      if (id !== this.requestId) return;
      this.asset.set(null);
      this.state.set('error');
      if (this.focusPending) this.focusHeading();
    }
  }

  /** Moves focus to the panel heading (keyboard users who open the panel); waits for the asset when it is still loading. */
  requestFocus(): void {
    if (this.state() === 'loading') this.focusPending = true;
    else this.focusHeading();
  }

  private focusHeading(): void {
    this.focusPending = false;
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: false }), {
      injector: this.injector,
    });
  }

  private async schemaOf(asset: AssetResponse): Promise<FormDefinition | null> {
    if (asset.formVersionId === undefined || asset.formVersionId === null) return null;
    try {
      const detail = await firstValueFrom(this.forms.getFormVersionSchema(asset.formVersionId));
      const definition = toFormDefinition(detail);
      return definition.fields.length > 0 ? definition : null;
    } catch {
      return null; // base details still show; the values are just unavailable
    }
  }

  protected isUrl(text: string): boolean {
    return /^https?:\/\/\S+$/i.test(text.trim());
  }

  protected async toggleActive(): Promise<void> {
    const a = this.asset();
    if (!a) return;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.setAssetActive(a.assetId, { isActive: !a.isActive, rowVersion: a.rowVersion }),
      );
      this.asset.set(updated);
      this.toggleOpen.set(false);
      this.notify.success(updated.isActive ? 'Asset reactivated' : 'Asset set inactive');
      this.changed.emit(updated);
    } catch {
      this.toggleOpen.set(false);
      await this.load(); // conflicts and failures are toasted by the HTTP layer; show the latest state
    } finally {
      this.busy.set(false);
    }
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }
}
