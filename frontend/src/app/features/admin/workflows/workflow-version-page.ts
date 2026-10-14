import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DynamicForm, FormDefinition } from 'form-engine';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  FormsClient,
  StepDefinitionSummary,
  StepDefinitionsClient,
  WorkflowSummary,
  WorkflowVersionDetail,
  WorkflowVersionStatus,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { WorkflowDiff, diffVersions } from './workflow-diff';
import { workflowErrors } from './workflow-errors';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { Badge, workflowStatusTone } from '../../../shared/ui/badge';
import { PageHeader } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

/** One step placement in the version being viewed or edited. */
export interface PlacementRow {
  stepId: number;
  title: string;
  description?: string;
  formVersionId?: number;
  isSkippable: boolean;
  skipCommentRequired: boolean;
  /** False when the library step has been deactivated since it was added. */
  active: boolean;
}

interface PreviewState {
  state: 'loading' | 'ready' | 'none' | 'error';
  definition?: FormDefinition;
}

const ORDERED_TEXT =
  'Ordered: steps must be resolved in the sequence shown. Numbering is shown to users and the order below is the order they work in.';
const UNORDERED_TEXT =
  'Unordered: steps can be done in any order. Numbering is hidden from users and the order below is for display only.';

/**
 * Admin: one workflow version (UX S16). A Draft is edited here: pick steps from the library, reorder (buttons or Alt+Arrow keys),
 * set per-step skip rules, preview each step's inputs, save, and publish with a diff against the previous published version.
 * Published and Retired versions are read-only (immutable): create a new draft from them, or retire a published one.
 */
