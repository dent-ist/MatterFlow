import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { UserAvailabilityDto } from '../../api/generated/api-client';
import { LeaveConfirmService } from '../guards/unsaved-changes.guard';
import { DialogFocus } from '../ui/dialog-focus';
import { AvailabilityForm } from './availability-form';

/**
 * "Edit availability" for someone else (needs User.Manage): the same form as My profile, in a dialog. Closing with unsaved edits asks
 * first.
 */
@Component({
  selector: 'mf-availability-dialog',
  imports: [Dialog, DialogFocus, AvailabilityForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="'Availability of ' + displayName()"
      [modal]="true"
      [closable]="true"
      closeAriaLabel="Close dialog"
      [mfDialogFocus]="visible()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="request($event)"
      [style]="{ width: '50rem', maxWidth: '95vw' }"
    >
      @if (visible() && userId() !== null) {
        <mf-availability-form
          mode="dialog"
          [userId]="userId()"
          [displayName]="displayName()"
          (saved)="saved.emit($event); visible.set(false)"
          (closed)="request(false)"
        />
      }
    </p-dialog>
  `,
})
export class AvailabilityDialog {
  readonly visible = model(false);
  readonly userId = input<number | null>(null);
  readonly displayName = input('');
  readonly saved = output<UserAvailabilityDto>();

  private readonly leave = inject(LeaveConfirmService);
  private readonly form = viewChild(AvailabilityForm);

  protected async request(open: boolean): Promise<void> {
    if (open) {
      this.visible.set(true);
      return;
    }
    const dirty = this.formDirty();
    if (!dirty || (await this.leave.ask())) this.visible.set(false);
  }

  private formDirty(): boolean {
    return this.form()?.hasUnsavedChanges() ?? false;
  }
}
