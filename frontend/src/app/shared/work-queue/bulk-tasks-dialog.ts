import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  BulkTaskResult,
  BulkTasksRequest,
  BulkTasksResponse,
  MatterBulkTasksClient,
  PodSummary,
  PodsClient,
  UsersLookupClient,
} from '../../api/generated/api-client';
import { outOfOfficeText } from '../../core/availability/availability';
import { LookupStore } from '../../core/lookups/lookup-store';
import { ApiError } from '../../core/http/api-error';
import { QuietRequests } from '../../core/http/interceptors';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { EntityPicker, PickerOption } from '../ui/entity-picker';

export type BulkMode = 'assign' | 'priority';

/** One selected task: its id and how the result list names it. */
export interface BulkTarget {
  readonly taskId: number;
  readonly taskNumber: string;
  readonly title: string;
}

/** The most tasks one call takes (the API's limit). */
export const BULK_MAX = 100;

const KEEP_POD = '';

/** The reason of a task that was not changed, in plain words. */
export function bulkReason(r: BulkTaskResult): string {
  switch (r.code) {
    case 'NOT_FOUND':
      return 'it no longer exists';
    case 'NOT_IN_MATTER':
      return 'it is not a task of this matter';
    case 'TASK_NOT_EDITABLE':
      return 'it is completed or cancelled';
    case 'CONCURRENCY_CONFLICT':
      return 'somebody else changed it meanwhile; reload the list';
    default:
      return r.message || 'it could not be changed';
  }
}

/** A warning on a task that was changed. */
export function bulkWarning(code: string): string {
  return code === 'USER_NOT_IN_POD'
    ? 'the person is not a member of the task’s pod'
    : code.toLowerCase().replace(/_/g, ' ');
}

/**
 * Re-assign or set the priority of the tasks selected in one matter's task grid (epic #667, README 6.7). One call, one correlation id: each
 * task follows the single-task rules and the answer lists every task. The dialog states the count and that there is no undo in one step
 * (reversing is another bulk action); a person alone keeps each task's pod, a pod alone moves the tasks to its queue and clears the
 * person, both set both. A person from another pod is a warning in the result, not a block. The result view says "12 changed, 2 could not
 * be changed" and lists the tasks that were not changed with the reason; the page then keeps those selected.
 */
