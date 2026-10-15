import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FormVersionStatus } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { WorkflowLookup, WorkflowOption } from '../../../core/lookups/workflow-lookup';
import { NotificationService } from '../../../core/notify/notification.service';
import { TaskTypeView, TaskTypesApi } from './task-types-api';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ListState, SortHeader, StatusFilter } from '../../../shared/ui/data-table';
import { LocalListPage } from '../../../shared/ui/list-query';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { FilterDef } from '../../../shared/filters/filter-def';
import { ListFilters } from '../../../shared/filters/list-filters';
import { AssocChips, AssocItem } from '../assoc-chips';
import { AssocFilter } from '../assoc-filter';
import { Pager } from '../../../shared/ui/pager';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { SearchBox } from '../../../shared/ui/search-box';

/**
 * Admin: the Task Types tab of the Task Types page (UX S14). Name, request form status and the Workflows column: the eligible workflows
 * as chips linking to the workflow (the default one with a star and the text "default", three chips and then "+n more"; a type with
 * none says "No workflow"), plus a warning chip for types users can not create Tasks of. `?workflow=<id>` limits the list to the types
 * a workflow is eligible for (a removable chip). A Task Type is never deleted, only deactivated (and reactivated). Needs
 * `TaskType.Manage` (the page offers the tab to people who hold it).
 */
@Component({
  selector: 'mf-task-types-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  imports: [
    ScrollArea,
    ConfirmDialog,
    ActiveBadge,
    RouterLink,
    Pager,
    SearchBox,
    StatusFilter,
    SortHeader,
    ListState,
    TaskTypeIcon,
    AssocChips,
    AssocFilter,
  ],
  templateUrl: './task-types-page.html',
  styleUrls: ['../admin-lookup.scss', './task-types-page.scss'],
})
export class TaskTypesPage extends LocalListPage<TaskTypeView> {
  private readonly api = inject(TaskTypesApi);
  private readonly workflows = inject(WorkflowLookup);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly defaultSort = 'name';
  protected readonly workflowOptions = signal<ReadonlyMap<number, WorkflowOption>>(new Map());
  protected readonly workflowNames = computed<ReadonlyMap<number, string>>(
    () => new Map([...this.workflowOptions()].map(([id, w]) => [id, w.name])),
  );

  /** `?workflow=<id>`: a link from a workflow's page or the Workflows tab. No control; a removable chip. */
  protected readonly filters = new ListFilters({
    screen: 'task-types',
    noun: 'task types',
    defs: computed((): FilterDef[] => [
      {
        key: 'workflow',
        label: 'Workflow',
        type: 'text',
        noControl: true,
        normalize: (v) => (/^\d{1,9}$/.test(v) ? v : null),
        valueLabel: (v) => this.workflowName(Number(v)),
      },
    ]),
  });
  protected readonly workflowId = computed<number | undefined>(() => {
    const id = Number(this.filters.text('workflow'));
    return Number.isInteger(id) && id > 0 ? id : undefined;
  });
  /** People without Workflow.Manage cannot open a workflow page: the chips are plain text for them. */
  protected readonly canOpenWorkflows = computed(() => this.auth.has('Workflow.Manage'));
  /** The workflow chips of every row, built once per load of the rows or of the workflow names. */
  protected readonly chips = computed(
    () => new Map(this.all().map((t) => [t.id, this.chipsOf(t)] as const)),
  );
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly deactivateOpen = signal(false);
  protected readonly deactivateTarget = signal<TaskTypeView | null>(null);

  constructor() {
    super();
    // Loads the list, and again when the workflow filter changes.
    effect(() => {
      this.workflowId();
      untracked(() => void this.load());
    });
  }

  protected override extraFilters(): Record<string, unknown> {
    return { workflow: this.workflowId() !== undefined };
  }

  protected override searchText(t: TaskTypeView): string {
    return `${t.name} ${t.description ?? ''}`;
  }

  protected override isActiveRow(t: TaskTypeView): boolean {
    return t.isActive;
  }

  protected override sortValue(t: TaskTypeView, field: string): string | number {
    switch (field) {
      case 'form':
        return this.formStatus(t);
      case 'workflows':
        return t.eligibleWorkflowIds.length;
      default:
        return t.name;
    }
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [rows, workflows] = await Promise.all([
        firstValueFrom(this.api.list(this.workflowId())),
        // Names are a nicety: without Workflow.Manage the chips fall back to "Workflow 7" and are not links.
        firstValueFrom(this.workflows.list()).catch((): WorkflowOption[] => []),
      ]);
      this.all.set(rows);
      this.workflowOptions.set(new Map(workflows.map((w) => [w.id, w])));
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

  /** The eligible workflows of a type: the default first, then the active ones by name, the deactivated ones last. */
  private chipsOf(t: TaskTypeView): AssocItem[] {
    const link = this.canOpenWorkflows();
    return t.eligibleWorkflowIds
      .map((id): AssocItem => ({
        id,
        label: this.workflowName(id),
        link: link ? ['/admin/workflows', id] : undefined,
        isDefault: id === t.defaultWorkflowDefinitionId,
        inactive: this.workflowOptions().get(id)?.isActive === false,
      }))
      .sort(
        (a, b) =>
          Number(!!b.isDefault) - Number(!!a.isDefault) ||
          Number(!!a.inactive) - Number(!!b.inactive) ||
          a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
      );
  }

  /** The Workflows tab limited to a type (`?taskType=<id>`). */
  protected workflowsQuery(t: TaskTypeView): Record<string, number> {
    return { taskType: t.id };
  }

  protected chipsFor(t: TaskTypeView): AssocItem[] {
    return this.chips().get(t.id) ?? [];
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
          iconKey: t.iconKey,
          isActive,
          eligibleWorkflowIds: t.eligibleWorkflowIds,
          defaultWorkflowDefinitionId: t.defaultWorkflowDefinitionId,
          rowVersion: t.rowVersion,
        }),
      );
      this.all.set(this.all().map((r) => (r.id === updated.id ? updated : r)));
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
