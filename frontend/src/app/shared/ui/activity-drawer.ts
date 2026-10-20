import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { DialogFocus } from './dialog-focus';
import { EntityActivity } from './entity-activity';
import { ScrollRegion } from './scroll-region';

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
  imports: [Dialog, DialogFocus, EntityActivity, ScrollRegion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* A long record name (a 200-character task title) takes at most 2 lines; the whole text is in the tooltip and is the dialog's name. */
    .mf-drawer__title {
      display: -webkit-box;
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      overflow-wrap: anywhere;
      font-size: 1.25rem;
      font-weight: 600;
      line-clamp: 2;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    /* The history scrolls inside the drawer: that box is a named, focusable region while it overflows (axe scrollable-region-focusable,
       TY-K #415), so a keyboard user can scroll a long history. The dialog's own content area does not scroll. */
    .mf-drawer__scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }
  `,
  template: `
    <p-dialog
      position="right"
      styleClass="mf-drawer"
      [modal]="true"
      [closable]="true"
      [dismissableMask]="true"
      closeAriaLabel="Close activity"
      [mfDialogFocus]="visible()"
      [focusOnShow]="false"
      (onShow)="focusClose()"
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
      [contentStyle]="{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }"
    >
      <ng-template #header let-labelId="ariaLabelledBy">
        <span class="mf-drawer__title" data-drawer-title [id]="labelId" [title]="title()">{{
          title()
        }}</span>
      </ng-template>
      @if (visible()) {
        <div class="mf-drawer__scroll" mfScrollRegion="Activity" data-drawer-scroll>
          @if (objectType() !== null && objectId() !== null) {
            <mf-entity-activity
              [objectType]="objectType()!"
              [objectId]="objectId()!"
              [compact]="true"
            />
          } @else {
            <ng-content />
          }
        </div>
      }
    </p-dialog>
  `,
})
export class ActivityDrawer {
  /** Every Activity drawer opens with focus on its Close button, whether or not its content has loaded yet (UXR4-20). */
  protected focusClose(): void {
    document.querySelector<HTMLElement>('.mf-drawer button[aria-label="Close activity"]')?.focus();
  }

  /** Audit `ObjectType`, for example `Client`. */
  readonly objectType = input<string | null>(null);
  readonly objectId = input<number | string | null>(null);
  /** The record's name, for the title. */
  readonly name = input.required<string>();
  protected readonly title = computed(() => 'Activity: ' + this.name());
  readonly visible = model(false);
}
