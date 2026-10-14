import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { FormVersionStatus } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { WorkflowLookup } from '../../../core/lookups/workflow-lookup';
import { NotificationService } from '../../../core/notify/notification.service';
import { TaskTypeView, TaskTypesApi } from './task-types-api';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Admin: Task Types list (UX S14). Name, request form status, eligible workflows, default workflow, with a warning chip for types
 * users can not create Tasks of. A Task Type is never deleted, only deactivated (and reactivated). Needs `TaskType.Manage`.
 */
@Component({
  selector: 'mf-task-types-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConfirmDialog, ErrorReference, RouterLink, Button],
  templateUrl: './task-types-page.html',
  styleUrls: ['../admin-lookup.scss', './task-types-page.scss'],
})
export class TaskTypesPage implements OnInit {
  private readonly api = inject(TaskTypesApi);
  private readonly workflows = inject(WorkflowLookup);
  private readonly notify = inject(NotificationService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<TaskTypeView[]>([]);
  protected readonly workflowNames = signal<ReadonlyMap<number, string>>(new Map());
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly deactivateOpen = signal(false);
  protected readonly deactivateTarget = signal<TaskTypeView | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [rows, workflows] = await Promise.all([
        firstValueFrom(this.api.list()),
        firstValueFrom(this.workflows.list()),
      ]);
      this.rows.set(rows);
      this.workflowNames.set(new Map(workflows.map((w) => [w.id, w.name])));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  protected formStatus(t: TaskTypeView): string {
    switch (t.formStatus) {
      case FormVersionStatus.Published:
        return 'Published';
      case FormVersionStatus.Draft:
        return 'Draft';
      case FormVersionStatus.Retired:
        return 'Retired';
      default:
        return 'No form';
    }
  }

  /** Current form version shown next to the status: published number, else the draft's. */
  protected formVersion(t: TaskTypeView): string {
    if (t.publishedFormVersionNo) return `v${t.publishedFormVersionNo}`;
    if (t.draftFormVersionNo) return `v${t.draftFormVersionNo} (draft)`;
    return '';
  }

  protected workflowName(id: number | undefined): string {
    if (id === undefined || id === null) return 'None';
    return this.workflowNames().get(id) ?? `Workflow ${id}`;
  }

  protected warning(t: TaskTypeView): string {
    if (!t.isActive) return '';
    if (t.usabilityIssues.includes('NO_ELIGIBLE_WORKFLOW')) {
      return "No eligible published workflow: users can't create tasks of this type.";
    }
    if (t.usabilityIssues.includes('FORM_NOT_PUBLISHED')) {
      return "The request form isn't published: users can't create tasks of this type.";
    }
    return '';
  }

  protected askDeactivate(t: TaskTypeView): void {
    this.deactivateTarget.set(t);
    this.deactivateOpen.set(true);
  }

  protected async confirmDeactivate(): Promise<void> {
    const t = this.deactivateTarget();
    this.deactivateOpen.set(false);
    if (t) await this.setActive(t, false);
  }

  protected async setActive(t: TaskTypeView, isActive: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const updated = await firstValueFrom(
        this.api.update(t.id, {
          name: t.name,
          description: t.description,
          isActive,
          eligibleWorkflowIds: t.eligibleWorkflowIds,
          defaultWorkflowDefinitionId: t.defaultWorkflowDefinitionId,
          rowVersion: t.rowVersion,
        }),
      );
      this.rows.set(this.rows().map((r) => (r.id === updated.id ? updated : r)));
      this.announcement.set(`${t.name} ${isActive ? 'activated' : 'deactivated'}.`);
      this.notify.success('Saved.');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed this task type. The list was reloaded; try again.');
        await this.load();
      } else {
        this.failure.set(e instanceof ApiError ? e.message : 'Couldn’t save. Try again.');
      }
    } finally {
      this.busy.set(false);
    }
  }
}
