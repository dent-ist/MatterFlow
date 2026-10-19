import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
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
import { UndoService } from '../../../core/notify/undo.service';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { WorkflowDiff, diffVersions } from './workflow-diff';
import { workflowErrors } from './workflow-errors';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { Badge, workflowStatusTone } from '../../../shared/ui/badge';
import { Crumb, PageHeader } from '../../../shared/ui/page-header';
import { ADMIN_LIST, ListReturn } from '../list-return';
import { PageTitle, shortTitleText } from '../../../core/title/page-title';
import { ORDERED_TEXT, UNORDERED_TEXT } from './workflow-mode-control';
import { StepLibraryModel, WorkflowStepLibrary } from './workflow-step-library';
import { PlacementRow, PreviewState, WorkflowStepRow } from './workflow-step-row';
import { WorkflowVersionBar } from './workflow-version-bar';

export type { PlacementRow } from './workflow-step-row';

/** Width from which the step library is a pane beside the steps; narrower, it is a drawer opened from Add step (VP3). */
const LIBRARY_PANE_MIN = 1280;

/**
 * Admin: one workflow version (UX S16). A Draft is edited here: pick steps from the library, reorder (buttons or Alt+Arrow keys),
 * set per-step skip rules, preview each step's inputs, save, and publish with a diff against the previous published version.
 * Published and Retired versions are read-only (immutable): create a new draft from them, or retire a published one.
 */
