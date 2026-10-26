import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { mfDate } from '../../../core/time/time';
import { WorkStrip, WorkStripItem } from '../../../shared/work-queue/work-strip';
import { firstValueFrom } from 'rxjs';
import { AssetResponse, AssetsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { PageTitle, recordTitle } from '../../../core/title/page-title';
import { Badge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { EntityActivity } from '../../../shared/ui/entity-activity';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { matterLinkOf } from '../../../shared/ui/matter-link';
import { RecordAction, RecordHeader } from '../../../shared/ui/record-header';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { RecordSkeleton, recordTabLabel, recordTabs } from '../../../shared/ui/record-skeleton';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { DrillReturn } from '../../../shared/work-queue/drill';
import { AssetDetailsTab } from './asset-details-tab';
import { dialogCopy } from '../../admin/shared/dialog-copy';
import { AssetLinkedTasks, LinkedTaskTotals } from './asset-linked-tasks';

type Tab = 'details' | 'tasks' | 'history';

/**
 * The asset record page (UX S08, #490): `/assets/:id`, like Clients, Matters and Projects. The shared record header (crumb, clamped name,
 * type badge, Active/Inactive badge, the matter on the context line), the action rule Edit, Activity, overflow (Set inactive / Set active;
 * no primary action, linking is made from the Task page), and `mf-tabs` Details | Linked tasks (n) | History in `?tab=`. The shared record
 * states answer 404, 403 and failures (#491); focus goes to the heading when the page opens, or to the selected tab when the person comes
 * back to it (#494). Assets are deactivated, never deleted.
 */
@Component({
  selector: 'mf-asset-record-page',
  imports: [
    FixedPage,
    ScrollArea,
    RecordHeader,
    RecordState,
    RecordSkeleton,
    Tabs,
    Badge,
    MatterRef,
    ConfirmDialog,
    EntityActivity,
    AssetDetailsTab,
    AssetLinkedTasks,
    WorkStrip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    /* The matter number on the context line is a 24 px target without growing the line (WCAG 2.2 2.5.8): padding that margin takes back. */
    [data-matter] ::ng-deep a.mf-ref {
      margin-block: -5px;
      padding-block: 5px;
    }
  `,
  template: `
    <mf-fixed-page>
      <span class="pg-sr" role="status" data-record-live>{{ flow.live() }}</span>
      @switch (state()) {
        @case ('loading') {
          <mf-record-skeleton kind="asset" [activeTab]="current()" />
        }
        @case ('ready') {
          @if (asset(); as a) {
            <mf-record-header
              kind="asset"
              [parents]="[{ label: 'Assets', link: '/assets' }]"
              [current]="a.displayName"
              [name]="a.displayName"
              [active]="a.isActive"
              [actions]="headerActions()"
            >
              <span mfBadges>
                <mf-badge tone="info" data-type-badge>{{ a.assetTypeName }}</mf-badge>
              </span>
              <span mfContext data-matter
                >Matter
                <mf-matter-ref [value]="a.matterRef" [link]="matterLink()" [copy]="false" />
                {{ a.matterName }}
              </span>
            </mf-record-header>

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

            <mf-work-strip label="Asset summary" [items]="strip()" data-asset-strip />

            <mf-tabs
              label="Asset sections"
              idPrefix="asset"
              [tabs]="tabs()"
              [selected]="current()"
              (tabChange)="select($event)"
            />
            <div
              class="mf-fill"
              role="tabpanel"
              id="asset-panel"
              [attr.aria-labelledby]="'asset-tab-' + current()"
            >
              @switch (current()) {
                @case ('details') {
                  <div class="mf-scroll-area" mfScrollArea="Asset details" data-details-tab>
                    <mf-asset-details-tab [asset]="a" />
                  </div>
                }
                @case ('tasks') {
                  <div class="mf-scroll-area" mfScrollArea="Linked tasks" data-tasks-tab>
                    <h2 class="pg-sr">Linked tasks</h2>
                    <mf-asset-linked-tasks [assetId]="a.assetId" (loaded)="totals.set($event)" />
                  </div>
                }
                @case ('history') {
                  <div class="mf-scroll-area" mfScrollArea="Asset history" data-history-tab>
                    <h2 class="pg-sr">History</h2>
                    <mf-entity-activity objectType="Asset" [objectId]="a.assetId" />
                  </div>
                }
              }
            </div>

            <mf-confirm-dialog
              [title]="toggleCopy().title"
              [confirmLabel]="toggleCopy().confirm"
              [cancelLabel]="toggleCopy().cancel"
              [danger]="toggleCopy().danger"
              [busy]="busy()"
              [(visible)]="toggleOpen"
              (confirmed)="toggleActive()"
            >
              @if (a.isActive) {
                <p data-toggle-body>Set {{ a.displayName }} inactive? {{ toggleCopy().body }}</p>
              } @else {
                <p data-toggle-body>Reactivate {{ a.displayName }}?</p>
              }
            </mf-confirm-dialog>
          }
        }
        @default {
          <mf-record-state
            kind="asset"
            [recordId]="assetId()"
            [state]="state()"
            [busy]="flow.retrying()"
            (retried)="load()"
          />
        }
      }
    </mf-fixed-page>
  `,
})
export class AssetRecordPage {
  readonly assetId = input.required<string>();
  /** `?tab=`: `details` (default, also when absent), `tasks` or `history` (needs Audit.View). */
  readonly tab = input<string>();

  private readonly api = inject(AssetsClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);
  private readonly drill = inject(DrillReturn);
  private readonly injector = inject(Injector);

  protected readonly flow = new RecordLoadFlow('asset');
  protected readonly state = this.flow.state;
  protected readonly asset = signal<AssetResponse | null>(null);
  protected readonly toggleOpen = signal(false);
  protected readonly busy = signal(false);

  protected readonly canTasks = computed(() => this.auth.has('Task.View'));
  protected readonly canHistory = computed(() => this.auth.has('Audit.View'));
  protected readonly matterLink = computed(() =>
    matterLinkOf(this.auth, this.asset()?.matterId, this.asset()?.matterCanOpen),
  );

  /** What the Linked tasks tab learned (Overdue needs its list): null until the tab has been opened for this asset. */
  protected readonly totals = signal<LinkedTaskTotals | null>(null);
  private readonly zone = inject(USER_TIME_ZONE);

  /**
   * The summary strip (#506): Open and Linked from the counts that come with the asset (no extra request), Overdue only once the Linked tasks
   * tab has loaded (omitted rather than guessed), Created and Modified. The task items are absent without `Task.View`. Open and Overdue link
   * to the Linked tasks tab; Linked and the dates are plain text (nothing opens from them).
   */
  protected readonly strip = computed<WorkStripItem[]>(() => {
    const a = this.asset();
    if (!a) return [];
    const items: WorkStripItem[] = [];
    if (this.canTasks()) {
      const tasksTab = { path: '/assets/' + a.assetId, queryParams: { tab: 'tasks' } };
      const open = a.openLinkedTaskCount ?? null;
      items.push({
        key: 'open',
        label: 'Open',
        count: open,
        hint: 'Linked tasks that are New, In Progress or On Hold',
        ...(open ? { link: tasksTab } : {}),
      });
      const overdue = this.totals()?.overdue;
      if (overdue !== undefined) {
        items.push({
          key: 'overdue',
          label: 'Overdue',
          count: overdue,
          alert: true,
          hint: 'Open linked tasks past their due date',
          ...(overdue > 0 ? { link: tasksTab } : {}),
        });
      }
      items.push({
        key: 'linked',
        label: 'Linked',
        count: a.linkedTaskCount ?? null,
        hint: 'All tasks linked to this asset',
      });
    }
    items.push({
      key: 'created',
      label: 'Created',
      count: null,
      value: mfDate(a.createdAtUtc, this.zone, 'date'),
    });
    if (a.modifiedAtUtc) {
      items.push({
        key: 'modified',
        label: 'Modified',
        count: null,
        value: mfDate(a.modifiedAtUtc, this.zone, 'date'),
      });
    }
    return items;
  });

  /** The Set inactive / Set active dialog (#507): the open linked tasks that keep the link, when the count is known (not without Task.View). */
  protected readonly toggleCopy = computed(() => {
    const a = this.asset();
    return a?.isActive
      ? dialogCopy.deactivateAsset({
          openTasks: this.canTasks() ? (a.openLinkedTaskCount ?? null) : null,
        })
      : {
          title: 'Reactivate asset',
          body: '',
          confirm: 'Set active',
          cancel: 'Cancel',
          danger: false,
        };
  });

  protected readonly tabs = computed<MfTab[]>(() => {
    // The number of linked tasks (all) comes with the asset (#496): absent without Task.View, where the API sends null.
    const count = this.canTasks() ? (this.asset()?.linkedTaskCount ?? null) : null;
    const all = recordTabs('asset', { tasks: count });
    return this.canHistory() ? all : all.filter((t) => t.key !== 'history');
  });
  protected readonly current = computed<Tab>(() => {
    const t = this.tab();
    if (t === 'tasks') return 'tasks';
    return t === 'history' && this.canHistory() ? 'history' : 'details';
  });

  /** The header's actions: Edit (hidden for an inactive asset), Activity (opens History) and, in the overflow, Set inactive / Set active. */
  protected readonly headerActions = computed<RecordAction[]>(() => {
    const a = this.asset();
    if (!a) return [];
    const list: RecordAction[] = [];
    if (this.auth.has('Asset.Edit') && a.isActive) {
      list.push({
        id: 'edit',
        role: 'edit',
        label: 'Edit',
        run: () => void this.router.navigateByUrl('/assets/' + a.assetId + '/edit'),
      });
    }
    if (this.canHistory()) {
      list.push({
        id: 'activity',
        role: 'activity',
        label: 'Activity',
        icon: 'pi-history',
        run: () => this.select('history'),
      });
    }
    if (this.auth.has('Asset.Edit')) {
      list.push({
        id: 'toggle-active',
        role: 'state',
        label: a.isActive ? 'Set inactive' : 'Set active',
        run: () => this.toggleOpen.set(true),
      });
    }
    return list;
  });

  private focused = false;

  constructor() {
    // `Name: Details` once the record is known, the state's name until then; kept through tab changes.
    effect(() => {
      const a = this.state() === 'ready' ? this.asset() : null;
      this.pageTitle.pin(
        a
          ? recordTitle(a.displayName, recordTabLabel('asset', this.current()))
          : recordStateTitle('asset', this.state()),
      );
    });
    inject(DestroyRef).onDestroy(() => this.pageTitle.unpin());
    effect(() => {
      this.assetId();
      untracked(() => void this.load());
    });
    // The page just opened: the heading has focus (read out); a return from another page (Back, "Back to Assets") focuses the selected tab.
    effect(() => {
      if (this.state() !== 'ready' || this.focused) return;
      this.focused = true;
      const returned = untracked(() => this.drill.takeTab([]));
      afterNextRender(
        () => {
          const target = returned
            ? document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
            : document.querySelector<HTMLElement>('[data-page-title]');
          if (!returned) target?.setAttribute('tabindex', '-1');
          target?.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
    });
  }

  /** Focus on the heading once the closing dialog is gone (its leave animation would otherwise take focus with it). */
  private focusHeading(tries = 0): void {
    if (document.querySelector('.p-dialog-mask') && tries < 20) {
      setTimeout(() => this.focusHeading(tries + 1), 50);
      return;
    }
    const heading = document.querySelector<HTMLElement>('[data-page-title]');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }

  protected select(key: string): void {
    void this.router.navigate([], {
      queryParams: { tab: key === 'details' ? null : key },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  async load(): Promise<void> {
    const id = Number(this.assetId());
    this.focused = false;
    this.totals.set(null);
    await this.flow.run(
      () => firstValueFrom(this.api.getAsset(id)),
      (asset) => {
        this.asset.set(asset);
      },
    );
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
      // After a confirmed change focus is on the heading (the status badge in the header has changed); Cancel and Escape give focus back to the opener.
      setTimeout(() => this.focusHeading(), 0);
    } catch {
      this.toggleOpen.set(false);
      await this.load(); // conflicts and failures are toasted by the HTTP layer; show the latest state
    } finally {
      this.busy.set(false);
    }
  }
}
