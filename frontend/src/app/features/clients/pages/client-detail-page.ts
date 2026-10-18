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
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ClientMatters } from './client-matters';
import { PageTitle } from '../../../core/title/page-title';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ActiveBadge } from '../../../shared/ui/badge';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { PageHeader, RecordTitle } from '../../../shared/ui/page-header';

type Tab = 'details' | 'matters';
type LoadState = 'loading' | 'ready' | 'error';

/**
 * Client detail (UX S05): Details / Matters tabs across the full page width. Details is first and the default (number, name, status,
 * custom fields, Edit and Set inactive / Set active); Matters is the client's Matters grid. The tab is kept in `?tab=` (absent for
 * Details). Activity opens in a right-side drawer from the header button; `?tab=activity` opens the drawer and shows Details.
 */
@Component({
  selector: 'mf-client-detail-page',
  imports: [
    FixedPage,
    PageHeader,
    RecordTitle,
    ActiveBadge,
    ErrorReference,
    Button,
    HasPermissionDirective,
    ConfirmDialog,
    ActivityDrawer,
    Tabs,
    ScrollArea,
    ClientMatters,
    MfDatePipe,
    CustomFieldsView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-fixed-page>
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

            <mf-tabs
              label="Client sections"
              idPrefix="client"
              [tabs]="tabs()"
              [selected]="current()"
              (tabChange)="select($event)"
            />
            <div
              class="mf-fill"
              role="tabpanel"
              id="client-panel"
              [attr.aria-labelledby]="'client-tab-' + current()"
            >
              @switch (current()) {
                @case ('details') {
                  <div class="mf-scroll-area" mfScrollArea="Client details" data-details-tab>
                    <div class="pg-details">
                      <h2 class="pg-sr">Details</h2>
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
                      <dl class="pg-dl">
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
                      <mf-custom-fields-view
                        [versionId]="c.formVersionId"
                        [values]="c.formValues ?? {}"
                      />
                    </div>
                  </div>
                }
                @case ('matters') {
                  <mf-client-matters
                    [clientId]="c.clientId"
                    [clientName]="c.name"
                    [clientActive]="c.isActive"
                    [status]="status()"
                    [page]="page()"
                    [size]="size()"
                    [sort]="sort()"
                  />
                }
              }
            </div>

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
                  Set {{ c.clientNumber }} {{ c.name }} inactive? New matters can't be created for
                  an inactive client. Its existing matters and tasks keep working.
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
    </mf-fixed-page>
  `,
})
export class ClientDetailPage {
  readonly clientId = input.required<string>();
  /** `?tab=`: `details` (default, also when absent) or `matters`; `activity` opens the drawer and shows Details. */
  readonly tab = input<string>();
  // The Matters list state, bound from the address and handed to the grid.
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
  protected readonly tabs = computed<MfTab[]>(() => [
    { key: 'details', label: 'Details' },
    { key: 'matters', label: 'Matters' },
  ]);
  protected readonly current = computed<Tab>(() =>
    this.tab() === 'matters' ? 'matters' : 'details',
  );
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

  protected select(key: string): void {
    void this.router.navigate([], {
      // The Matters filters, paging and sort belong to the Matters tab only.
      queryParams: {
        tab: key === 'details' ? null : key,
        q: null,
        matterRef: null,
        name: null,
        isSensitive: null,
        status: null,
        page: null,
        size: null,
        sort: null,
      },
      queryParamsHandling: 'merge',
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
