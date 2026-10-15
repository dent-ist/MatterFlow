import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { DialogFocus } from './dialog-focus';
import { EntityActivity } from './entity-activity';

/**
 * The Activity of a record in a right-side drawer, opened from the "Activity" button of the page header. It is an accessible modal
 * dialog (focus trap, Esc closes, focus returns to the button that opened it) titled "Activity: <record name>". The history loads when
 * the drawer opens and shows the same loading, empty and error states as `mf-entity-activity`.
 *
 * Without `objectType` and `objectId` the drawer shows its projected content instead (the Task page projects its own timeline, which
 * is built from the Task's own activity API). Put an `@if` around the content in the host so it is created only while the drawer is open.
 */
@Component({
  selector: 'mf-activity-drawer',
  imports: [Dialog, DialogFocus, EntityActivity],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="'Activity: ' + name()"
      position="right"
      styleClass="mf-drawer"
      [modal]="true"
      [closable]="true"
      [dismissableMask]="true"
      closeAriaLabel="Close activity"
      [mfDialogFocus]="visible()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [style]="{
        width: '36rem',
        maxWidth: '100vw',
        height: '100vh',
        maxHeight: '100vh',
        margin: '0',
        borderRadius: '0',
      }"
    >
      @if (visible()) {
        @if (objectType() !== null && objectId() !== null) {
          <mf-entity-activity
            [objectType]="objectType()!"
            [objectId]="objectId()!"
            [compact]="true"
          />
        } @else {
          <ng-content />
        }
      }
    </p-dialog>
  `,
})
export class ActivityDrawer {
  /** Audit `ObjectType`, for example `Client`. */
  readonly objectType = input<string | null>(null);
  readonly objectId = input<number | string | null>(null);
  /** The record's name, for the title. */
  readonly name = input.required<string>();
  readonly visible = model(false);
}
