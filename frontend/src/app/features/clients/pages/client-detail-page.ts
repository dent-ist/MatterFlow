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
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  ClientResponse,
  ClientsClient,
  MatterResponse,
  MattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { EntityActivity } from '../../../shared/ui/entity-activity';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PageTitle } from '../../../core/title/page-title';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ActiveBadge } from '../../../shared/ui/badge';
import { PageHeader, RecordTitle } from '../../../shared/ui/page-header';

type Tab = 'matters' | 'details' | 'activity';
type LoadState = 'loading' | 'ready' | 'error';

/** Client detail (UX S05): number prominently, Matters / Details / Activity tabs, edit and activation. */
@Component({
  selector: 'mf-client-detail-page',
  imports: [
    PageHeader,
    RecordTitle,
    ActiveBadge,
    ErrorReference,
    Button,
    HasPermissionDirective,
    ConfirmDialog,
    MatterRef,
    EntityActivity,
    MfDatePipe,
    CustomFieldsView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading the client...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert">
          We couldn't find that client.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (client(); as c) {
          <mf-page-header
            [crumbs]="[
              { label: 'Clients', link: '/clients' },
              { label: c.clientNumber + ' ' + c.name },
            ]"
          >
            <mf-record-title mfTitle [ref]="c.clientNumber" [name]="c.name">
              <mf-active-badge [active]="c.isActive" />
            </mf-record-title>
            <p-button
              mfActions
              *mfHasPermission="'Client.Edit'"
              [label]="c.isActive ? 'Set inactive' : 'Set active'"
              severity="secondary"
              (onClick)="toggleOpen.set(true)"
            />
            <p-button
              mfActions
              *mfHasPermission="'Client.Edit'"
              label="Edit"
              severity="secondary"
              (onClick)="go('/clients/' + c.clientId + '/edit')"
            />
          </mf-page-header>

          <div class="pg-tabs" role="tablist" aria-label="Client sections">
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === 'matters'"
              (click)="tab.set('matters')"
            >
              Matters ({{ c.matterCount }})
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === 'details'"
              (click)="tab.set('details')"
            >
              Details
            </button>
            @if (canSeeActivity()) {
              <button
                type="button"
                role="tab"
                [attr.aria-selected]="tab() === 'activity'"
                (click)="tab.set('activity')"
              >
                Activity
              </button>
            }
          </div>

          @switch (tab()) {
            @case ('matters') {
              <div class="pg-actions" style="margin-bottom: var(--mf-s3)">
                <p-button
                  *mfHasPermission="'Matter.Create'"
                  label="New matter for this client"
                  icon="pi pi-plus"
                  severity="secondary"
                  [disabled]="!c.isActive"
                  (onClick)="go('/matters/new?clientId=' + c.clientId)"
                />
              </div>
              @if (!c.isActive) {
                <p class="pg-reason" data-inactive-reason>
                  This client is inactive, so new matters can't be created for it.
                </p>
              }
              @if (matters().length === 0) {
                <div class="pg-state" data-empty>No matters yet for this client.</div>
              } @else {
                <table class="pg-table">
                  <caption class="pg-sr">
                    Matters of
                    {{
                      c.name
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Matter</th>
                      <th scope="col">Name</th>
                      <th scope="col">Projects</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of matters(); track m.matterId) {
                      <tr>
                        <td>
                          <mf-matter-ref [value]="m.matterRef" [link]="['/matters', m.matterId]" />
                        </td>
                        <td>{{ m.name }}</td>
                        <td>{{ m.projectCount }}</td>
                        <td>
                          <mf-active-badge [active]="m.isActive" />
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            }
            @case ('details') {
              <dl class="pg-dl">
                <dt>Client number</dt>
                <dd class="pg-mono">{{ c.clientNumber }}</dd>
                <dt>Name</dt>
                <dd>{{ c.name }}</dd>
                <dt>Status</dt>
                <dd>{{ c.isActive ? 'Active' : 'Inactive' }}</dd>
                <dt>Created</dt>
                <dd>{{ c.createdAtUtc | mfDate }}</dd>
                @if (c.modifiedAtUtc) {
                  <dt>Last changed</dt>
                  <dd>{{ c.modifiedAtUtc | mfDate }}</dd>
                }
              </dl>
              <mf-custom-fields-view [versionId]="c.formVersionId" [values]="c.formValues ?? {}" />
            }
            @case ('activity') {
              <mf-entity-activity objectType="Client" [objectId]="c.clientId" />
            }
          }

          <mf-confirm-dialog
            [title]="c.isActive ? 'Set client inactive' : 'Set client active'"
            [confirmLabel]="c.isActive ? 'Set inactive' : 'Set active'"
            [danger]="c.isActive"
            [busy]="busy()"
            [(visible)]="toggleOpen"
            (confirmed)="toggleActive()"
          >
            @if (c.isActive) {
              <p data-toggle-body>
                Set {{ c.clientNumber }} {{ c.name }} inactive? New matters can't be created for an
                inactive client. Its existing matters and tasks keep working.
              </p>
            } @else {
              <p data-toggle-body>
                Set {{ c.clientNumber }} {{ c.name }} active? New matters can be created for it
                again.
              </p>
            }
          </mf-confirm-dialog>
        }
      }
    }
  `,
})
export class ClientDetailPage {
  readonly clientId = input.required<string>();

  private readonly api = inject(ClientsClient);
  private readonly pageTitle = inject(PageTitle);
  private readonly mattersApi = inject(MattersClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly state = signal<LoadState>('loading');
  protected readonly client = signal<ClientResponse | null>(null);
  protected readonly matters = signal<MatterResponse[]>([]);
  protected readonly tab = signal<Tab>('matters');
  protected readonly toggleOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));

  constructor() {
    effect(() => {
      const c = this.client();
      if (c) this.pageTitle.set(c.clientNumber + ' ' + c.name);
    });
    effect(() => {
      this.clientId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    const id = Number(this.clientId());
    this.state.set('loading');
    try {
      const [client, matters] = await Promise.all([
        firstValueFrom(this.api.getClient(id)),
        this.auth.has('Matter.View')
          ? firstValueFrom(
              this.mattersApi.listMatters(undefined, id, undefined, undefined, 1, 100, 'matterRef'),
            )
          : Promise.resolve(null),
      ]);
      this.client.set(client);
      this.matters.set(matters?.items ?? []);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  protected async toggleActive(): Promise<void> {
    const c = this.client();
    if (!c) return;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.updateClient(c.clientId, {
          name: c.name,
          isActive: !c.isActive,
          rowVersion: c.rowVersion,
        }),
      );
      this.client.set(updated);
      this.toggleOpen.set(false);
      this.notify.success(updated.isActive ? 'Client set active' : 'Client set inactive');
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
