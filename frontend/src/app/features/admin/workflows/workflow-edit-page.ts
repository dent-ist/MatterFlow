import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  WorkflowDetail,
  WorkflowVersionStatus,
  WorkflowVersionSummary,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { TextField } from '../../../shared/ui/text-field';
import { workflowErrors } from './workflow-errors';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ActiveBadge, Badge, BadgeTone, workflowStatusTone } from '../../../shared/ui/badge';
import { PageTitle, shortTitleText } from '../../../core/title/page-title';
import { PageHeader } from '../../../shared/ui/page-header';

/**
 * Admin: create or edit a workflow (UX S16). Name, description and (on create) Ordered or Unordered live here; the steps are edited
 * in a draft version. Shows the version history with Draft/Published/Retired badges. Needs `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-workflow-edit-page',
  imports: [
    PageHeader,
    Badge,
    ActiveBadge,
    ConfirmDialog,
    RecordState,
    RouterLink,
    Button,
    TextField,
    MfDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', './workflows.scss'],
  template: `
    @if (flow.failed()) {
      <mf-record-state
        kind="workflow"
        [state]="state()"
        [busy]="flow.retrying()"
        [focusHeading]="true"
        (retried)="load()"
      />
    } @else {
      <mf-page-header
        [crumbs]="[
          { label: 'Administration' },
          { label: 'Task Types', link: '/admin/task-types' },
          { label: 'Workflows', link: '/admin/workflows' },
          { label: isEdit() ? name() || 'Edit' : 'New' },
        ]"
        [heading]="isEdit() ? name() || 'Edit workflow' : 'New workflow'"
      >
        <div mfActions class="mf-contents">
          @if (detail()?.workflow; as w) {
            @if (w.draftVersionId) {
              <a
                class="mf-btn"
                data-open-draft
                [routerLink]="[
                  '/admin/workflows',
                  w.workflowDefinitionId,
                  'versions',
                  w.draftVersionId,
                ]"
                >Open draft v{{ w.draftVersionNo }}</a
              >
            }
          }
        </div>
        <span mfDescription class="wf-meta" data-meta>
          @if (detail()?.workflow; as w) {
            <mf-active-badge [active]="w.isActive" />
            @if (w.publishedVersionNo; as p) {
              <mf-badge tone="success" icon="pi-check-circle">Published v{{ p }}</mf-badge>
            } @else {
              <mf-badge tone="neutral">Not published</mf-badge>
            }
            @if (w.draftVersionNo; as n) {
              <mf-badge tone="warning" icon="pi-pencil">Draft v{{ n }} in progress</mf-badge>
            }
          }
        </span>
      </mf-page-header>

      <span class="pg-sr" role="status" data-record-live>{{ flow.live() }}</span>
      @if (state() === 'loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading the workflow...</div>
      } @else {
        <div class="wf-stack">
          @if (conflict()) {
            <div class="pg-alert" role="alert" data-conflict>
              This workflow was changed by someone else.
              <p-button label="Reload latest" severity="secondary" (onClick)="load()" />
            </div>
          }
          @if (messages().length > 0) {
            <div class="pg-summary" role="alert" data-summary>
              Fix the following to save:
              <ul>
                @for (message of messages(); track message) {
                  <li>{{ message }}</li>
                }
              </ul>
            </div>
          }

          <form class="pg-form" novalidate (submit)="$event.preventDefault(); save()">
            <mf-text-field
              inputId="wf-name"
              label="Name"
              [required]="true"
              [maxLength]="200"
              [error]="nameError()"
              [(value)]="name"
            />
            <mf-text-field
              inputId="wf-description"
              label="Description"
              [multiline]="true"
              [maxLength]="1000"
              [error]="fieldError('description')"
              [(value)]="description"
            />

            @if (isEdit()) {
              <label class="pg-radio">
                <input
                  type="checkbox"
                  id="wf-active"
                  [checked]="isActive()"
                  (change)="isActive.set($any($event.target).checked)"
                />
                Active (offered when creating tasks)
              </label>
            } @else {
              <fieldset>
                <legend>Execution mode</legend>
                <label class="pg-radio">
                  <input
                    type="radio"
                    name="wf-mode"
                    data-mode="ordered"
                    [checked]="isOrdered()"
                    (change)="isOrdered.set(true)"
                  />
                  Ordered - steps must be resolved in sequence
                </label>
                <label class="pg-radio">
                  <input
                    type="radio"
                    name="wf-mode"
                    data-mode="unordered"
                    [checked]="!isOrdered()"
                    (change)="isOrdered.set(false)"
                  />
                  Unordered - steps can be done in any order
                </label>
                <p class="pg-reason">You can change this later while the version is a draft.</p>
              </fieldset>
            }

            <div class="pg-actions mf-form-actions--sticky">
              <p-button
                type="submit"
                [label]="busy() ? 'Saving...' : isEdit() ? 'Save changes' : 'Create workflow'"
                [disabled]="busy()"
              />
              <p-button label="Cancel" severity="secondary" (onClick)="cancel()" />
            </div>
          </form>

          @if (detail(); as d) {
            <section class="wf-panel" aria-labelledby="wf-history-heading" data-history>
              <div class="wf-panel__head">
                <h2 id="wf-history-heading">Version history</h2>
                <p class="pg-reason">
                  Tasks run on a published version. Published versions cannot be edited; create a
                  new draft to make changes.
                </p>
              </div>
              @if (d.versions.length === 0) {
                <p class="pg-muted">No versions yet.</p>
              } @else {
                <div class="mf-scroll">
                  <table class="pg-table">
                    <caption class="pg-sr">
                      Versions of
                      {{
                        d.workflow.name
                      }}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Version</th>
                        <th scope="col">Status</th>
                        <th scope="col">Mode</th>
                        <th scope="col">Steps</th>
                        <th scope="col">Published</th>
                        <th scope="col"><span class="pg-sr">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (v of d.versions; track v.workflowVersionId) {
                        <tr [attr.data-version]="v.versionNo">
                          <td>
                            <a
                              class="pg-link"
                              [routerLink]="[
                                '/admin/workflows',
                                d.workflow.workflowDefinitionId,
                                'versions',
                                v.workflowVersionId,
                              ]"
                              [attr.aria-label]="
                                (isDraft(v) ? 'Edit draft v' : 'View v') + v.versionNo
                              "
                              >v{{ v.versionNo }}</a
                            >
                            @if (v.workflowVersionId === d.workflow.publishedVersionId) {
                              <mf-badge class="wf-current" tone="success">Current</mf-badge>
                            }
                          </td>
                          <td>
                            <mf-badge [tone]="statusTone(v)">{{ v.status }}</mf-badge>
                          </td>
                          <td>{{ v.isOrdered ? 'Ordered' : 'Unordered' }}</td>
                          <td>{{ v.stepCount }}</td>
                          <td>{{ v.publishedAtUtc | mfDate }}</td>
                          <td>
                            @if (v.status === published) {
                              <p-button
                                [label]="'Create new draft from v' + v.versionNo"
                                size="small"
                                severity="secondary"
                                [disabled]="busy() || !!d.workflow.draftVersionId"
                                (onClick)="newDraft(v)"
                              />
                            }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                @if (d.workflow.draftVersionId) {
                  <p class="pg-reason">
                    A draft (v{{ d.workflow.draftVersionNo }}) is in progress. Publish or discard it
                    before creating another.
                  </p>
                }
              }
            </section>
          }
        </div>
      }
    }

    <mf-confirm-dialog
      title="Deactivate workflow?"
      confirmLabel="Deactivate workflow"
      cancelLabel="Keep active"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="deactivateOpen"
      (confirmed)="confirmDeactivate()"
    >
      <p>
        This workflow will no longer be offered when people create tasks. Tasks already running on
        it are not changed, and you can activate it again later.
      </p>
    </mf-confirm-dialog>
  `,
})
export class WorkflowEditPage implements HasUnsavedChanges {
  /** Route parameter; absent when creating. */
  readonly workflowId = input<string>();

  private readonly api = inject(WorkflowsClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);

  protected readonly published = WorkflowVersionStatus.Published;
  protected readonly isEdit = computed(() => this.workflowId() !== undefined);
  /** The shared load flow of the record pages (#353): 404, 403 and failures show `mf-record-state`; the request is quiet (no toast). */
  protected readonly flow = new RecordLoadFlow('workflow');
  protected readonly state = this.flow.state;
  protected readonly detail = signal<WorkflowDetail | null>(null);

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly isActive = signal(true);
  protected readonly isOrdered = signal(true);
  protected readonly busy = signal(false);
  protected readonly deactivateOpen = signal(false);
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly messages = signal<string[]>([]);
  protected readonly conflict = signal(false);
  private saved = false;

  protected readonly nameError = computed(() => {
    if (this.submitted() && this.name().trim() === '') return 'Enter a name.';
    return this.fieldError('name');
  });

  constructor() {
    effect(() => {
      if (this.workflowId() !== undefined) untracked(() => void this.load());
      else untracked(() => this.flow.state.set('ready'));
    });
    effect(() => {
      const state = this.state();
      const name = this.detail()?.workflow?.name;
      if (state === 'notFound' || state === 'forbidden' || state === 'error') {
        this.pageTitle.set(recordStateTitle('workflow', state));
      } else if (name) this.pageTitle.set(shortTitleText(name));
    });
  }

  hasUnsavedChanges(): boolean {
    if (this.saved) return false;
    const w = this.detail()?.workflow;
    if (this.isEdit()) {
      return (
        !!w &&
        (this.name() !== w.name ||
          this.description() !== (w.description ?? '') ||
          this.isActive() !== w.isActive)
      );
    }
    return this.name().trim() !== '' || this.description().trim() !== '';
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  protected isDraft(v: WorkflowVersionSummary): boolean {
    return v.status === WorkflowVersionStatus.Draft;
  }

  protected statusTone(v: WorkflowVersionSummary): BadgeTone {
    return workflowStatusTone(v.status);
  }

  async load(): Promise<void> {
    this.resetErrors();
    await this.flow.run(
      () => firstValueFrom(this.api.getWorkflow(Number(this.workflowId()))),
      (detail) => this.apply(detail),
    );
  }

  protected confirmDeactivate(): void {
    this.deactivateOpen.set(false);
    void this.save(true);
  }

  protected async save(deactivationConfirmed = false): Promise<void> {
    this.submitted.set(true);
    this.resetErrors();
    if (this.name().trim() === '') {
      this.messages.set(['Enter a name.']);
      return;
    }
    if (
      !deactivationConfirmed &&
      this.isEdit() &&
      this.detail()?.workflow.isActive &&
      !this.isActive()
    ) {
      this.deactivateOpen.set(true);
      return;
    }
    const body = {
      name: this.name().trim(),
      description: this.description().trim() || undefined,
    };
    const result = await this.run(() =>
      this.isEdit()
        ? firstValueFrom(
            this.api.updateWorkflow(Number(this.workflowId()), {
              ...body,
              isActive: this.isActive(),
              rowVersion: this.detail()!.workflow.rowVersion,
            }),
          )
        : firstValueFrom(this.api.createWorkflow({ ...body, isOrdered: this.isOrdered() })),
    );
    if (!result) return;
    this.notify.success(`Workflow ${result.workflow.name} saved`);
    if (this.isEdit()) {
      this.apply(result);
    } else {
      this.saved = true;
      const draft = result.workflow.draftVersionId;
      await this.router.navigate(
        draft
          ? ['/admin/workflows', result.workflow.workflowDefinitionId, 'versions', draft]
          : ['/admin/workflows', result.workflow.workflowDefinitionId],
      );
    }
  }

  protected async newDraft(from: WorkflowVersionSummary): Promise<void> {
    const w = this.detail()?.workflow;
    if (!w) return;
    this.resetErrors();
    const draft = await this.run(() =>
      firstValueFrom(
        this.api.createWorkflowDraft(w.workflowDefinitionId, {
          fromVersionId: from.workflowVersionId,
        }),
      ),
    );
    if (!draft) return;
    this.notify.success(`Draft v${draft.version.versionNo} created`);
    await this.router.navigate([
      '/admin/workflows',
      w.workflowDefinitionId,
      'versions',
      draft.version.workflowVersionId,
    ]);
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  protected cancel(): void {
    void this.router.navigateByUrl('/admin/workflows');
  }

  private resetErrors(): void {
    this.serverErrors.set({});
    this.messages.set([]);
    this.conflict.set(false);
  }

  private async run<T>(work: () => Promise<T>): Promise<T | undefined> {
    this.busy.set(true);
    try {
      return await work();
    } catch (err) {
      const errors = workflowErrors(err, 'We could not save the workflow. Try again.');
      this.serverErrors.set(errors.fields);
      this.messages.set(errors.messages);
      this.conflict.set(errors.conflict);
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  private apply(detail: WorkflowDetail): void {
    this.detail.set(detail);
    this.name.set(detail.workflow.name);
    this.description.set(detail.workflow.description ?? '');
    this.isActive.set(detail.workflow.isActive);
  }
}
