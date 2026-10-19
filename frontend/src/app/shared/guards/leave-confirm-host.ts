import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { LeaveConfirmService } from './unsaved-changes.guard';

/** Renders the "Leave without saving?" question asked by the unsaved-changes guard. */
@Component({
  selector: 'mf-leave-confirm-host',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-confirm-dialog
      title="Leave without saving?"
      confirmLabel="Leave"
      cancelLabel="Stay"
      [danger]="true"
      [extraLabel]="leave.saveOffer()?.label ?? ''"
      [busy]="leave.saving()"
      [visible]="leave.open()"
      (visibleChange)="!$event && leave.answer(false)"
      (confirmed)="leave.answer(true)"
      (extra)="leave.saveAndLeave()"
    >
      <p>You have unsaved changes. If you leave now they will be lost.</p>
    </mf-confirm-dialog>
  `,
})
export class LeaveConfirmHost {
  protected readonly leave = inject(LeaveConfirmService);
}