@Component({
  selector: 'mf-workflow-version-page',
  imports: [PageHeader, Badge, ErrorReference, RouterLink, Button, ConfirmDialog, DynamicForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', './workflows.scss'],
  template: `
    @if (state() === 'loading') {
      <div class="pg-state" role="status" aria-busy="true">Loading the workflow version...</div>
    } @else if (state() === 'error') {
      <div class="pg-alert" role="alert">
        We couldn't load that workflow version.
        <mf-error-reference />
        <p-button label="Retry" severity="secondary" (onClick)="load()" />
      </div>
    } @else if (version(); as v) {
      <mf-page-header
        [crumbs]="[
          { label: 'Workflows', link: '/admin/workflows' },
          { label: v.workflowName, link: ['/admin/workflows', workflowId()] },
          { label: 'v' + v.version.versionNo },
        ]"
      >
        <span mfTitle>
          {{ v.workflowName }} v{{ v.version.versionNo }}
          <mf-badge [tone]="statusTone()" data-status>{{ v.version.status }}</mf-badge>
        </span>
        <div mfActions class="mf-contents">
          @if (editable()) {
            <p-button
              label="Discard draft"
              severity="secondary"
              [disabled]="busy()"
              (onClick)="discardOpen.set(true)"
            />
            <p-button
              label="Save draft"
              severity="secondary"
              [disabled]="busy() || !dirty()"
              (onClick)="save()"
            />
            <p-button
              label="Publish..."
              [disabled]="busy() || rows().length === 0"
              (onClick)="startPublish()"
            />
          } @else {
            @if (isPublished()) {
              <p-button
                label="Retire version"
                severity="secondary"
                [disabled]="busy()"
                (onClick)="retireOpen.set(true)"
              />
            }
            <p-button
              [label]="'Create new draft from v' + v.version.versionNo"
              [disabled]="busy() || !!workflow()?.draftVersionId"
              (onClick)="newDraft()"
            />
          }
        </div>
        @if (workflow()?.publishedVersionNo; as p) {
          <p class="pg-muted" data-published-note>Current published version: v{{ p }}</p>
        }
        @if (editable() && rows().length === 0) {
          <p class="pg-muted" data-publish-hint>Add at least one step before you can publish.</p>
        }
      </mf-page-header>

      @if (!editable()) {
        <div class="pg-banner" data-readonly-banner>
          This version is {{ v.version.status === 'Published' ? 'published' : 'retired' }} and
          cannot be edited.
          @if (workflow()?.draftVersionId; as d) {
            <a class="pg-link" [routerLink]="['/admin/workflows', workflowId(), 'versions', d]"
              >Open the draft (v{{ workflow()?.draftVersionNo }})</a
            >
          } @else {
            Create a new draft to make changes.
          }
        </div>
      }
      @if (conflict()) {
        <div class="pg-alert" role="alert" data-conflict>
          This workflow was changed by someone else.
          <p-button label="Reload latest" severity="secondary" (onClick)="load()" />
        </div>
      }
      @if (messages().length > 0) {
        <div class="pg-summary" role="alert" data-summary>
          Fix the following:
          <ul>
            @for (message of messages(); track message) {
              <li>{{ message }}</li>
            }
          </ul>
        </div>
      }

      <fieldset class="wf-panel" data-mode-box [disabled]="!editable()">
        <legend class="pg-label">Execution mode</legend>
        <div class="wf-opts">
          <label class="wf-opt">
            <input
              type="radio"
              name="wf-mode"
              data-mode="ordered"
              [checked]="isOrdered()"
              (change)="requestMode(true)"
            />
            Ordered - steps must be resolved in sequence
          </label>
          <label class="wf-opt">
            <input
              type="radio"
              name="wf-mode"
              data-mode="unordered"
              [checked]="!isOrdered()"
              (change)="requestMode(false)"
            />
            Unordered - any order
          </label>
        </div>
        <p class="pg-reason" data-mode-help>{{ isOrdered() ? orderedText : unorderedText }}</p>
      </fieldset>

      <div class="wf-cols" [style.marginTop]="'var(--mf-s4)'">
        @if (editable()) {
          <section class="wf-panel" aria-labelledby="wf-lib-heading" data-library>
            <h2 id="wf-lib-heading">Step library</h2>
            <label class="pg-label" for="wf-lib-search">Search steps</label>
            <input
              id="wf-lib-search"
              class="pg-input"
              type="search"
              placeholder="Title or description"
              (input)="searchLibrary($any($event.target).value)"
            />
            @switch (libState()) {
              @case ('loading') {
                <p class="pg-muted" role="status">Loading steps...</p>
              }
              @case ('error') {
                <p class="pg-alert" role="alert">
                  Couldn't load the step library.
                  <mf-error-reference />
                  <p-button label="Retry" severity="secondary" (onClick)="loadLibrary()" />
                </p>
              }
              @case ('ready') {
                @if (library().length === 0) {
                  <p class="pg-muted" data-lib-empty>
                    {{
                      libQ()
                        ? 'No steps match that search.'
                        : 'The step library has no active steps.'
                    }}
                  </p>
                } @else {
                  <ul class="wf-list" aria-label="Library steps">
                    @for (s of library(); track s.stepDefinitionId) {
                      <li class="wf-item" [attr.data-lib]="s.title">
                        <div class="wf-item__row">
                          <span class="wf-item__title">{{ s.title }}</span>
                          <button
                            type="button"
                            class="wf-icon-btn"
                            [attr.data-add]="s.stepDefinitionId"
                            [attr.aria-label]="'Add ' + s.title + ' to the workflow'"
                            [disabled]="inWorkflow(s.stepDefinitionId)"
                            (click)="add(s)"
                          >
                            {{ inWorkflow(s.stepDefinitionId) ? 'Added' : '+ Add' }}
                          </button>
                        </div>
                        @if (s.description) {
                          <span class="pg-muted">{{ s.description }}</span>
                        }
                      </li>
                    }
                  </ul>
                }
              }
            }
          </section>
        }

        <section
          class="wf-panel"
          aria-labelledby="wf-steps-heading"
          data-steps
          [style.gridColumn]="editable() ? null : '1 / -1'"
        >
          <h2 id="wf-steps-heading">Workflow steps ({{ rows().length }})</h2>
          <div class="pg-sr" role="status" aria-live="polite" data-live>{{ live() }}</div>
          @if (rows().length === 0) {
            <p class="pg-muted" data-steps-empty>
              {{
                editable()
                  ? 'No steps yet. Add steps from the step library. A workflow needs at least one step to be published.'
                  : 'This version has no steps.'
              }}
            </p>
          } @else {
            <ol class="wf-list" aria-labelledby="wf-steps-heading">
              @for (r of rows(); track r.stepId; let i = $index; let last = $last) {
                <li class="wf-item" [attr.data-step-row]="r.title">
                  <div class="wf-item__row">
                    <span class="wf-item__title">
                      @if (isOrdered()) {
                        {{ i + 1 }}.
                      }
                      {{ r.title }}
                    </span>
                    <span class="wf-item__tools">
                      @if (editable()) {
                        <button
                          type="button"
                          class="wf-icon-btn"
                          data-move="up"
                          [attr.data-step]="r.stepId"
                          [attr.aria-label]="'Move ' + r.title + ' up'"
                          [disabled]="i === 0"
                          (click)="move(i, -1)"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          class="wf-icon-btn"
                          data-move="down"
                          [attr.data-step]="r.stepId"
                          [attr.aria-label]="'Move ' + r.title + ' down'"
                          [disabled]="last"
                          (click)="move(i, 1)"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          class="wf-icon-btn"
                          [attr.data-remove]="r.stepId"
                          [attr.aria-label]="'Remove ' + r.title + ' from the workflow'"
                          (click)="remove(i)"
                        >
                          Remove
                        </button>
                      }
                      <button
                        type="button"
                        class="wf-icon-btn"
                        [attr.data-preview]="r.stepId"
                        [attr.aria-expanded]="isPreviewOpen(r.stepId)"
                        [attr.aria-label]="'Preview inputs of ' + r.title"
                        (click)="togglePreview(r)"
                      >
                        {{ isPreviewOpen(r.stepId) ? 'Hide inputs' : 'Preview inputs' }}
                      </button>
                    </span>
                  </div>
                  @if (r.description) {
                    <span class="pg-muted">{{ r.description }}</span>
                  }
                  @if (!r.active) {
                    <span class="pg-reason" data-inactive>
                      This library step has been deactivated. Remove it or reactivate it in the step
                      library.
                    </span>
                  }
                  @if (editable()) {
                    <div class="wf-opts">
                      <label class="wf-opt">
                        <input
                          type="checkbox"
                          [attr.data-skippable]="r.stepId"
                          [checked]="r.isSkippable"
                          (change)="setSkippable(i, $any($event.target).checked)"
                        />
                        Skippable
                      </label>
                      <label class="wf-opt">
                        <input
                          type="checkbox"
                          [attr.data-comment]="r.stepId"
                          [checked]="r.skipCommentRequired"
                          [disabled]="!r.isSkippable"
                          (change)="setCommentRequired(i, $any($event.target).checked)"
                        />
                        Comment required on skip
                      </label>
                    </div>
                  } @else {
                    <span class="pg-muted" data-skip-summary>{{ skipSummary(r) }}</span>
                  }
                  @if (previewOf(r.stepId); as p) {
                    <div class="wf-preview" [attr.data-preview-box]="r.stepId">
                      @switch (p.state) {
                        @case ('loading') {
                          <p role="status">Loading inputs...</p>
                        }
                        @case ('error') {
                          <p role="alert">We couldn't load the inputs for this step.</p>
                        }
                        @case ('none') {
                          <p class="pg-muted">This step has no published inputs.</p>
                        }
                        @case ('ready') {
                          <mf-dynamic-form [definition]="p.definition!" [readOnly]="true" />
                        }
                      }
                    </div>
                  }
                </li>
              }
            </ol>
            @if (editable()) {
              <p class="pg-reason">
                Reorder with the Up and Down buttons, or press Alt+Up or Alt+Down on a step.
              </p>
            }
          }
        </section>
      </div>
    }

    <mf-confirm-dialog
      [title]="
        'Publish ' + (version()?.workflowName ?? '') + ' v' + (version()?.version?.versionNo ?? '')
      "
      [confirmLabel]="'Publish v' + (version()?.version?.versionNo ?? '')"
      cancelLabel="Back to draft"
      [busy]="busy() || diffLoading()"
      [(visible)]="publishOpen"
      (confirmed)="publish()"
    >
      @if (diffLoading()) {
        <p role="status">Comparing with the published version...</p>
      } @else {
        <div data-diff>
          <p class="pg-label">
            @if (previousNo(); as n) {
              Changes since v{{ n }}
            } @else {
              First published version
            }
          </p>
          @if (diff(); as d) {
            @if (d.unchanged) {
              <p>No changes from the published version.</p>
            }
            <ul class="wf-diff">
              @if (d.modeChange; as m) {
                <li>Mode changed from {{ m.from }} to {{ m.to }}</li>
              }
              @for (t of d.added; track t) {
                <li>Added "{{ t }}"</li>
              }
              @for (t of d.removed; track t) {
                <li>Removed "{{ t }}"</li>
              }
              @for (t of d.moved; track t) {
                <li>Moved "{{ t }}"</li>
              }
              @for (t of d.skipRuleChanged; track t) {
                <li>Changed skip rule on "{{ t }}"</li>
              }
            </ul>
          }
          <p>
            Impact: existing tasks stay on their current version. New tasks use this version.
            Publishing copies the current step content, so later library edits will not change it.
          </p>
        </div>
      }
    </mf-confirm-dialog>

    <mf-confirm-dialog
      title="Change execution mode"
      confirmLabel="Change mode"
      [(visible)]="modeOpen"
      (confirmed)="confirmMode()"
    >
      <p>
        {{
          pendingMode()
            ? 'Steps must then be resolved in sequence. Numbering will be shown.'
            : 'Ordered numbering will be hidden; steps can be done in any order.'
        }}
      </p>
    </mf-confirm-dialog>

    <mf-confirm-dialog
      title="Retire version"
      confirmLabel="Retire"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="retireOpen"
      (confirmed)="retire()"
    >
      <p>New tasks will no longer use this version. Tasks already running on it are not changed.</p>
    </mf-confirm-dialog>

    <mf-confirm-dialog
      title="Discard draft"
      confirmLabel="Discard draft"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="discardOpen"
      (confirmed)="discard()"
    >
      <p>
        The draft and its unpublished steps will be deleted. Published versions are not changed.
      </p>
    </mf-confirm-dialog>
  `,
})
export class WorkflowVersionPage implements HasUnsavedChanges {
  readonly workflowId = input.required<string>();
  readonly versionId = input.required<string>();

  private readonly api = inject(WorkflowsClient);
  private readonly steps = inject(StepDefinitionsClient);
  private readonly forms = inject(FormsClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly orderedText = ORDERED_TEXT;
  protected readonly unorderedText = UNORDERED_TEXT;

  protected readonly state = signal<LoadState>('loading');
  protected readonly version = signal<WorkflowVersionDetail | null>(null);
  protected readonly workflow = signal<WorkflowSummary | null>(null);
  protected readonly rows = signal<PlacementRow[]>([]);
  protected readonly isOrdered = signal(true);
  private readonly baseline = signal('');

  protected readonly busy = signal(false);
  protected readonly messages = signal<string[]>([]);
  protected readonly conflict = signal(false);
  protected readonly live = signal('');

  protected readonly library = signal<StepDefinitionSummary[]>([]);
  protected readonly libState = signal<LoadState>('loading');
  protected readonly libQ = signal('');
  private libRequest = 0;

  private readonly previews = signal<Record<number, PreviewState | undefined>>({});
  private readonly openPreviews = signal<ReadonlySet<number>>(new Set());

  protected readonly publishOpen = signal(false);
  protected readonly diffLoading = signal(false);
  protected readonly diff = signal<WorkflowDiff | null>(null);
  protected readonly previousNo = signal<number | null>(null);
  protected readonly modeOpen = signal(false);
  protected readonly pendingMode = signal(true);
  protected readonly retireOpen = signal(false);
  protected readonly discardOpen = signal(false);
  private leaving = false;

  protected readonly editable = computed(
    () => this.version()?.version.status === WorkflowVersionStatus.Draft,
  );
  protected readonly isPublished = computed(
    () => this.version()?.version.status === WorkflowVersionStatus.Published,
  );
  protected readonly statusTone = computed(() =>
    workflowStatusTone(this.version()?.version.status),
  );
  protected readonly dirty = computed(
    () => this.editable() && this.currentKey() !== this.baseline(),
  );

  constructor() {
    effect(() => {
      this.workflowId();
      this.versionId();
      untracked(() => void this.load());
    });
  }

  hasUnsavedChanges(): boolean {
    return !this.leaving && this.dirty();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  async load(): Promise<void> {
    this.state.set('loading');
    this.resetErrors();
    try {
      const [detail, workflow] = await Promise.all([
        firstValueFrom(
          this.api.getWorkflowVersion(Number(this.workflowId()), Number(this.versionId())),
        ),
        firstValueFrom(this.api.getWorkflow(Number(this.workflowId()))),
      ]);
      this.workflow.set(workflow.workflow);
      this.apply(detail);
      this.state.set('ready');
      if (this.editable() && this.libState() !== 'ready') void this.loadLibrary();
    } catch {
      this.state.set('error');
    }
  }

  async loadLibrary(): Promise<void> {
    const id = ++this.libRequest;
    this.libState.set('loading');
    try {
      const result = await firstValueFrom(
        this.steps.listStepDefinitions(this.libQ().trim() || undefined, true, 1, 50),
      );
      if (id !== this.libRequest) return;
      this.library.set(result.items);
      this.libState.set('ready');
    } catch {
      if (id === this.libRequest) this.libState.set('error');
    }
  }

  protected searchLibrary(text: string): void {
    this.libQ.set(text);
    void this.loadLibrary();
  }

  protected inWorkflow(stepId: number): boolean {
    return this.rows().some((r) => r.stepId === stepId);
  }

  protected add(step: StepDefinitionSummary): void {
    if (this.inWorkflow(step.stepDefinitionId)) return;
    this.rows.update((rows) => [
      ...rows,
      {
        stepId: step.stepDefinitionId,
        title: step.title,
        description: step.description,
        isSkippable: false,
        skipCommentRequired: false,
        active: step.isActive,
      },
    ]);
    this.live.set(`Added ${step.title} at position ${this.rows().length}.`);
  }

  protected remove(index: number): void {
    const removed = this.rows()[index];
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
    this.live.set(`Removed ${removed.title}. ${this.rows().length} steps remain.`);
    const next = this.rows()[Math.min(index, this.rows().length - 1)];
    this.focusAfterRender(next ? `[data-remove="${next.stepId}"]` : '#wf-lib-search');
  }

  protected move(index: number, delta: -1 | 1): void {
    const target = index + delta;
    const rows = this.rows();
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    this.rows.set(next);
    const moved = rows[index];
    this.live.set(`Moved ${moved.title} to position ${target + 1} of ${rows.length}.`);
    const dir = delta < 0 ? 'up' : 'down';
    const other = delta < 0 ? 'down' : 'up';
    this.focusAfterRender(
      `[data-move="${dir}"][data-step="${moved.stepId}"]:not(:disabled)`,
      `[data-move="${other}"][data-step="${moved.stepId}"]`,
    );
  }

  /** Alt+Up / Alt+Down on a focused step control moves that step (keyboard alternative to dragging). */
  @HostListener('keydown', ['$event'])
  protected onItemKey(event: KeyboardEvent): void {
    if (!this.editable() || !event.altKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const item = (event.target as HTMLElement | null)?.closest('[data-step-row]');
    const index = item
      ? this.rows().findIndex((r) => r.title === item.getAttribute('data-step-row'))
      : -1;
    if (index < 0) return;
    event.preventDefault();
    this.move(index, event.key === 'ArrowUp' ? -1 : 1);
  }

  protected setSkippable(index: number, value: boolean): void {
    this.patch(index, { isSkippable: value, skipCommentRequired: value ? undefined : false });
  }

  protected setCommentRequired(index: number, value: boolean): void {
    this.patch(index, { skipCommentRequired: value });
  }

  protected skipSummary(r: PlacementRow): string {
    if (!r.isSkippable) return 'Cannot be skipped';
    return r.skipCommentRequired ? 'Skippable, comment required' : 'Skippable';
  }

  protected requestMode(ordered: boolean): void {
    if (ordered === this.isOrdered()) return;
    if (this.rows().length === 0) {
      this.isOrdered.set(ordered);
      return;
    }
    // Keep the radios on the saved choice until the change is confirmed.
    this.syncRadios(this.isOrdered());
    this.pendingMode.set(ordered);
    this.modeOpen.set(true);
  }

  protected confirmMode(): void {
    this.modeOpen.set(false);
    this.isOrdered.set(this.pendingMode());
    this.syncRadios(this.pendingMode());
  }

  private syncRadios(ordered: boolean): void {
    this.host.nativeElement
      .querySelectorAll<HTMLInputElement>('[data-mode]')
      .forEach((r) => (r.checked = (r.dataset['mode'] === 'ordered') === ordered));
  }

  protected isPreviewOpen(stepId: number): boolean {
    return this.openPreviews().has(stepId);
  }

  protected previewOf(stepId: number): PreviewState | undefined {
    return this.openPreviews().has(stepId) ? this.previews()[stepId] : undefined;
  }

  protected async togglePreview(row: PlacementRow): Promise<void> {
    const open = new Set(this.openPreviews());
    if (open.has(row.stepId)) {
      open.delete(row.stepId);
      this.openPreviews.set(open);
      return;
    }
    open.add(row.stepId);
    this.openPreviews.set(open);
    if (this.previews()[row.stepId]?.state === 'ready') return;
    this.setPreview(row.stepId, { state: 'loading' });
    try {
      const versionId =
        row.formVersionId ??
        (await firstValueFrom(this.steps.getStepDefinition(row.stepId))).publishedFormVersionId;
      if (!versionId) {
        this.setPreview(row.stepId, { state: 'none' });
        return;
      }
      const schema = await firstValueFrom(this.forms.getFormVersionSchema(versionId));
      this.setPreview(row.stepId, {
        state: schema.fields.length === 0 ? 'none' : 'ready',
        definition: toFormDefinition(schema),
      });
    } catch {
      this.setPreview(row.stepId, { state: 'error' });
    }
  }

  protected async save(): Promise<boolean> {
    const v = this.version();
    if (!v) return false;
    this.resetErrors();
    const saved = await this.run(
      () =>
        firstValueFrom(
          this.api.saveWorkflowDraft(v.workflowDefinitionId, v.version.workflowVersionId, {
            isOrdered: this.isOrdered(),
            steps: this.rows().map((r) => ({
              sourceStepDefinitionId: r.stepId,
              isSkippable: r.isSkippable,
              skipCommentRequired: r.skipCommentRequired,
            })),
            rowVersion: v.version.rowVersion,
          }),
        ),
      'We could not save the draft. Try again.',
    );
    if (!saved) return false;
    this.apply(saved);
    this.notify.success('Draft saved');
    return true;
  }

  protected async startPublish(): Promise<void> {
    if (this.dirty() && !(await this.save())) return;
    const v = this.version();
    const w = this.workflow();
    if (!v) return;
    this.resetErrors();
    this.diff.set(null);
    this.previousNo.set(null);
    this.publishOpen.set(true);
    this.diffLoading.set(true);
    try {
      let previous: WorkflowVersionDetail | null = null;
      if (w?.publishedVersionId && w.publishedVersionId !== v.version.workflowVersionId) {
        previous = await firstValueFrom(
          this.api.getWorkflowVersion(v.workflowDefinitionId, w.publishedVersionId),
        );
      }
      this.previousNo.set(previous?.version.versionNo ?? null);
      this.diff.set(
        diffVersions(previous && { isOrdered: previous.version.isOrdered, steps: previous.steps }, {
          isOrdered: this.isOrdered(),
          steps: v.steps,
        }),
      );
    } catch {
      this.publishOpen.set(false);
      this.messages.set(['We could not compare with the published version. Try again.']);
    } finally {
      this.diffLoading.set(false);
    }
  }

  protected async publish(): Promise<void> {
    const v = this.version();
    if (!v) return;
    const result = await this.run(
      () =>
        firstValueFrom(
          this.api.publishWorkflowVersion(v.workflowDefinitionId, v.version.workflowVersionId, {
            rowVersion: v.version.rowVersion,
          }),
        ),
      'We could not publish the workflow. Try again.',
    );
    this.publishOpen.set(false);
    if (!result) return;
    this.notify.success(`${result.workflowName} v${result.version.versionNo} published`);
    this.leaving = true;
    await this.router.navigate(['/admin/workflows', v.workflowDefinitionId]);
  }

  protected async retire(): Promise<void> {
    const v = this.version();
    if (!v) return;
    this.resetErrors();
    const result = await this.run(
      () =>
        firstValueFrom(
          this.api.retireWorkflowVersion(v.workflowDefinitionId, v.version.workflowVersionId, {
            rowVersion: v.version.rowVersion,
          }),
        ),
      'We could not retire the version. Try again.',
    );
    this.retireOpen.set(false);
    if (!result) return;
    this.notify.success(`v${result.version.versionNo} retired`);
    await this.load();
  }

  protected async newDraft(): Promise<void> {
    const v = this.version();
    if (!v) return;
    this.resetErrors();
    const draft = await this.run(
      () =>
        firstValueFrom(
          this.api.createWorkflowDraft(v.workflowDefinitionId, {
            fromVersionId: v.version.workflowVersionId,
          }),
        ),
      'We could not create the draft. Try again.',
    );
    if (!draft) return;
    this.notify.success(`Draft v${draft.version.versionNo} created`);
    await this.router.navigate([
      '/admin/workflows',
      v.workflowDefinitionId,
      'versions',
      draft.version.workflowVersionId,
    ]);
  }

  protected async discard(): Promise<void> {
    const v = this.version();
    if (!v) return;
    this.resetErrors();
    const done = await this.run(
      () =>
        firstValueFrom(
          this.api.discardWorkflowDraft(v.workflowDefinitionId, v.version.workflowVersionId),
        ).then(() => true),
      'We could not discard the draft. Try again.',
    );
    this.discardOpen.set(false);
    if (!done) return;
    this.notify.success('Draft discarded');
    this.leaving = true;
    await this.router.navigate(['/admin/workflows', v.workflowDefinitionId]);
  }

  private patch(index: number, change: Partial<PlacementRow>): void {
    const defined = Object.fromEntries(
      Object.entries(change).filter(([, value]) => value !== undefined),
    );
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, ...defined } : r)));
  }

  private currentKey(): string {
    return JSON.stringify([
      this.isOrdered(),
      this.rows().map((r) => [r.stepId, r.isSkippable, r.skipCommentRequired]),
    ]);
  }

  private setPreview(stepId: number, state: PreviewState): void {
    this.previews.update((p) => ({ ...p, [stepId]: state }));
  }

  private focusAfterRender(selector: string, fallback?: string): void {
    afterNextRender(
      () => {
        const root = this.host.nativeElement;
        (
          root.querySelector<HTMLElement>(selector) ??
          (fallback ? root.querySelector<HTMLElement>(fallback) : null)
        )?.focus();
      },
      { injector: this.injector },
    );
  }

  private resetErrors(): void {
    this.messages.set([]);
    this.conflict.set(false);
  }

  private async run<T>(work: () => Promise<T>, fallback: string): Promise<T | undefined> {
    this.busy.set(true);
    try {
      return await work();
    } catch (err) {
      const errors = workflowErrors(err, fallback);
      this.messages.set(errors.messages);
      this.conflict.set(errors.conflict);
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  private apply(detail: WorkflowVersionDetail): void {
    this.version.set(detail);
    this.isOrdered.set(detail.version.isOrdered);
    this.rows.set(
      detail.steps.map((s) => ({
        stepId: s.sourceStepDefinitionId,
        title: s.title,
        description: s.description,
        formVersionId: s.stepFormVersionId,
        isSkippable: s.isSkippable,
        skipCommentRequired: s.skipCommentRequired,
        active: s.sourceStepActive,
      })),
    );
    this.baseline.set(this.currentKey());
  }
}
