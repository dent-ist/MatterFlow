import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { LeaveConfirmService } from './unsaved-changes.guard';

/** Renders the unsaved-changes question asked by the guard (D-31): "Unsaved Changes", "You have unsaved changes. Discard them?", [Keep Editing] [Discard Changes]. */
@Component({
  selector: 'mf-leave-confirm-host',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-confirm-dialog
      title="Unsaved Changes"
      confirmLabel="Discard Changes"
      cancelLabel="Keep Editing"
      [danger]="true"
      [extraLabel]="leave.saveOffer()?.label ?? ''"
      [busy]="leave.saving()"
      [visible]="leave.open()"
      (visibleChange)="!$event && leave.answer(false)"
      (confirmed)="leave.answer(true)"
      (extra)="leave.saveAndLeave()"
    >
      <p>You have unsaved changes. Discard them?</p>
    </mf-confirm-dialog>
  `,
})
export class LeaveConfirmHost {
  protected readonly leave = inject(LeaveConfirmService);
}
