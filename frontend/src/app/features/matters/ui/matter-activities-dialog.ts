import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { MatterActivities } from './matter-activities';

/**
 * The Activities dialog of a Matter (#1404, epic #1389; D-31, D-31b): a large (768 px) read-only view dialog opened by the "Activities" entry of the More Actions menu, in place of the
 * Activities tab and section. Title "Activities", the matter reference as subtitle, the activity list (When, What, Who, the Kind dropdown, Columns, "Show More") as the body and `[Close]`
 * as the only button. The list is created, and asks the server, only while the dialog is open. Needs `Audit.View`; the page does not offer the entry without it.
 */
@Component({
  selector: 'mf-matter-activities-dialog',
  imports: [FormDialog, MatterActivities],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* A fixed height (like the tabbed view dialog, D-31a) so a Kind filter or a short list does not make the dialog jump; the list scrolls inside. */
    .mad {
      display: flex;
      flex-direction: column;
      height: min(32rem, calc(90vh - 8.5rem));
      min-height: 0;
    }
  `,
  template: `
    <mf-form-dialog
      title="Activities"
      [subtitle]="matterRef()"
      size="large"
      secondaryLabel="Close"
      [showPrimary]="false"
      [dismissOnScrim]="true"
      [(visible)]="visible"
    >
      <div class="mad" data-matter-activities-dialog>
        <mf-matter-activities [matterId]="matterId()" data-activities-list />
      </div>
    </mf-form-dialog>
  `,
})
export class MatterActivitiesDialog {
  readonly matterId = input.required<number>();
  /** The matter's reference, the subtitle. */
  readonly matterRef = input('');
  readonly visible = model(false);
}
