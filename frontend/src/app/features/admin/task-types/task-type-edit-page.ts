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
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { FormVersionStatus } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { WorkflowLookup, WorkflowOption } from '../../../core/lookups/workflow-lookup';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { TaskTypeView, TaskTypesApi } from './task-types-api';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { PageTitle } from '../../../core/title/page-title';
import { PageHeader } from '../../../shared/ui/page-header';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { DEFAULT_TASK_TYPE_ICON } from '../../../shared/icons/task-type-icon';
import { TaskTypeIconPicker } from '../../../shared/icons/task-type-icon-picker';

interface Model {
  name: string;
  description: string;
  iconKey: string;
  isActive: boolean;
  eligible: number[];
  defaultWorkflow: number | null;
}

const EMPTY: Model = {
  name: '',
  description: '',
  iconKey: DEFAULT_TASK_TYPE_ICON,
  isActive: true,
  eligible: [],
  defaultWorkflow: null,
};

const key = (m: Model): string =>
  JSON.stringify({
    ...m,
    name: m.name.trim(),
    description: m.description.trim(),
    eligible: [...m.eligible].sort(),
  });

/**
 * Admin: create or edit one Task Type (UX S14 General + Workflows). Name, description, active, the eligible workflows (picked from the
 * workflow lookup) and the default workflow, plus the link into the request form designer. A new type is saved first; its form is then
 * designed on `/admin/task-types/:id/form`. Needs `TaskType.Manage`.
 */
@Component({
  selector: 'mf-task-type-edit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeader,
    ConfirmDialog,
    RecordState,
    FormsModule,
    RouterLink,
    Button,
    TaskTypeIconPicker,
  ],
  templateUrl: './task-type-edit-page.html',
  styleUrls: ['../admin-lookup.scss', './task-type-edit-page.scss'],
})
export class TaskTypeEditPage implements HasUnsavedChanges {
  /** Route parameter `id`; absent on `/admin/task-types/new`. */
  readonly id = input<string | undefined>(undefined);

