import { ChangeDetectionStrategy, Component, input, model, output, viewChild } from '@angular/core';
import { UserAvailabilityDto } from '../../api/generated/api-client';
import { FormDialog } from '../ui/form-dialog';
import { AvailabilityForm } from './availability-form';

/**
 * "Edit availability" for someone else (needs User.Manage): the same form as My profile, in the shared form dialog. The footer (Cancel, Save Changes) and the
 * question on closing with unsaved edits are the dialog's own.
 */
@Component({
  selector: 'mf-availability-dialog',
  imports: [FormDialog, AvailabilityForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-form-dialog
      [title]="'Availability of ' + displayName()"
      primaryLabel="Save Changes"
      [dirty]="form()?.dirty() ?? false"
      [canSubmit]="form()?.dirty() ?? false"
      [busy]="form()?.busy() ?? false"
      [(visible)]="visible"
      (submitted)="form()?.save()"
    >
      @if (visible() && userId() !== null) {
        <mf-availability-form
          mode="dialog"
          [userId]="userId()"
          [displayName]="displayName()"
          (saved)="saved.emit($event); visible.set(false)"
        />
      }
    </mf-form-dialog>
  `,
})
export class AvailabilityDialog {
  readonly visible = model(false);
  readonly userId = input<number | null>(null);
  readonly displayName = input('');
  readonly saved = output<UserAvailabilityDto>();

  protected readonly form = viewChild(AvailabilityForm);
}
