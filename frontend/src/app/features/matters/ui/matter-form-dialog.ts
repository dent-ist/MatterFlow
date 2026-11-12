import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { MatterResponse } from '../../../api/generated/api-client';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { MatterForm } from './matter-form';

/**
 * Edit Matter (MD-43, #1061): the pop-up on the Summary. The fields are the matter form (`MatterForm`), the same set the full-page New Matter holds (epic #1368); this
 * host adds the title with the CM Number, Save Changes and the question before it closes with unsaved changes.
 */
@Component({
  selector: 'mf-matter-form-dialog',
  imports: [FormDialog, MatterForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-form-dialog
      title="Edit Matter"
      [subtitle]="matter().matterRef"
      primaryLabel="Save Changes"
      [busy]="form.busy()"
      [error]="form.error()"
      [dirty]="form.dirty()"
      [(visible)]="visible"
      (submitted)="form.save()"
    >
      <mf-matter-form
        #form
        [matter]="matter()"
        [active]="visible()"
        (saved)="done($event)"
        (lostAccess)="lost()"
      />
    </mf-form-dialog>
  `,
})
export class MatterFormDialog {
  /** The matter to edit. */
  readonly matter = input.required<MatterResponse>();
  readonly visible = model(false);
  readonly saved = output<MatterResponse>();
  readonly lostAccess = output<void>();

  protected done(saved: MatterResponse): void {
    this.visible.set(false);
    this.saved.emit(saved);
  }

  protected lost(): void {
    this.visible.set(false);
    this.lostAccess.emit();
  }
}
