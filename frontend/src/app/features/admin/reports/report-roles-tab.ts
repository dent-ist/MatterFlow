import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ReportAssignmentClient, RoleAssignmentResponse } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { AssignmentChecklist, ChecklistItem, diffMessage } from './assignment-checklist';

/** The members line of a role: `3 people`. */
export const peopleText = (n: number): string => (n === 1 ? '1 person' : `${n} people`);

/**
 * The Roles tab of the report editor (spec 9.4, issue #717; `Report.Assign`): which roles may run this report, as a checklist with the number of
 * people in each role. Saving replaces the whole set and says what changed ("Overdue tasks now has 3 roles (added Pod Lead)"). It shows names and
 * counts only, never the query. A role that is inactive is listed and flagged; the report runs only for people in active roles.
 */
@Component({
  selector: 'mf-report-roles-tab',
  imports: [AssignmentChecklist],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rrt" aria-labelledby="rrt-title" data-roles-tab>
      <h2 id="rrt-title" class="rrt__title">Roles that can run this report</h2>
      <p class="rrt__hint">
        A person runs the report when it is active, they hold the permission to run reports and one
        of their roles is checked here.
      </p>
      <div class="mf-sr-only" role="status" aria-live="polite" data-announce>
        {{ announcement() }}
      </div>
      @if (failure(); as f) {
        <p class="rrt__error" role="alert" data-failure>{{ f }}</p>
      }
      @if (loading()) {
        <p class="rrt__hint" data-loading>Loading the roles...</p>
      } @else {
        <mf-assignment-checklist
          #list
          noun="role"
          legend="Roles that can run this report"
          idPrefix="rrt"
          [items]="items()"
          [busy]="busy()"
          (save)="save($event)"
        />
      }
    </section>
  `,
  styles: `
    .rrt {
      display: grid;
      gap: var(--mf-s3);
    }

    .rrt__title {
      margin: 0;
      font-size: var(--mf-fs-lg);
    }

    .rrt__hint {
      margin: 0;
      color: var(--mf-text-muted);
    }

    .rrt__error {
      margin: 0;
      color: var(--mf-danger);
    }
  `,
})
export class ReportRolesTab {
  private readonly api = inject(ReportAssignmentClient);
  private readonly notify = inject(NotificationService);
  private readonly list = viewChild(AssignmentChecklist);

  readonly reportId = input.required<number>();
  readonly reportName = input('This report');

  protected readonly roles = signal<RoleAssignmentResponse[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');

  protected readonly items = computed<ChecklistItem[]>(() =>
    this.roles().map((r) => ({
      id: r.roleId,
      name: r.name,
      detail: peopleText(r.memberCount),
      flag: r.isActive ? undefined : 'Inactive',
      assigned: r.assigned,
    })),
  );

  constructor() {
    effect(() => {
      this.reportId();
      untracked(() => void this.load());
    });
  }

  hasUnsavedChanges(): boolean {
    return this.list()?.hasUnsavedChanges() ?? false;
  }

  private loaded = false;

  private async load(): Promise<void> {
    // Only the first load replaces the list with a message; after a save the list stays, so focus stays on the button.
    if (!this.loaded) this.loading.set(true);
    this.failure.set('');
    try {
      this.roles.set(await firstValueFrom(this.api.getRolesOfReport(this.reportId())));
      this.loaded = true;
    } catch {
      this.failure.set('The roles could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async save(roleIds: number[]): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const diff = await firstValueFrom(this.api.setRolesOfReport(this.reportId(), { roleIds }));
      const text = diffMessage(
        this.reportName(),
        diff.assignedCount,
        'role',
        diff.added.map((n) => n.name),
        diff.removed.map((n) => n.name),
      );
      this.announcement.set(text);
      this.notify.success(text);
      await this.load();
    } catch (e) {
      this.failure.set(e instanceof ApiError ? e.message : 'The assignment could not be saved.');
    } finally {
      this.busy.set(false);
    }
  }
}
