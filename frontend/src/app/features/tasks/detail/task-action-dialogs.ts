import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
    const result = await this.store.submitReason(d.action, text);
    if (result.ok) {
      this.reason.set('');
      this.reasonError.set(null);
    } else if (result.error instanceof ApiError && result.error.hasFieldErrors) {
      const first = Object.values(result.error.problem?.errors ?? {})[0]?.[0]?.message;
      this.reasonError.set(first ?? result.error.message);
    }
  }
}