  private readonly api = inject(TaskTypesApi);
  private readonly lookup = inject(WorkflowLookup);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);

  /** The shared load flow of the record pages (#353): 404, 403 and failures show `mf-record-state`; the request is quiet (no toast). */
  protected readonly flow = new RecordLoadFlow('taskType');
  protected readonly state = this.flow.state;
  protected readonly taskType = signal<TaskTypeView | null>(null);
  protected readonly workflows = signal<WorkflowOption[]>([]);
  protected readonly model = signal<Model>({ ...EMPTY });
  private readonly saved = signal<Model>({ ...EMPTY });
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly conflict = signal(false);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly announcement = signal('');

  protected readonly isNew = computed(() => this.id() === undefined);
  protected readonly dirty = computed(() => key(this.model()) !== key(this.saved()));
  protected readonly eligibleOptions = computed(() =>
    this.workflows().filter((w) => this.model().eligible.includes(w.id)),
  );
  /** Ids the type is eligible for that the lookup does not know (for example a workflow retired since). */
  protected readonly unknownEligible = computed(() => {
    const known = new Set(this.workflows().map((w) => w.id));
    return this.model().eligible.filter((id) => !known.has(id));
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    // The tab title names the record, like the detail pages do (UXR2-17), or the state ("Task type not found", #353).
    effect(() => {
      const state = this.state();
      const name = this.taskType()?.name;
      if (state === 'notFound' || state === 'forbidden' || state === 'error') {
        this.pageTitle.set(recordStateTitle('taskType', state));
      } else if (name) this.pageTitle.set(name);
    });
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  protected async load(id: string | undefined): Promise<void> {
    this.failure.set('');
    this.conflict.set(false);
    await this.flow.run(
      () =>
        Promise.all([
          // Without Workflow.Manage the workflow list answers 403: the page still opens (the workflows show as "Workflow n").
          firstValueFrom(this.lookup.list()).catch((e: unknown): WorkflowOption[] => {
            if (e instanceof ApiError && e.status === 403) return [];
            throw e;
          }),
          id === undefined ? Promise.resolve(null) : firstValueFrom(this.api.get(Number(id))),
        ]),
      ([workflows, t]) => {
        this.workflows.set(workflows);
        this.taskType.set(t);
        this.apply(t ? this.modelOf(t) : { ...EMPTY });
      },
    );
  }

  protected readonly deactivateOpen = signal(false);

  protected confirmDeactivate(): void {
    this.deactivateOpen.set(false);
    void this.save(true);
  }

  protected retry(): void {
    void this.load(this.id());
  }

  private modelOf(t: TaskTypeView): Model {
    return {
      name: t.name,
      description: t.description ?? '',
      iconKey: t.iconKey,
      isActive: t.isActive,
      eligible: [...t.eligibleWorkflowIds],
      defaultWorkflow: t.defaultWorkflowDefinitionId ?? null,
    };
  }

  private apply(m: Model): void {
    this.model.set(m);
    this.saved.set({ ...m, eligible: [...m.eligible] });
    this.fieldErrors.set({});
  }

  protected patch(change: Partial<Model>): void {
    this.model.set({ ...this.model(), ...change });
    this.fieldErrors.set({});
  }

  protected isEligible(id: number): boolean {
    return this.model().eligible.includes(id);
  }

  protected toggleEligible(w: WorkflowOption, on: boolean): void {
    const current = this.model();
    const eligible = on
      ? [...new Set([...current.eligible, w.id])].sort((a, b) => a - b)
      : current.eligible.filter((x) => x !== w.id);
    // The default must stay one of the eligible workflows.
    const dropsDefault = !on && current.defaultWorkflow === w.id;
    this.patch({ eligible, defaultWorkflow: dropsDefault ? null : current.defaultWorkflow });
    if (dropsDefault) this.announcement.set(`${w.name} is no longer the default workflow.`);
  }

  protected workflowLabel(w: WorkflowOption): string {
    const name = w.isActive === false ? `${w.name} (inactive)` : w.name;
    return w.publishedVersionNo
      ? `${name} (published v${w.publishedVersionNo})`
      : `${name} (not published yet)`;
  }

  protected formSummary(t: TaskTypeView | null): string {
    switch (t?.formStatus) {
      case FormVersionStatus.Published:
        return `Published v${t.publishedFormVersionNo}`;
      case FormVersionStatus.Draft:
        return `Draft v${t.draftFormVersionNo}, not published yet`;
      case FormVersionStatus.Retired:
        return 'Retired, no published version';
      default:
        return 'No fields yet';
    }
  }

  protected issueText(code: string): string {
    switch (code) {
      case 'INACTIVE':
        return 'The task type is inactive.';
      case 'FORM_NOT_PUBLISHED':
        return "The request form isn't published.";
      case 'NO_ELIGIBLE_WORKFLOW':
        return 'No eligible workflow is selected.';
      default:
        return code;
    }
  }

  protected async save(deactivationConfirmed = false): Promise<void> {
    const m = this.model();
    const name = m.name.trim();
    if (!name) {
      this.fieldErrors.set({ name: 'Enter a name.' });
      return;
    }
    if (!m.iconKey) {
      this.fieldErrors.set({ iconKey: 'Choose an icon.' });
      return;
    }
    if (!deactivationConfirmed && this.taskType()?.isActive && !m.isActive) {
      this.deactivateOpen.set(true);
      return;
    }
    this.busy.set(true);
    this.failure.set('');
    this.conflict.set(false);
    try {
      const description = m.description.trim() || undefined;
      const defaultWorkflowDefinitionId = m.defaultWorkflow ?? undefined;
      const current = this.taskType();
      if (!current) {
        const created = await firstValueFrom(
          this.api.create({
            name,
            description,
            iconKey: m.iconKey,
            isActive: m.isActive,
            eligibleWorkflowIds: m.eligible,
            defaultWorkflowDefinitionId,
          }),
        );
        this.apply(this.modelOf(created));
        this.notify.success('Task type created.');
        await this.router.navigate(['/admin/task-types', created.id]);
      } else {
        const updated = await firstValueFrom(
          this.api.update(current.id, {
            name,
            description,
            iconKey: m.iconKey,
            isActive: m.isActive,
            eligibleWorkflowIds: m.eligible,
            defaultWorkflowDefinitionId,
            rowVersion: current.rowVersion,
          }),
        );
        this.taskType.set(updated);
        this.apply(this.modelOf(updated));
        this.announcement.set(`${updated.name} saved.`);
        this.notify.success('Saved.');
      }
    } catch (e) {
      const errors = serverFormErrors(e);
      if (errors.conflict) this.conflict.set(true);
      else if (Object.keys(errors.fields).length > 0) this.fieldErrors.set(errors.fields);
      else this.failure.set(e instanceof Error ? e.message : 'Couldn’t save. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  /** After a conflict: take the latest saved version (dropping local edits). */
  protected async reload(): Promise<void> {
    await this.load(this.id());
  }
}
