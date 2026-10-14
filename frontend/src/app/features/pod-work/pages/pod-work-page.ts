import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import {
  PodWorkClient,
  PodWorkPage as PodWorkData,
  TaskQueueRow,
  TasksClient,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { loadLastPod, saveLastPod } from '../../../shared/work-queue/column-prefs';
import { QueueState, queueArgs } from '../../../shared/work-queue/queue-filters';
import { QueuePageBase } from '../../../shared/work-queue/queue-page';
import { PodOption, WorkFilterBar } from '../../../shared/work-queue/work-filter-bar';
import { WorkList } from '../../../shared/work-queue/work-list';
import { WorkTab, WorkTabs } from '../../../shared/work-queue/work-tabs';

type TabKey = 'queue' | 'members' | 'attention' | 'all';

/**
 * Pod Work (UX S04, ticket 50): the open work of one Pod. A filtered view, not a security boundary: everyone with Task.View can
 * see every Task in the Task Queue. Tabs: the Pod queue (assigned to the Pod but to nobody), By member (workload facts per person,
 * never a ranking), Overdue and On Hold, and All. Anyone with Task.Assign can take an unassigned task with "Assign to me".
 */
@Component({
  selector: 'mf-pod-work-page',
  imports: [WorkFilterBar, WorkList, WorkTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/work-queue/work-page.scss',
  template: `
    <header class="wp-head">
      <h1 class="wp-title">Pod Work</h1>
      @if (pods().length > 0) {
        <div class="wp-field">
          <label for="pw-pod">Pod</label>
          <select
            id="pw-pod"
            class="wp-select"
            [value]="data()?.pod?.podId ?? ''"
            (change)="selectPod($any($event.target).value)"
          >
            @if (!data()?.pod) {
              <option value="" selected>Choose a Pod</option>
            }
            @if (yourPods().length > 0) {
              <optgroup label="Your pods">
                @for (p of yourPods(); track p.podId) {
                  <option [value]="p.podId" [selected]="p.podId === data()?.pod?.podId">
                    {{ p.name }}{{ p.isPrimary ? ' (primary)' : '' }}
                  </option>
                }
              </optgroup>
            }
            @if (otherPods().length > 0) {
              <optgroup label="Other pods">
                @for (p of otherPods(); track p.podId) {
                  <option [value]="p.podId" [selected]="p.podId === data()?.pod?.podId">
                    {{ p.name }}
                  </option>
                }
              </optgroup>
            }
          </select>
        </div>
      }
    </header>

    @if (loadState() === 'ready' && pods().length === 0) {
      <div class="wl-empty-note" data-empty="no-pod" role="status">
        You aren't in a pod yet. Ask an administrator.
      </div>
    } @else if (loadState() === 'ready' && !data()?.pod) {
      <div class="wl-empty-note" data-empty="choose" role="status">
        Choose a Pod to see its work.
      </div>
    } @else {
      @if (data(); as d) {
        <ul class="wp-summary" aria-label="Pod summary" data-summary>
          <li>
            Unassigned to a person <strong>{{ d.summary.unassignedToPerson }}</strong>
          </li>
          <li>
            Assigned <strong>{{ d.summary.assigned }}</strong>
          </li>
          <li>
            Overdue <strong>{{ d.summary.overdue }}</strong>
          </li>
          <li>
            On Hold <strong>{{ d.summary.onHold }}</strong>
          </li>
        </ul>
      }

      <mf-work-tabs
        label="Pod Work views"
        idPrefix="pw"
        [tabs]="tabs()"
        [selected]="tab()"
        (selectedChange)="selectTab($event)"
      />

      <mf-work-filter-bar
        [filters]="state().filters"
        [names]="chipNames()"
        [pods]="podOptions()"
        [userId]="userId()"
        [hidden]="['pod']"
        (filtersChange)="setFilters($event)"
        (clearAll)="clearFilters()"
      />

      <div role="tabpanel" id="pw-panel" [attr.aria-labelledby]="'pw-tab-' + tab()">
        @if (tab() === 'members') {
          @if (data(); as d) {
            @if (d.memberLoads.length === 0) {
              <p class="wp-note" data-members-empty>No members yet.</p>
            } @else {
              <table class="wp-members" data-members>
                <caption class="wp-help">
                  Open work per person. These are workload facts, not a ranking.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Open</th>
                    <th scope="col">Overdue</th>
                    <th scope="col">On Hold</th>
                    <th scope="col"><span class="wp-sr">Show tasks</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (m of d.memberLoads; track m.userId) {
                    <tr>
                      <th scope="row">
                        {{ m.displayName }}
                        @if (!m.isActive) {
                          <span class="wp-note">(inactive)</span>
                        }
                      </th>
                      <td>{{ m.open }}</td>
                      <td>{{ m.overdue }}</td>
                      <td>{{ m.onHold }}</td>
                      <td>
                        <button
                          type="button"
                          class="wp-button"
                          [attr.aria-pressed]="state().filters.assignee.includes(m.userId)"
                          [attr.aria-label]="'Show tasks of ' + m.displayName"
                          (click)="toggleMember(m.userId)"
                        >
                          Show tasks
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          }
        }

        <mf-work-list
          [rows]="rows()"
          [total]="total()"
          [page]="state().page"
          [pageSize]="state().pageSize"
          [state]="loadState()"
          [columns]="prefs().columns"
          [density]="prefs().density"
          [sort]="state().sort"
          [dir]="state().dir"
          [filtered]="filtered()"
          [caption]="'Pod Work: ' + (data()?.pod?.name ?? '')"
          [emptyText]="emptyText()"
          [showAssign]="canAssign()"
          (sortChange)="sortBy($event)"
          (resetSort)="resetSort()"
          (pageChange)="goToPage($event)"
          (pageSizeChange)="setPageSize($event)"
          (columnsChange)="setColumns($event)"
          (densityChange)="setDensity($event)"
          (retry)="load()"
          (clearFilters)="clearFilters()"
          (rowChange)="replaceRow($event)"
          (assignToMe)="assignToMe($event)"
        />
      </div>
    }
  `,
})
export class PodWorkPage extends QueuePageBase<PodWorkData> {
  private readonly api = inject(PodWorkClient);
  private readonly tasks = inject(TasksClient);
  private readonly notify = inject(NotificationService);

  protected readonly tab = computed<TabKey>(() => {
    const view = this.state().view;
    return view === 'members' || view === 'attention' || view === 'all' ? view : 'queue';
  });

  protected readonly pods = computed(() => this.data()?.pods ?? []);
  protected readonly yourPods = computed(() => this.pods().filter((p) => p.isMember));
  protected readonly otherPods = computed(() => this.pods().filter((p) => !p.isMember));
  protected readonly podOptions = signal<PodOption[]>([]);
  protected readonly canAssign = computed(
    () => this.auth.has('Task.Assign') && this.tab() !== 'members',
  );

  protected readonly tabs = computed<WorkTab[]>(() => {
    const counts = this.data()?.counts;
    return [
      { key: 'queue', label: 'Pod queue (unassigned to person)', count: counts?.queue ?? null },
      { key: 'members', label: 'By member', count: counts?.members ?? null },
      { key: 'attention', label: 'Overdue & On Hold', count: counts?.attention ?? null },
      { key: 'all', label: 'All Pod tasks', count: counts?.all ?? null },
    ];
  });

  protected readonly emptyText = computed(() => {
    const name = this.data()?.pod?.name ?? 'this Pod';
    switch (this.tab()) {
      case 'queue':
        return `Nothing waiting in ${name}.`;
      case 'members':
        return `Nobody in ${name} has open work.`;
      case 'attention':
        return `Nothing overdue or on hold in ${name}.`;
      default:
        return `No open tasks in ${name}.`;
    }
  });

  /** The remembered Pod is applied once, when the URL names none. */
  private pendingRemembered = false;

  constructor() {
    super('pod-work');
    const keys = this.route.snapshot?.queryParamMap?.keys ?? [];
    const remembered = loadLastPod(this.userId());
    if (!keys.includes('podId') && remembered !== null) {
      this.pendingRemembered = true;
      this.navigate({ ...this.state(), podId: remembered }, true);
    }
  }

  protected override shouldLoad(state: QueueState): boolean {
    if (this.pendingRemembered) {
      if (state.podId === null) return false;
      this.pendingRemembered = false;
    }
    return true;
  }

  protected override fetch(state: QueueState): Observable<PodWorkData> {
    return this.api.getPodWork(
      state.podId ?? undefined,
      this.tab(),
      ...queueArgs(state, { omitPod: true }),
    );
  }

  protected override loaded(data: PodWorkData): void {
    this.podOptions.set(data.pods.map((p) => ({ id: p.podId, name: p.name })));
    if (data.pod) saveLastPod(this.userId(), data.pod.podId);
  }

  protected override podName(id: number): string | null {
    return this.pods().find((p) => p.podId === id)?.name ?? null;
  }

  protected selectPod(value: string): void {
    const podId = Number(value);
    if (!Number.isInteger(podId) || podId <= 0) return;
    this.navigate({
      ...this.state(),
      podId,
      page: 1,
      filters: { ...this.state().filters, assignee: [] },
    });
  }

  protected selectTab(key: string): void {
    if (key === this.tab()) return;
    this.navigate({
      ...this.state(),
      view: key === 'queue' ? null : key,
      page: 1,
      sort: null,
      dir: null,
      filters: { ...this.state().filters, assignee: [], unassigned: false },
    });
  }

  protected toggleMember(userId: number): void {
    const s = this.state();
    const assignee = s.filters.assignee.includes(userId) ? [] : [userId];
    this.navigate({ ...s, page: 1, filters: { ...s.filters, assignee } });
  }

  /** The lightweight self-assign (UX S04): ordinary assignment through the Task API; assigning a person starts a New task. */
  protected async assignToMe(row: TaskQueueRow): Promise<void> {
    const me = this.userId();
    if (me === null) return;
    try {
      await firstValueFrom(
        this.tasks.assignTask(row.taskId, {
          rowVersion: row.rowVersion,
          podId: row.assignedPod?.podId ?? this.data()?.pod?.podId,
          userId: me,
        }),
      );
      this.notify.success(
        row.status === 'NEW' ? 'Assigned to you. Task moved to In Progress.' : 'Assigned to you.',
      );
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      this.notify.error(
        conflict
          ? 'Someone else changed this task. The list was refreshed.'
          : "We couldn't assign this task. Try again.",
      );
    }
    await this.load();
  }
}