@Component({
  selector: 'mf-bulk-tasks-dialog',
  imports: [ConfirmDialog, EntityPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bd {
      display: grid;
      gap: var(--mf-s3);
    }
    .bd__field {
      display: grid;
      gap: var(--mf-s1);
    }
    .bd__label {
      font-weight: 600;
    }
    .bd__help,
    .bd__note {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .bd__summary {
      margin: 0;
      font-weight: 600;
    }
    .bd__list {
      margin: 0;
      padding-left: var(--mf-s5);
      overflow-wrap: anywhere;
    }
  `,
  template: `
    <mf-confirm-dialog
      [title]="title()"
      [confirmLabel]="confirmLabel()"
      [cancelLabel]="phase() === 'result' ? 'Close' : 'Cancel'"
      [showConfirm]="phase() === 'form'"
      [busy]="busy()"
      [error]="error()"
      scrollLabel="Bulk change"
      [(visible)]="visible"
      (confirmed)="run()"
    >
      <div class="bd" data-bulk-dialog [attr.data-phase]="phase()">
        @if (phase() === 'form') {
          <p class="bd__summary" data-bulk-count>
            {{ targets().length }} {{ targets().length === 1 ? 'task' : 'tasks' }} selected.
          </p>
          @if (mode() === 'assign') {
            <div class="bd__field">
              <mf-entity-picker
                label="Assign to"
                inputId="bulk-person"
                placeholder="Search people (leave empty to keep the person)"
                [search]="searchPeople"
                [(selected)]="person"
              />
            </div>
            @if (pods().length > 0) {
              <div class="bd__field">
                <label class="bd__label" for="bulk-pod">Pod</label>
                <select
                  id="bulk-pod"
                  class="mf-control"
                  data-bulk-pod
                  (change)="pod.set($any($event.target).value)"
                >
                  <option value="" [selected]="pod() === ''">Keep each task’s pod</option>
                  @for (p of pods(); track p.podId) {
                    <option [value]="p.podId" [selected]="pod() === '' + p.podId">
                      {{ p.name }}
                    </option>
                  }
                </select>
              </div>
            }
            <p class="bd__help">
              A person alone keeps each task’s pod. A pod alone moves the tasks to the pod’s queue
              and clears the person. A person who is not in the task’s pod is allowed; the result
              tells you.
            </p>
          } @else {
            <div class="bd__field">
              <label class="bd__label" for="bulk-priority">Priority</label>
              <select
                id="bulk-priority"
                class="mf-control"
                data-bulk-priority
                (change)="priority.set($any($event.target).value)"
              >
                <option value="" [selected]="priority() === ''">Choose a priority</option>
                @for (p of priorities(); track p.id) {
                  <option [value]="p.id" [selected]="priority() === '' + p.id">
                    {{ p.label }}
                  </option>
                }
              </select>
            </div>
          }
          <p class="bd__note" data-bulk-undo>
            This can’t be undone in one step. To reverse it, run another bulk change.
          </p>
        } @else {
          <p class="bd__summary" role="status" data-bulk-summary>
            {{ summary() }}
          </p>
          @if (notChanged().length > 0) {
            <div data-bulk-failed>
              <p class="bd__label">Not changed:</p>
              <ul class="bd__list">
                @for (f of notChanged(); track f.taskId) {
                  <li data-bulk-failed-row>{{ label(f.taskId) }}: {{ reason(f) }}</li>
                }
              </ul>
            </div>
          }
          @if (warned().length > 0) {
            <div data-bulk-warned>
              <p class="bd__label">Changed, with a note:</p>
              <ul class="bd__list">
                @for (w of warned(); track w.taskId) {
                  <li data-bulk-warned-row>{{ label(w.taskId) }}: {{ warning(w) }}</li>
                }
              </ul>
            </div>
          }
        }
      </div>
    </mf-confirm-dialog>
  `,
})
export class BulkTasksDialog {
  readonly mode = input.required<BulkMode>();
  readonly matterId = input.required<number>();
  readonly targets = input.required<readonly BulkTarget[]>();
  readonly visible = model(false);
  /** Fires when a run finished (the page reloads its list and keeps the tasks that were not changed selected). */
  readonly finished = output<BulkTasksResponse>();

  private readonly api = inject(MatterBulkTasksClient);
  private readonly users = inject(UsersLookupClient);
  private readonly podsApi = inject(PodsClient);
  private readonly lookups = inject(LookupStore);
  private readonly quiet = inject(QuietRequests);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly phase = signal<'form' | 'result'>('form');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly person = signal<PickerOption | null>(null);
  protected readonly pod = signal(KEEP_POD);
  protected readonly priority = signal('');
  protected readonly pods = signal<readonly PodSummary[]>([]);
  protected readonly result = signal<BulkTasksResponse | null>(null);

  protected readonly priorities = computed(() => this.lookups.activePriorities());
  protected readonly title = computed(() =>
    this.phase() === 'result'
      ? 'Result'
      : this.mode() === 'assign'
        ? 'Re-assign tasks'
        : 'Set priority',
  );
  protected readonly confirmLabel = computed(() => {
    const n = this.targets().length;
    const noun = n === 1 ? 'task' : 'tasks';
    return this.mode() === 'assign' ? `Re-assign ${n} ${noun}` : `Set priority on ${n} ${noun}`;
  });
  protected readonly canRun = computed(() =>
    this.mode() === 'assign'
      ? this.person() !== null || this.pod() !== KEEP_POD
      : this.priority() !== '',
  );
  protected readonly notChanged = computed(() => this.result()?.results.filter((r) => !r.ok) ?? []);
  protected readonly warned = computed(
    () => this.result()?.results.filter((r) => r.ok && r.warnings.length > 0) ?? [],
  );
  protected readonly summary = computed(() => {
    const r = this.result();
    if (!r) return '';
    return r.failed === 0
      ? `${r.changed} ${r.changed === 1 ? 'task' : 'tasks'} changed.`
      : `${r.changed} changed, ${r.failed} could not be changed.`;
  });

  protected readonly searchPeople = async (query: string): Promise<PickerOption[]> => {
    const found = await firstValueFrom(
      this.quiet.run(() => this.users.lookupUsers(query || undefined, 8)),
    );
    return found.map((u) => ({
      id: u.userId,
      label: u.displayName,
      flag: outOfOfficeText(u.availability, this.zone) ?? undefined,
    }));
  };

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.phase.set('form');
        this.busy.set(false);
        this.error.set('');
        this.result.set(null);
        this.person.set(null);
        this.pod.set(KEEP_POD);
        this.priority.set('');
        void this.lookups.ensureLoaded();
        if (this.mode() === 'assign') void this.loadPods();
      });
    });
  }

  private async loadPods(): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.quiet.run(() => this.podsApi.listPods(undefined, undefined, true, 1, 100, 'name')),
      );
      this.pods.set(page.items);
    } catch {
      // Without Pod.View the dialog offers the person only.
      this.pods.set([]);
    }
  }

  protected label(taskId: number): string {
    const t = this.targets().find((x) => x.taskId === taskId);
    return t ? `${t.taskNumber} ${t.title}` : `Task ${taskId}`;
  }

  protected reason = bulkReason;

  protected warning(r: BulkTaskResult): string {
    return r.warnings.map(bulkWarning).join(', ');
  }

  protected async run(): Promise<void> {
    if (this.busy()) return;
    if (!this.canRun()) {
      this.error.set(this.mode() === 'assign' ? 'Choose a person or a pod.' : 'Choose a priority.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const body: BulkTasksRequest = { taskIds: this.targets().map((t) => t.taskId) };
    if (this.mode() === 'assign') {
      body.reassignTo = {
        userId: this.person()?.id,
        podId: this.pod() === KEEP_POD ? undefined : Number(this.pod()),
      };
    } else {
      body.priorityId = Number(this.priority());
    }
    try {
      const answer = await firstValueFrom(
        this.quiet.run(() => this.api.bulkChangeMatterTasks(this.matterId(), body)),
      );
      this.result.set(answer);
      this.phase.set('result');
      this.finished.emit(answer);
    } catch (err) {
      this.error.set(
        err instanceof ApiError ? err.message : 'The change could not be made. Try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
