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
import {
  ReportAssignmentClient,
  ReportAssignmentResponse,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { AssignmentChecklist, ChecklistItem, diffMessage } from './assignment-checklist';

/**
 * The Reports tab of a role on the Users > Roles page (spec 9.4, issue #717; `Report.Assign`): which reports this role may run, grouped by
 * category, inactive reports greyed and labelled. Saving replaces the whole set and says what changed ("Pod Lead now has 3 reports (added
 * Tasks per matter)"). It shows names, categories and descriptions only, never the query. The page that hosts it loads it lazily, so the
 * Roles page does not pull in the Reports client until someone opens the tab.
 */
@Component({
  selector: 'mf-role-reports-tab',
  imports: [AssignmentChecklist],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rrt" aria-labelledby="rrt-title" data-role-reports-tab>
      <h2 id="rrt-title" class="rrt__title">Reports that {{ roleName() }} can run</h2>
      <p class="rrt__hint">
        People in this role can run the checked reports when the report is active and they hold the
        permission to run reports.
      </p>
      <div class="mf-sr-only" role="status" aria-live="polite" data-announce>
        {{ announcement() }}
      </div>
      @if (failure(); as f) {
        <p class="rrt__error" role="alert" data-failure>{{ f }}</p>
      }
      @if (loading()) {
        <p class="rrt__hint" data-loading>Loading the reports...</p>
      } @else {
        <mf-assignment-checklist
          noun="report"
          legend="Reports this role can run"
          idPrefix="rrp"
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
export class RoleReportsTab {
  private readonly api = inject(ReportAssignmentClient);
  private readonly notify = inject(NotificationService);
  private readonly list = viewChild(AssignmentChecklist);

  readonly roleId = input.required<number>();
  readonly roleName = input('this role');

  protected readonly reports = signal<ReportAssignmentResponse[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  private loaded = false;

  protected readonly items = computed<ChecklistItem[]>(() =>
    this.reports().map((r) => ({
      id: r.reportId,
      name: r.name,
      detail: r.description ?? undefined,
      flag: r.isActive ? undefined : 'Inactive',
      group: r.categoryName,
      assigned: r.assigned,
    })),
  );

  constructor() {
    effect(() => {
      this.roleId();
      untracked(() => {
        this.loaded = false;
        void this.load();
      });
    });
  }

  hasUnsavedChanges(): boolean {
    return this.list()?.hasUnsavedChanges() ?? false;
  }

  private async load(): Promise<void> {
    if (!this.loaded) this.loading.set(true);
    this.failure.set('');
    try {
      this.reports.set(await firstValueFrom(this.api.getReportsOfRole(this.roleId())));
      this.loaded = true;
    } catch {
      this.failure.set('The reports could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async save(reportIds: number[]): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const diff = await firstValueFrom(this.api.setReportsOfRole(this.roleId(), { reportIds }));
      const text = diffMessage(
        this.roleName(),
        diff.assignedCount,
        'report',
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
