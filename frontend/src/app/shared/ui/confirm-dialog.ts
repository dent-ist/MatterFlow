import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { DialogFocus } from './dialog-focus';

/**
 * Generic confirmation (UX `mf-confirm-dialog`, 5.4): title states the action, body the consequence, buttons use verbs.
 * Set `showConfirm` to false for an information-only dialog with just the close button.
 */
@Component({
  selector: 'mf-confirm-dialog',
  imports: [Dialog, Button, DialogFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* The text wraps (the dialog may be opened from a table cell that does not: BUG-5) and long references break instead of widening it.
       The body scrolls when taller than the window; the footer buttons stay visible. */
    .mf-confirm__body {
      max-height: calc(100dvh - 12rem);
      overflow-x: hidden;
      overflow-y: auto;
      overflow-wrap: anywhere;
      white-space: normal;
    }
  `,
  template: `
    <p-dialog
      [header]="title()"
      [modal]="true"
      [closable]="true"
      closeAriaLabel="Close dialog"
      [mfDialogFocus]="visible()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [style]="{ width: '32rem', maxWidth: '95vw', whiteSpace: 'normal' }"
    >
      <div class="mf-confirm__body" data-confirm-body>
        <ng-content />
      </div>
      <ng-template #footer>
        <p-button [label]="cancelLabel()" severity="secondary" (onClick)="visible.set(false)" />
        @if (showConfirm()) {
          <p-button
            [label]="confirmLabel()"
            [severity]="danger() ? 'danger' : 'primary'"
            [styleClass]="danger() ? 'mf-btn--solid' : ''"
            [disabled]="busy()"
            (onClick)="confirmed.emit()"
          />
        }
      </ng-template>
    </p-dialog>
  `,
})
export class ConfirmDialog {
  readonly title = input.required<string>();
  readonly confirmLabel = input('Confirm');
  readonly cancelLabel = input('Cancel');
  readonly danger = input(false);
  readonly busy = input(false);
  readonly showConfirm = input(true);

  readonly visible = model(false);
  readonly confirmed = output<void>();
}
