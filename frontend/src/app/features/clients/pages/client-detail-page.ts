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
import { ClientResponse, ClientsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { DetailLayout } from '../../../shared/ui/detail-layout';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ClientMatters } from './client-matters';
import { PageTitle } from '../../../core/title/page-title';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ActiveBadge } from '../../../shared/ui/badge';
import { PageHeader, RecordTitle } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Client detail (UX S05): the client's Matters grid in the main area and a Details panel on the right (number, name, status, custom
 * fields, Edit and Set inactive / Set active). Activity opens in a right-side drawer from the header button. Old `?tab=activity`
 * links open the drawer; `?tab=details` and `?tab=matters` just show the page.
 */
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
    ActivityDrawer,
    DetailLayout,
    ClientMatters,
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
            @if (canSeeActivity()) {
              <p-button
                mfActions
                label="Activity"
                icon="pi pi-history"
                severity="secondary"
                data-activity-button
                (onClick)="setActivityOpen(true)"
              />
            }
          </mf-page-header>

          <mf-detail-layout>
            <section mfMain aria-labelledby="client-matters-h">
              <h2 id="client-matters-h" class="pg-section-h">Matters</h2>
              <mf-client-matters
                [clientId]="c.clientId"
                [clientName]="c.name"
                [clientActive]="c.isActive"
                [q]="q()"
                [status]="status()"
                [page]="page()"
                [size]="size()"
                [sort]="sort()"
              />
            </section>

            <div mfAside>
              <div class="pg-panel-actions">
                <p-button
                  *mfHasPermission="'Client.Edit'"
                  label="Edit"
                  severity="secondary"
                  (onClick)="go('/clients/' + c.clientId + '/edit')"
                />
                <p-button
                  *mfHasPermission="'Client.Edit'"
                  [label]="c.isActive ? 'Set inactive' : 'Set active'"
                  severity="secondary"
                  (onClick)="toggleOpen.set(true)"
                />
              </div>
              <dl class="pg-dl pg-dl--stacked">
                <dt>Client number</dt>
                <dd class="pg-mono">{{ c.clientNumber }}</dd>
                <dt>Name</dt>
                <dd>{{ c.name }}</dd>
                <dt>Status</dt>
                <dd><mf-active-badge [active]="c.isActive" /></dd>
                <dt>Created</dt>
                <dd>{{ c.createdAtUtc | mfDate }}</dd>
                @if (c.modifiedAtUtc) {
                  <dt>Last changed</dt>
                  <dd>{{ c.modifiedAtUtc | mfDate }}</dd>
                }
              </dl>
              <mf-custom-fields-view [versionId]="c.formVersionId" [values]="c.formValues ?? {}" />
            </div>
          </mf-detail-layout>

          @if (canSeeActivity()) {
            <mf-activity-drawer
              objectType="Client"
              [objectId]="c.clientId"
              [name]="c.name"
              [visible]="activityOpen()"
              (visibleChange)="setActivityOpen($event)"
            />
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
  /** Old deep links: `activity` opens the drawer. */
  readonly tab = input<string>();
  // The Matters list state, bound from the address and handed to the grid.
  readonly q = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();

  private readonly api = inject(ClientsClient);
  private readonly pageTitle = inject(PageTitle);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly state = signal<LoadState>('loading');
  protected readonly client = signal<ClientResponse | null>(null);
  protected readonly activityOpen = signal(false);
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
    effect(() => {
      if (this.tab() === 'activity' && this.canSeeActivity()) {
        untracked(() => this.activityOpen.set(true));
      }
    });
  }

  protected setActivityOpen(open: boolean): void {
    this.activityOpen.set(open);
    if (!open && this.tab() === 'activity') {
      void this.router.navigate([], {
        queryParams: { tab: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  async load(): Promise<void> {
    const id = Number(this.clientId());
    this.state.set('loading');
    try {
      this.client.set(await firstValueFrom(this.api.getClient(id)));
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
