import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { DialogFocus } from './dialog-focus';
import { ScrollRegion } from './scroll-region';

/**
 * Generic confirmation (UX `mf-confirm-dialog`, 5.4): title states the action, body the consequence, buttons use verbs.
 * Set `showConfirm` to false for an information-only dialog with just the close button.
 *
 * The dialog and drawer rule (S18, #619; the same for the Activity drawer, the phone filter sheet and every drawer a page adds):
 *  - the title is 16 px / 600 (the PrimeNG dialog theme in `core/theme/mf-preset.ts`);
 *  - one close button style: the round icon-only X at the right of the title, named "Close ...";
 *  - the footer puts the secondary action on the left and the primary on the right; a destructive primary is red;
 *  - the secondary is "Cancel", unless that would read as the action itself (a named alternative such as "Keep task" then).
 */
@Component({
  selector: 'mf-confirm-dialog',
  imports: [Dialog, Button, DialogFocus, ScrollRegion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* The text wraps (the dialog may be opened from a table cell that does not: BUG-5) and long references break instead of widening it.
       The body scrolls when taller than the window; the footer buttons stay visible. */
    .mf-confirm__body {
      max-height: calc(90dvh - 13rem);
      overflow-x: hidden;
      overflow-y: auto;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    /* While the action runs the buttons look disabled but stay focusable: a disabled button loses focus and the dialog's focus trap then
       moves it to Cancel (TY-K, #414). The click is ignored while busy. */
    :host ::ng-deep .mf-confirm__busy button {
      opacity: 0.6;
      cursor: progress;
    }
    .mf-confirm__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    /* A failed confirm stays in the dialog (TY-K, #414): the message is read here, where focus is. */
    .mf-confirm__error {
      margin: 0.75rem 0 0;
      color: var(--mf-danger);
      font-weight: 600;
      overflow-wrap: anywhere;
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
      <div class="mf-confirm__body" data-confirm-body [mfScrollRegion]="scrollLabel()">
        <ng-content />
      </div>
      <span class="mf-confirm__sr" role="status">{{ busy() ? 'Working...' : '' }}</span>
      @if (error()) {
        <p class="mf-confirm__error" role="alert" data-confirm-error>{{ error() }}</p>
      }
      <ng-template #footer>
        <p-button [label]="cancelLabel()" severity="secondary" (onClick)="visible.set(false)" />
        @if (showConfirm()) {
          <p-button
            [label]="confirmLabel()"
            [severity]="danger() ? 'danger' : 'primary'"
            [outlined]="extraLabel() !== '' && danger()"
            [styleClass]="danger() && extraLabel() === '' ? 'mf-btn--solid' : ''"
            data-confirm-primary
            [class.mf-confirm__busy]="busy()"
            (onClick)="busy() || confirmed.emit()"
          />
        }
        @if (extraLabel() !== '') {
          <p-button
            [label]="extraLabel()"
            severity="primary"
            data-extra
            [class.mf-confirm__busy]="busy()"
            (onClick)="busy() || extra.emit()"
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
  /**
   * Why the confirmed action failed (TY-K, #414). The page keeps the dialog open on a failure and passes the message here, so focus stays
   * on the confirm button and the message is announced (`role="alert"`); the person can try again or cancel. Empty: no message.
   */
  readonly error = input('');
  readonly showConfirm = input(true);
  /**
   * Names the body as a scrollable region ("Changes in this version"): when the content is taller than the window the body scrolls and
   * becomes a focusable region with this name, so a keyboard user can scroll it (BUG-4). Set it on dialogs that may show a long list.
   */
  readonly scrollLabel = input('');
  /**
   * A third, primary choice after the confirm button ("Save draft and leave"). With it the confirm button, when `danger`, becomes the
   * secondary danger choice (an outline) and the extra button is the primary one. Empty: no extra button.
   */
  readonly extraLabel = input('');

  readonly visible = model(false);
  readonly confirmed = output<void>();
  readonly extra = output<void>();
}
