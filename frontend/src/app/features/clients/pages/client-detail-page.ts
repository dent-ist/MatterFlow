import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ClientResponse, ClientsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ClientMatters } from './client-matters';
import { ClientOverview } from './client-overview';
import { PageTitle, recordTitle } from '../../../core/title/page-title';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { RecordSkeleton, recordTabLabel, recordTabs } from '../../../shared/ui/record-skeleton';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { restoreTabFocus } from '../../../shared/ui/row-nav';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { RecordAction, RecordHeader } from '../../../shared/ui/record-header';

type Tab = 'details' | 'matters';

/** Why New matter is unavailable for an inactive client (the same words as the Matters tab's button). */
const INACTIVE_REASON = 'This client is inactive. Set it active to add matters.';

/**
 * Client detail (UX S05): Overview / Matters tabs across the full page width. Overview (key `details`) is first and the default (task
 * strip, matters with the most open tasks, dates, custom fields; #261); Matters is the client's Matters grid and shows its count (#262).
 * Without `Matter.View` there is no Matters tab. The tab is kept in `?tab=` (absent for Overview, `?tab=details` still works). The header holds Edit, Activity, New matter and the overflow (Set inactive / Set active). Activity opens in a right-side drawer; `?tab=activity` opens the drawer and shows Details.
 */
@Component({
  selector: 'mf-client-detail-page',
  imports: [
    FixedPage,
    RecordHeader,
    RecordState,
    RecordSkeleton,
    ConfirmDialog,
    ActivityDrawer,
    Tabs,
    ScrollArea,
    ClientMatters,
    ClientOverview,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-fixed-page>
      <span class="pg-sr" role="status" data-record-live>{{ flow.live() }}</span>
      @switch (state()) {
        @case ('loading') {
          <mf-record-skeleton kind="client" [activeTab]="current()" (retry)="load()" />
        }
        @case ('ready') {
          @if (client(); as c) {
            <mf-record-header
              kind="client"
              [parents]="[{ label: 'Clients', link: '/clients' }]"
              [current]="c.clientNumber + ' ' + c.name"
              [ref]="c.clientNumber"
              [name]="c.name"
              [active]="c.isActive"
              [actions]="headerActions()"
            />

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
                  <div class="mf-scroll-area" mfScrollArea="Client overview" data-details-tab>
                    <mf-client-overview [client]="c" />
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
        @default {
          <mf-record-state
            kind="client"
            [recordId]="clientId()"
            [state]="state()"
            [busy]="flow.retrying()"
            (retried)="load()"
          />
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

  protected readonly flow = new RecordLoadFlow('client');
  protected readonly state = this.flow.state;
  protected readonly client = signal<ClientResponse | null>(null);
  protected readonly activityOpen = signal(false);
  protected readonly toggleOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly tabs = computed<MfTab[]>(() => {
    const all = recordTabs('client', { matters: this.client()?.matterCount ?? 0 });
    return this.auth.has('Matter.View') ? all : all.filter((t) => t.key !== 'matters');
  });
  protected readonly current = computed<Tab>(() =>
    this.tab() === 'matters' && this.auth.has('Matter.View') ? 'matters' : 'details',
  );
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));
  /** The header's actions (C3, #255): Edit, Activity, the primary New matter and, in the overflow, Set inactive / Set active. */
  protected readonly headerActions = computed<RecordAction[]>(() => {
    const c = this.client();
    if (!c) return [];
    const list: RecordAction[] = [];
    if (this.auth.has('Client.Edit')) {
      list.push({
        id: 'edit',
        role: 'edit',
        label: 'Edit',
        run: () => this.go('/clients/' + c.clientId + '/edit'),
      });
    }
    if (this.canSeeActivity()) {
      list.push({
        id: 'activity',
        role: 'activity',
        label: 'Activity',
        icon: 'pi-history',
        run: () => this.setActivityOpen(true),
      });
    }
    if (this.auth.has('Matter.Create')) {
      list.push({
        id: 'new-matter',
        role: 'primary',
        label: 'New matter',
        icon: 'pi-plus',
        disabled: !c.isActive,
        reason: INACTIVE_REASON,
        run: () => this.go('/matters/new?clientId=' + c.clientId),
      });
    }
    if (this.auth.has('Client.Edit')) {
      list.push({
        id: 'toggle-active',
        role: 'state',
        label: c.isActive ? 'Set inactive' : 'Set active',
        run: () => this.toggleOpen.set(true),
      });
    }
    return list;
  });

  constructor() {
    // Back from a matter: the Matters tab focuses the row left, every other return focuses the selected tab.
    restoreTabFocus(() => this.state() === 'ready', ['client-matters']);
    // `00107 Hartwell & Bryce LLP: Matters` once the record is known, `Client` until then (#248); kept through tab changes.
    effect(() => {
      const c = this.state() === 'ready' ? this.client() : null;
      this.pageTitle.pin(
        c
          ? recordTitle(c.clientNumber + ' ' + c.name, recordTabLabel('client', this.current()))
          : recordStateTitle('client', this.state()),
      );
    });
    inject(DestroyRef).onDestroy(() => this.pageTitle.unpin());
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
    await this.flow.run(
      () => firstValueFrom(this.api.getClient(id)),
      (client) => this.client.set(client),
    );
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