@Component({
  selector: 'mf-workflow-version-page',
  imports: [
    FixedPage,
    ScrollArea,
    PageHeader,
    WorkflowVersionBar,
    WorkflowStepRow,
    WorkflowStepLibrary,
    Badge,
    RecordState,
    RouterLink,
    Button,
    Dialog,
    DialogFocus,
    ConfirmDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', './workflows.scss', './workflow-version-page.scss'],
  // A block, so the sticky action bar is held by the whole page and not by an inline box.
  styles: ':host { display: block; }',
  template: `
    <span class="pg-sr" role="status" data-record-live>{{ flow.live() }}</span>
    <mf-fixed-page>
      @if (flow.failed()) {
        <mf-record-state
          kind="workflowVersion"
          [state]="state()"
          [busy]="flow.retrying()"
          [parent]="parentCrumb()"
          [focusHeading]="true"
          (retried)="load()"
        />
      } @else if (state() === 'loading') {
        <mf-page-header
          heading="Workflow version"
          [crumbs]="[
            { label: 'Administration' },
            { label: 'Task Types', link: '/admin/task-types' },
            listCrumb,
            { label: 'Version' },
          ]"
        />
        <div class="pg-state" role="status" aria-busy="true">Loading the workflow version...</div>
      } @else if (version(); as v) {
        <mf-page-header
          [crumbs]="[
            { label: 'Administration' },
            { label: 'Task Types', link: '/admin/task-types' },
            listCrumb,
            { label: v.workflowName, link: ['/admin/workflows', workflowId()], state: back.carry },
            { label: 'v' + v.version.versionNo },
          ]"
        >
          <span mfTitle class="wf-title">
            <span class="wf-title__name" [attr.title]="v.workflowName + ' v' + v.version.versionNo"
              >{{ v.workflowName }} v{{ v.version.versionNo }}</span
            >
            <mf-badge [tone]="statusTone()" data-status>{{ v.version.status }}</mf-badge>
          </span>
          <span mfDescription class="wf-meta">
            @if (!editable()) {
              <mf-badge tone="info" data-mode-badge>{{
                isOrdered() ? 'Ordered' : 'Unordered'
              }}</mf-badge>
              <span class="pg-sr" data-mode-help>{{
                isOrdered() ? orderedText : unorderedText
              }}</span>
            }
            @if (workflow()?.publishedVersionNo; as p) {
              <span data-published-note>Current published version: v{{ p }}</span>
            }
            @if (editable() && rows().length === 0) {
              <span data-publish-hint>Add at least one step before you can publish.</span>
            }
          </span>
        </mf-page-header>

        <mf-workflow-version-bar
          [workflowId]="workflowId()"
          [name]="v.workflowName"
          [versionNo]="v.version.versionNo"
          [editable]="editable()"
          [published]="isPublished()"
          [dirty]="dirty()"
          [busy]="busy()"
          [isOrdered]="isOrdered()"
          [canPublish]="rows().length > 0"
          [draftVersionId]="workflow()?.draftVersionId"
          [draftVersionNo]="workflow()?.draftVersionNo"
          (save)="save()"
          (publish)="startPublish()"
          (discard)="discardOpen.set(true)"
          (retire)="retireOpen.set(true)"
          (newDraft)="newDraft()"
          (modeRequest)="requestMode($event)"
        />

        @if (!editable() || conflict() || messages().length > 0) {
          <div class="wf-alerts">
            @if (!editable()) {
              <div class="pg-banner" data-readonly-banner>
                This version is {{ v.version.status === 'Published' ? 'published' : 'retired' }} and
                cannot be edited.
                @if (workflow()?.draftVersionId; as d) {
                  <a
                    class="pg-link"
                    [routerLink]="['/admin/workflows', workflowId(), 'versions', d]"
                    [state]="back.carry"
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
          </div>
        }

        <div class="wf-body mf-fill">
          @if (editable() && libraryPane()) {
            <section class="wf-pane wf-pane--lib" aria-labelledby="wf-lib-heading">
              <div class="wf-pane__head">
                <h2 id="wf-lib-heading">Workflow Steps</h2>
                <p class="pg-reason">Pick active steps from the library to add to this version.</p>
              </div>
              <mf-workflow-step-library
                [model]="library"
                [addedIds]="addedIds()"
                (add)="add($event)"
              />
            </section>
          }

          <section class="wf-pane wf-pane--steps" aria-labelledby="wf-steps-heading" data-steps>
            <div class="wf-pane__head">
              <div class="wf-pane__top">
                <h2 id="wf-steps-heading">Steps in this version ({{ rows().length }})</h2>
                @if (editable() && !libraryPane()) {
                  <p-button
                    label="Add step"
                    icon="pi pi-plus"
                    severity="secondary"
                    data-add-step
                    aria-haspopup="dialog"
                    (onClick)="openLibrary()"
                  />
                }
              </div>
              @if (editable() && rows().length > 0) {
                <p class="pg-reason" id="wf-reorder-help">
                  Reorder from the menu of a step (Move up, Move down), or press Alt+Up or Alt+Down
                  on a step.
                  @if (!isOrdered()) {
                    The order is for display only in an unordered workflow.
                  }
                </p>
              }
            </div>
            <div class="pg-sr" role="status" aria-live="polite" data-live>{{ live() }}</div>
            @if (rows().length === 0) {
              <div class="pg-state" data-steps-empty>
                {{
                  editable()
                    ? 'No steps yet. Add steps from Workflow Steps. A workflow needs at least one step to be published.'
                    : 'This version has no steps.'
                }}
              </div>
            } @else {
              <div class="wf-steps-scroll" mfScrollArea="Steps in this version">
                <ol
                  class="wf-steps"
                  aria-labelledby="wf-steps-heading"
                  [attr.aria-describedby]="editable() ? 'wf-reorder-help' : null"
                >
                  @for (r of rows(); track r.stepId; let i = $index; let last = $last) {
                    <li class="wf-step-item">
                      <mf-workflow-step-row
                        [row]="r"
                        [index]="i"
                        [last]="last"
                        [editable]="editable()"
                        [ordered]="isOrdered()"
                        [previewOpen]="isPreviewOpen(r.stepId)"
                        [preview]="previewOf(r.stepId)"
                        (move)="move(i, $event)"
                        (remove)="remove(i)"
                        (skippable)="setSkippable(i, $event)"
                        (commentRequired)="setCommentRequired(i, $event)"
                        (togglePreview)="togglePreview(r)"
                      />
                    </li>
                  }
                </ol>
              </div>
            }
          </section>
        </div>

        @if (editable() && !libraryPane()) {
          <p-dialog
            position="right"
            styleClass="mf-drawer"
            header="Add steps"
            [modal]="true"
            [closable]="true"
            [dismissableMask]="true"
            closeAriaLabel="Close step library"
            [mfDialogFocus]="libraryOpen()"
            [focusOnShow]="false"
            (onShow)="focusLibrarySearch()"
            [draggable]="false"
            [resizable]="false"
            [visible]="libraryOpen()"
            (visibleChange)="libraryOpen.set($event)"
            [style]="{
              width: '28rem',
              maxWidth: '100vw',
              height: '100vh',
              maxHeight: '100vh',
              margin: '0',
              borderRadius: '0',
            }"
          >
            @if (libraryOpen()) {
              <p class="pg-reason wf-drawer-help">
                Pick active steps to add to this version. The drawer stays open so you can add
                several.
              </p>
              <mf-workflow-step-library
                [model]="library"
                [addedIds]="addedIds()"
                (add)="add($event)"
              />
            }
          </p-dialog>
        }
      }
    </mf-fixed-page>

    <mf-confirm-dialog
      [title]="
        'Publish ' + (version()?.workflowName ?? '') + ' v' + (version()?.version?.versionNo ?? '')
      "
      [confirmLabel]="'Publish v' + (version()?.version?.versionNo ?? '')"
      cancelLabel="Back to draft"
      scrollLabel="Changes in this version"
      [busy]="busy() || diffLoading()"
      [(visible)]="publishOpen"
      (confirmed)="publish()"
    >
      @if (diffLoading()) {
        <p role="status">Comparing with the published version...</p>
      } @else {
        <div data-diff>
          <p class="pg-label wf-diff-h">
            @if (previousNo(); as n) {
              Changes since v{{ n }}
            } @else {
              First published version
            }
          </p>
          @if (diff(); as d) {
            @if (d.unchanged) {
              <p class="wf-diff-h">No changes from the published version.</p>
            }
            <ul class="wf-diff">
              @if (d.modeChange; as m) {
                <li>
                  <mf-badge tone="info" icon="pi-sliders-h">Mode</mf-badge>
                  <span>Changed from {{ m.from }} to {{ m.to }}</span>
                </li>
              }
              @for (t of d.added; track t) {
                <li>
                  <mf-badge tone="success" icon="pi-plus">Added</mf-badge>
                  <span class="wf-diff__title" [attr.title]="t">"{{ t }}"</span>
                </li>
              }
              @for (t of d.removed; track t) {
                <li>
                  <mf-badge tone="danger" icon="pi-minus">Removed</mf-badge>
                  <span class="wf-diff__title" [attr.title]="t">"{{ t }}"</span>
                </li>
              }
              @for (t of d.moved; track t) {
                <li>
                  <mf-badge tone="info" icon="pi-arrows-v">Moved</mf-badge>
                  <span class="wf-diff__title" [attr.title]="t">"{{ t }}"</span>
                </li>
              }
              @for (t of d.skipRuleChanged; track t) {
                <li>
                  <mf-badge tone="warning" icon="pi-forward">Skip rule changed</mf-badge>
                  <span class="wf-diff__title" [attr.title]="t">"{{ t }}"</span>
                </li>
              }
              @if (d.shifted.length > 0) {
                <li data-shifted>
                  <mf-badge tone="neutral" icon="pi-sort-alt">Positions</mf-badge>
                  <span class="wf-diff__shift">
                    {{ d.shifted.length === 1 ? '1 step' : d.shifted.length + ' steps' }} moved
                    <span class="pg-muted">(only their position numbers changed)</span>
                    <button
                      type="button"
                      class="mf-btn mf-btn--text"
                      data-shifted-toggle
                      aria-controls="wf-shifted-list"
                      [attr.aria-expanded]="shiftedOpen()"
                      (click)="shiftedOpen.set(!shiftedOpen())"
                    >
                      {{ shiftedOpen() ? 'Hide steps' : 'Show steps' }}
                    </button>
                  </span>
                  @if (shiftedOpen()) {
                    <ul class="wf-diff__shifted" id="wf-shifted-list" data-shifted-list>
                      @for (t of d.shifted; track t.title) {
                        <li>
                          <span class="wf-diff__title" [attr.title]="t.title">"{{ t.title }}"</span>
                          <span class="pg-muted">{{ t.from }} to {{ t.to }}</span>
                        </li>
                      }
                    </ul>
                  }
                </li>
              }
            </ul>
          }
          <div class="wf-impact" data-impact>
            <strong>Impact</strong>
            <p>
              Existing tasks stay on their current version. New tasks use this version. Publishing
              copies the current step content, so later library edits will not change it.
            </p>
          </div>
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
  /** The exact list view this page was opened from (#354): the crumb and the links back to the workflow return to it. */
  protected readonly back = new ListReturn(ADMIN_LIST.workflows, this.router);
  protected readonly listCrumb = this.back.crumb('Workflows');
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);
  private readonly injector = inject(Injector);
  private readonly undo = inject(UndoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly orderedText = ORDERED_TEXT;
  protected readonly unorderedText = UNORDERED_TEXT;

  /** The shared load flow of the record pages (#353): 404, 403 and failures show `mf-record-state`; the request is quiet (no toast). */
  protected readonly flow = new RecordLoadFlow('workflowVersion');
  protected readonly state = this.flow.state;
  /** The workflow's name when it loaded, so a missing or forbidden version still shows its workflow in the breadcrumb. */
  private readonly parentName = signal<string | null>(null);
  protected readonly parentCrumb = computed<Crumb | null>(() => {
    const name = this.parentName();
    return name
      ? { label: name, link: ['/admin/workflows', this.workflowId()], state: this.back.carry }
      : null;
  });
  protected readonly version = signal<WorkflowVersionDetail | null>(null);
  protected readonly workflow = signal<WorkflowSummary | null>(null);
  protected readonly rows = signal<PlacementRow[]>([]);
  protected readonly isOrdered = signal(true);
  private readonly baseline = signal('');

  protected readonly busy = signal(false);
  protected readonly messages = signal<string[]>([]);
  protected readonly conflict = signal(false);
  protected readonly live = signal('');

  /** The step library: a pane beside the steps from 1280 px, a drawer opened from Add step below that. */
  protected readonly library = new StepLibraryModel(inject(StepDefinitionsClient));
  protected readonly libraryPane = viewportAtLeast(LIBRARY_PANE_MIN);
  protected readonly libraryOpen = signal(false);
  protected readonly addedIds = computed<ReadonlySet<number>>(
    () => new Set(this.rows().map((r) => r.stepId)),
  );

  private readonly previews = signal<Record<number, PreviewState | undefined>>({});
  private readonly openPreviews = signal<ReadonlySet<number>>(new Set());

  protected readonly publishOpen = signal(false);
  protected readonly diffLoading = signal(false);
  protected readonly diff = signal<WorkflowDiff | null>(null);
  protected readonly previousNo = signal<number | null>(null);
  protected readonly shiftedOpen = signal(false);
  protected readonly modeOpen = signal(false);
  protected readonly pendingMode = signal(true);
  protected readonly retireOpen = signal(false);
  protected readonly discardOpen = signal(false);
  private leaving = false;
  private undoOffer: number | null = null;

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
    // The tab title names the state ("Workflow version not found"); the record title is #359's.
    effect(() => {
      const state = this.state();
      if (state === 'notFound' || state === 'forbidden' || state === 'error') {
        this.pageTitle.set(recordStateTitle('workflowVersion', state));
      } else if (state === 'ready') {
        // "Large Production Workflow v3 (Draft)"; follows the version after a save, publish or retire.
        const v = this.version();
        if (v) {
          this.pageTitle.set(
            shortTitleText(`${v.workflowName} v${v.version.versionNo} (${v.version.status})`),
          );
        }
      }
    });
    effect(() => {
      if (this.libraryPane()) this.libraryOpen.set(false);
    });
    this.destroyRef.onDestroy(() => {
      if (this.undoOffer !== null && this.undo.current()?.id === this.undoOffer)
        this.undo.dismiss();
    });
    effect(() => {
      this.workflowId();
      this.versionId();
      untracked(() => void this.load());
    });
  }

  hasUnsavedChanges(): boolean {
    return !this.leaving && this.dirty();
  }

  /** The leave question of a dirty draft offers this as its primary choice (VP8, #398); a failed save keeps the page open. */
  readonly saveForLeaveLabel = 'Save draft and leave';

  saveForLeave(): Promise<boolean> {
    return this.save();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  async load(): Promise<void> {
    this.resetErrors();
    if (this.undoOffer !== null && this.undo.current()?.id === this.undoOffer) this.undo.dismiss();
    const workflowId = Number(this.workflowId());
    await this.flow.run(
      async () => {
        // Both requests start together (quiet); the version decides the state, the workflow only supplies the breadcrumb and the header.
        const version = firstValueFrom(
          this.api.getWorkflowVersion(workflowId, Number(this.versionId())),
        );
        const workflow = firstValueFrom(this.api.getWorkflow(workflowId));
        const [v, w] = await Promise.allSettled([version, workflow]);
        this.parentName.set(w.status === 'fulfilled' ? w.value.workflow.name : null);
        if (v.status === 'rejected') throw v.reason;
        if (w.status === 'rejected') throw w.reason;
        return { detail: v.value, workflow: w.value };
      },
      ({ detail, workflow }) => {
        this.workflow.set(workflow.workflow);
        this.apply(detail);
      },
    );
    if (this.state() === 'ready' && this.editable() && this.library.state() !== 'ready') {
      void this.library.load();
      void this.library.loadTags();
    }
  }

  protected openLibrary(): void {
    this.library.added.set(0);
    this.libraryOpen.set(true);
  }

  protected focusLibrarySearch(): void {
    document.querySelector<HTMLElement>('.mf-drawer #wf-lib-search')?.focus();
  }

  protected add(step: StepDefinitionSummary): void {
    if (this.rows().some((r) => r.stepId === step.stepDefinitionId)) return;
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

  /** Takes the step out of the draft and offers Undo, which puts it back where it was with its skip rules (#395). */
  protected remove(index: number): void {
    const removed = this.rows()[index];
    if (!removed) return;
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
    this.live.set(`Removed ${removed.title}. ${this.rows().length} steps remain.`);
    const next = this.rows()[Math.min(index, this.rows().length - 1)];
    this.focusAfterRender(
      next ? `[data-step-id="${next.stepId}"] [data-overflow]` : '[data-add-step], #wf-lib-search',
    );
    this.undo.offer(`Removed ${removed.title} from the workflow.`, async () =>
      this.restore(removed, index),
    );
    this.undoOffer = this.undo.current()?.id ?? null;
  }

  private restore(row: PlacementRow, index: number): void {
    if (this.rows().some((r) => r.stepId === row.stepId)) return; // added again from the library meanwhile
    const at = Math.min(index, this.rows().length);
    this.rows.update((rows) => [...rows.slice(0, at), row, ...rows.slice(at)]);
    this.live.set(`Restored ${row.title} at position ${at + 1} of ${this.rows().length}.`);
    this.focusAfterRender(`[data-step-id="${row.stepId}"] [data-overflow]`);
  }

  protected move(index: number, delta: -1 | 1, control = '[data-overflow]'): void {
    const target = index + delta;
    const rows = this.rows();
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    this.rows.set(next);
    const moved = rows[index];
    this.live.set(`Moved ${moved.title} to position ${target + 1} of ${rows.length}.`);
    // Moving the row in the page loses the focus: put it back on the same control of the row.
    this.focusAfterRender(
      `[data-step-id="${moved.stepId}"] ${control}`,
      `[data-step-id="${moved.stepId}"] [data-overflow]`,
    );
  }

  /** Alt+Up / Alt+Down on a focused control of a step moves that step (the keyboard alternative to dragging; unchanged by VP2). */
  @HostListener('keydown', ['$event'])
  protected onItemKey(event: KeyboardEvent): void {
    if (!this.editable() || !event.altKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-rules-pop], [role=menu]')) return; // the popover or menu would stay behind
    const item = target?.closest<HTMLElement>('[data-step-row]');
    const id = item ? Number(item.dataset['stepId']) : NaN;
    const index = this.rows().findIndex((r) => r.stepId === id);
    if (index < 0) return;
    event.preventDefault();
    this.move(
      index,
      event.key === 'ArrowUp' ? -1 : 1,
      target?.closest('[data-rule]') ? '[data-rule]' : '[data-overflow]',
    );
  }

  protected setSkippable(index: number, value: boolean): void {
    this.patch(index, { isSkippable: value, skipCommentRequired: value ? undefined : false });
  }

  protected setCommentRequired(index: number, value: boolean): void {
    this.patch(index, { skipCommentRequired: value });
  }

  protected requestMode(ordered: boolean): void {
    if (ordered === this.isOrdered()) return;
    if (this.rows().length === 0) {
      this.isOrdered.set(ordered);
      return;
    }
    this.pendingMode.set(ordered);
    this.modeOpen.set(true);
  }

  protected confirmMode(): void {
    this.modeOpen.set(false);
    this.isOrdered.set(this.pendingMode());
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
    this.shiftedOpen.set(false);
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
    await this.router.navigate(['/admin/workflows', v.workflowDefinitionId], this.back.extras);
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
    await this.router.navigate(
      ['/admin/workflows', v.workflowDefinitionId, 'versions', draft.version.workflowVersionId],
      this.back.extras,
    );
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
    await this.router.navigate(['/admin/workflows', v.workflowDefinitionId], this.back.extras);
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
