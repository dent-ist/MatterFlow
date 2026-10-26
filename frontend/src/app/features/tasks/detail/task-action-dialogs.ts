import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { OnHoldReasonView, OnHoldReasonsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { TaskDetailStore } from './task-detail.store';

/**
 * Dialogs behind the status actions (UX S10): On hold and Cancel with a mandatory comment, Reopen confirmation, and the
 * Complete dialog (addendum K): "You have N steps not completed..." or, when steps lack required inputs, the list of
 * those steps with links that jump to them while the Task stays open.
 */
@Component({
  selector: 'mf-task-action-dialogs',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = store.dialog();
    <mf-confirm-dialog
      [title]="reasonTitle()"
      [confirmLabel]="reasonKind() === 'CANCEL' ? 'Cancel task' : 'Put on hold'"
      [cancelLabel]="reasonKind() === 'CANCEL' ? 'Keep task' : 'Close'"
      [danger]="reasonKind() === 'CANCEL'"
      [busy]="store.busy()"
      [visible]="d?.kind === 'reason'"
      (visibleChange)="closed($event)"
      (confirmed)="submitReason()"
    >
      @if (reasonKind() === 'CANCEL') {
        <p data-reason-body>
          This marks the task Cancelled. Unresolved workflow steps don't block this. You can reopen
          it later.
        </p>
      } @else {
        <p data-reason-body>
          The task stays On Hold until someone resumes it. Workflow steps can't be changed while it
          is on hold.
        </p>
      }
      @if (reasonKind() === 'HOLD') {
        <div class="reason" data-hold-reason-field>
          <label for="task-hold-reason">
            Why is it on hold?
            <span class="req">{{ reasonRequired() ? '(required)' : '(optional)' }}</span>
          </label>
          <select
            id="task-hold-reason"
            [value]="holdReasonId()"
            [attr.aria-required]="reasonRequired() ? 'true' : null"
            [attr.aria-invalid]="holdReasonError() ? 'true' : null"
            [attr.aria-describedby]="holdReasonError() ? 'task-hold-reason-error' : null"
            (change)="onHoldReason($event)"
          >
            <option value="">Choose a reason</option>
            @for (r of reasons(); track r.id) {
              <option [value]="r.id">{{ r.name }}</option>
            }
          </select>
          @if (holdReasonError(); as e) {
            <p class="error" id="task-hold-reason-error" role="alert" data-hold-reason-error>
              {{ e }}
            </p>
          }
        </div>
      }
      <div class="reason">
        <label for="task-reason">
          Reason
          <span class="req">(required)</span>
        </label>
        <textarea
          id="task-reason"
          rows="4"
          maxlength="4000"
          [value]="reason()"
          [attr.aria-invalid]="reasonError() ? 'true' : null"
          [attr.aria-describedby]="reasonError() ? 'task-reason-error' : null"
          (input)="onReason($event)"
        ></textarea>
        @if (reasonError(); as e) {
          <p class="error" id="task-reason-error" role="alert" data-reason-error>{{ e }}</p>
        }
      </div>
    </mf-confirm-dialog>

    <mf-confirm-dialog
      [title]="'Move ' + (store.task()?.taskNumber ?? '') + ' back to In Progress?'"
      confirmLabel="Reopen"
      cancelLabel="Keep"
      [busy]="store.busy()"
      [visible]="d?.kind === 'reopen'"
      (visibleChange)="closed($event)"
      (confirmed)="store.confirmReopen()"
    >
      <p data-reopen-body>The task becomes editable again. No reason is needed.</p>
    </mf-confirm-dialog>

    <mf-confirm-dialog
      [title]="completeTitle()"
      [confirmLabel]="blocked().length > 0 ? 'Go to first step' : 'Complete all steps and finish'"
      [showConfirm]="blocked().length > 0 || canBulkConfirm()"
      [cancelLabel]="blocked().length || !canBulkConfirm() ? 'Close' : 'Cancel'"
      [busy]="store.busy()"
      [visible]="d?.kind === 'complete'"
      (visibleChange)="closed($event)"
      (confirmed)="completeConfirmed()"
    >
      @if (blocked().length > 0) {
        <p data-blocked-body>These steps need required information first:</p>
        <ul class="steps" data-blocked-steps>
          @for (s of blocked(); track s.stepInstanceId) {
            <li>
              <button type="button" class="link" (click)="store.showStep(s.stepInstanceId)">
                Step {{ s.sequenceNo }}: {{ s.title }}
              </button>
            </li>
          }
        </ul>
        <p class="muted">
          The task stays open. Fill them in (or skip them if allowed), then complete again.
        </p>
      } @else {
        <p data-bulk-body>
          You have {{ unresolved().length }} {{ unresolved().length === 1 ? 'step' : 'steps' }} not
          completed. Do you want to mark them all completed?
        </p>
        <ul class="steps" data-bulk-steps>
          @for (s of unresolved(); track s.stepInstanceId) {
            <li>Step {{ s.sequenceNo }}: {{ s.title }}</li>
          }
        </ul>
        @if (!canBulkConfirm()) {
          <p class="error" data-no-execute>
            You don't have permission to complete workflow steps, so they can't be completed for
            you.
          </p>
        }
      }
    </mf-confirm-dialog>
  `,
  styles: `
    .reason {
      display: grid;
      gap: var(--mf-s1);
    }
    .reason label {
      font-weight: 600;
    }
    .req {
      font-weight: 400;
      color: var(--mf-text-muted);
    }
    select {
      min-height: 2rem;
      padding: var(--mf-s1) var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    select[aria-invalid='true'] {
      border-color: var(--mf-danger);
    }
    textarea {
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    textarea[aria-invalid='true'] {
      border-color: var(--mf-danger);
    }
    .error {
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
    .muted {
      color: var(--mf-text-muted);
    }
    .steps {
      margin: 0 0 var(--mf-s3);
      padding-left: var(--mf-s5);
    }
    .link {
      /* A 24 px target (WCAG 2.5.8): the step names are links to tap on a phone. */
      display: inline-flex;
      align-items: center;
      min-height: var(--mf-target-min, 1.5rem);
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class TaskActionDialogs {
  protected readonly store = inject(TaskDetailStore);
  private readonly reasonsApi = inject(OnHoldReasonsClient);

  /** The active on-hold reasons (PM v2, #877), read the first time a hold dialog opens. The choice is optional until the server says it is required. */
  protected readonly reasons = signal<readonly OnHoldReasonView[]>([]);
  protected readonly holdReasonId = signal('');
  protected readonly holdReasonError = signal<string | null>(null);
  /** `Tasks:OnHoldReasonRequired` is server configuration: learnt from the first ON_HOLD_REASON_REQUIRED answer, then the label says so. */
  protected readonly reasonRequired = signal(false);
  private reasonsLoaded = false;

  constructor() {
    effect(() => {
      const d = this.store.dialog();
      if (d?.kind === 'reason' && d.action === 'HOLD') untracked(() => void this.loadReasons());
    });
  }

  private async loadReasons(): Promise<void> {
    if (this.reasonsLoaded) return;
    this.reasonsLoaded = true;
    try {
      const all = await firstValueFrom(this.reasonsApi.listOnHoldReasons());
      this.reasons.set(all.filter((r) => r.isActive));
    } catch {
      this.reasonsLoaded = false;
    }
  }

  protected onHoldReason(event: Event): void {
    this.holdReasonId.set((event.target as HTMLSelectElement).value);
    this.holdReasonError.set(null);
  }

  protected readonly reason = signal('');
  protected readonly reasonError = signal<string | null>(null);

  protected readonly reasonKind = computed(() => {
    const d = this.store.dialog();
    return d?.kind === 'reason' ? d.action : 'CANCEL';
  });
  protected readonly reasonTitle = computed(() => {
    const n = this.store.task()?.taskNumber ?? '';
    return this.reasonKind() === 'CANCEL' ? `Cancel ${n}?` : `Put ${n} on hold?`;
  });

  private readonly check = computed(() => {
    const d = this.store.dialog();
    return d?.kind === 'complete' ? d.check : null;
  });
  protected readonly blocked = computed(() => this.check()?.blocked ?? []);
  protected readonly unresolved = computed(() => this.check()?.unresolved ?? []);
  protected readonly canBulkConfirm = computed(
    () =>
      this.blocked().length === 0 && (this.store.task()?.allowedActions.canExecuteSteps ?? false),
  );
  /** The earliest step that needs information: where the dialog's primary button goes (#304). */
  protected readonly firstBlocked = computed(
    () => [...this.blocked()].sort((a, b) => a.sequenceNo - b.sequenceNo)[0] ?? null,
  );
  protected readonly completeTitle = computed(() =>
    this.blocked().length > 0 ? 'Steps need information first' : 'Complete task',
  );

  /** Blocked: "Go to first step" closes the dialog and opens, scrolls to and focuses that step. Otherwise the bulk completion. */
  protected completeConfirmed(): void {
    const first = this.firstBlocked();
    if (first) this.store.showStep(first.stepInstanceId);
    else void this.store.confirmBulkComplete();
  }

  protected onReason(event: Event): void {
    this.reason.set((event.target as HTMLTextAreaElement).value);
    this.reasonError.set(null);
  }

  protected closed(visible: boolean): void {
    if (visible) return;
    this.store.closeDialog();
    this.reason.set('');
    this.reasonError.set(null);
    this.holdReasonId.set('');
    this.holdReasonError.set(null);
  }

  protected async submitReason(): Promise<void> {
    const d = this.store.dialog();
    if (d?.kind !== 'reason') return;
    const text = this.reason().trim();
    if (!text) {
      this.reasonError.set(
        d.action === 'CANCEL'
          ? "Add a reason explaining why you're cancelling."
          : 'Add a reason for putting this task on hold.',
      );
      return;
    }
    if (d.action === 'HOLD' && this.reasonRequired() && !this.holdReasonId()) {
      this.holdReasonError.set('Choose why the task is being put on hold.');
      return;
    }
    const chosen = d.action === 'HOLD' && this.holdReasonId() ? Number(this.holdReasonId()) : null;
    const result = await this.store.submitReason(d.action, text, chosen);
    if (result.ok) {
      this.reason.set('');
      this.reasonError.set(null);
      this.holdReasonId.set('');
      this.holdReasonError.set(null);
    } else if (result.error instanceof ApiError && result.error.hasFieldErrors) {
      const errors = result.error.problem?.errors ?? {};
      const key = Object.keys(errors).find((k) => k.toLowerCase() === 'onholdreasonid');
      if (key) {
        if (errors[key]?.[0]?.code === 'ON_HOLD_REASON_REQUIRED') this.reasonRequired.set(true);
        this.holdReasonError.set(errors[key]?.[0]?.message ?? result.error.message);
        return;
      }
      const first = Object.values(errors)[0]?.[0]?.message;
      this.reasonError.set(first ?? result.error.message);
    }
  }
}
