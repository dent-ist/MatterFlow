import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { EntityActivity } from './entity-activity';
import { SlidePanel } from './slide-panel';

/**
 * The Activity of a record in a right-side drawer, opened from the "Activity" button of the page header. It is the shared drawer (`mf-slide-panel`, 520 px, D-33)
 * titled "Activity: <record name>": an accessible modal dialog (focus trap, Esc closes, focus returns to the button that opened it). The history loads when
 * the drawer opens and shows the same loading, empty and error states as `mf-entity-activity`.
 *
 * Without `objectType` and `objectId` the drawer shows its projected content instead (the Task page projects its own timeline, which
 * is built from the Task's own activity API). Put an `@if` around the content in the host so it is created only while the drawer is open.
 */
@Component({
  selector: 'mf-activity-drawer',
  imports: [SlidePanel, EntityActivity],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-slide-panel
      [title]="title()"
      closeLabel="Close activity"
      scrollLabel="Activity"
      initialFocus="close"
      [showFooter]="false"
      [(visible)]="visible"
    >
      @if (objectType() !== null && objectId() !== null) {
        <mf-entity-activity
          [objectType]="objectType()!"
          [objectId]="objectId()!"
          [compact]="true"
        />
      } @else {
        <ng-content />
      }
    </mf-slide-panel>
  `,
})
export class ActivityDrawer {
  /** Audit `ObjectType`, for example `Client`. */
  readonly objectType = input<string | null>(null);
  readonly objectId = input<number | string | null>(null);
  /** The record's name, for the title. */
  readonly name = input.required<string>();
  protected readonly title = computed(() => 'Activity: ' + this.name());
  readonly visible = model(false);
}
