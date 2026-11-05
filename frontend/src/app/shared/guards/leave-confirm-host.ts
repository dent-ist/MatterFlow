import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { LeaveConfirmService } from './unsaved-changes.guard';

/** Renders the "Discard Unsaved Changes" question asked by the unsaved-changes guard. */
@Component({
  selector: 'mf-leave-confirm-host',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-confirm-dialog
      title="Discard Unsaved Changes"
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
      <p>You have unsaved changes and they are lost if you leave now.</p>
    </mf-confirm-dialog>
  `,
})
export class LeaveConfirmHost {
  protected readonly leave = inject(LeaveConfirmService);
}
