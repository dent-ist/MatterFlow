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
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { DynamicForm, FormDefinition } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { AssetResponse, AssetsClient, FormsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { LocalTimePipe } from '../../../shared/pipes/local-time.pipe';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { CopyButton } from '../../../shared/ui/copy-button';
import { EntityActivity } from '../../../shared/ui/entity-activity';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { AssetLinkedTasks } from './asset-linked-tasks';
import { PageTitle } from '../../../core/title/page-title';
import { ErrorReference } from '../../../shared/ui/error-reference';

type Tab = 'details' | 'tasks' | 'history';
type LoadState = 'loading' | 'ready' | 'error';

/**
 * Asset detail (UX S08): type badge, Matter link, external reference (copy button, link when it is a URL), the type-specific values
 * shown with the form version they were captured under, a Linked Tasks tab (the Tasks linked to it) and a History
 * tab with the change history from the audit trail. Assets are deactivated, never deleted.
 */
@Component({
  selector: 'mf-asset-detail-page',
  imports: [
    ErrorReference,
    RouterLink,
    Button,
    HasPermissionDirective,
    ConfirmDialog,
    MatterRef,
    CopyButton,
    EntityActivity,
    DynamicForm,
    LocalTimePipe,
    AssetLinkedTasks,
  ],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading the asset...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert">
          We couldn't find that asset.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (asset(); as a) {
          <header class="pg-head">
            <div>
              <p class="pg-crumbs"><a routerLink="/assets">Assets</a> &gt; {{ a.displayName }}</p>
              <h1 class="pg-title">
                {{ a.displayName }}
                <span class="pg-chip" data-type-badge>{{ a.assetTypeName }}</span>
                <span class="pg-chip" [class.pg-chip--inactive]="!a.isActive" data-status>{{
                  a.isActive ? 'Active' : 'Inactive'
                }}</span>
              </h1>
              <p class="pg-muted" data-matter>
                Matter:
                <mf-matter-ref [value]="a.matterRef" [link]="['/matters', a.matterId]" />
                {{ a.matterName }}
              </p>
              @if (a.externalReference) {
                <p class="pg-muted" data-external-reference>
                  External reference:
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
                </p>
              }
            </div>
            <div class="pg-actions">
              @if (a.isActive) {
                <p-button
                  *mfHasPermission="'Asset.Edit'"
                  label="Edit"
                  severity="secondary"
                  (onClick)="go('/assets/' + a.assetId + '/edit')"
                />
              }
              <p-button
                *mfHasPermission="'Asset.Edit'"
                [label]="a.isActive ? 'Set inactive' : 'Set active'"
                severity="secondary"
                (onClick)="toggleOpen.set(true)"
              />
            </div>
          </header>

          @if (!a.isActive) {
            <div class="pg-banner" role="note" data-inactive-banner>
              This asset is inactive. It keeps its history and existing task links, and can't be
              edited until it is reactivated.
            </div>
          }
          @if (!a.assetTypeIsActive) {
            <div class="pg-banner" role="note" data-type-inactive-banner>
              The asset type {{ a.assetTypeName }} is inactive. This asset keeps working.
            </div>
          }

          <div class="pg-tabs" role="tablist" aria-label="Asset sections">
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
              <dl class="pg-dl">
                <dt>Type</dt>
                <dd>{{ a.assetTypeName }}</dd>
                <dt>Matter</dt>
                <dd>{{ a.matterRef }} {{ a.matterName }}</dd>
                <dt>Description</dt>
                <dd>{{ a.description || 'Not provided' }}</dd>
                <dt>Created</dt>
                <dd>{{ a.createdAtUtc | localTime }}</dd>
                @if (a.modifiedAtUtc) {
                  <dt>Last changed</dt>
                  <dd>{{ a.modifiedAtUtc | localTime }}</dd>
                }
              </dl>
              @if (schema(); as definition) {
                <section class="pg-values" aria-labelledby="asset-values-h" data-type-fields>
                  <h2 id="asset-values-h" class="pg-subtitle">{{ a.assetTypeName }} fields</h2>
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
    .pg-values {
      margin-top: var(--mf-s4);
    }
    .pg-subtitle {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-h2);
    }
  `,
})
export class AssetDetailPage {
  readonly assetId = input.required<string>();

  private readonly api = inject(AssetsClient);
  private readonly pageTitle = inject(PageTitle);
  private readonly forms = inject(FormsClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly pickerContext = inject(AssetPickerContext);

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

  constructor() {
    effect(() => {
      const a = this.asset();
      if (a) this.pageTitle.set(a.displayName);
    });
    effect(() => {
      this.assetId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const asset = await firstValueFrom(this.api.getAsset(Number(this.assetId())));
      this.asset.set(asset);
      this.pickerContext.matterId.set(asset.matterId);
      // The values are shown with the form version they were captured under.
      this.schema.set(await this.schemaOf(asset));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
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
