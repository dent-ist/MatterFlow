import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { DialogFocus } from './dialog-focus';
import { DIALOG_WIDTHS } from './form-dialog';
import { ScrollRegion } from './scroll-region';

/**
 * Generic confirmation (UX `mf-confirm-dialog`, 5.4): title states the action, body the consequence, buttons use verbs.
 * Set `showConfirm` to false for an information-only dialog with just the close button.
 *
 * The dialog and drawer rule (S18, #619; the same for the Activity drawer, the phone filter sheet and every drawer a page adds):
 *  - the anatomy is the one of every dialog (`styles/_dialogs.scss`, D-31, #1137): header 56 px with the title 16 / 600, the 36 x 36 icon-only X at
 *    the right, body padding 16, footer with a top border; radius 12, `--mf-shadow-pop`;
 *  - the width is the `size` input (small 416 px by default, default 576 px, large 768 px);
 *  - the footer puts the secondary action on the left and the primary on the right; a destructive primary is red; an error sits above the buttons;
 *  - the secondary is always "Cancel" (D-34, #1141); only the unsaved-changes question says "Keep Editing" / "Discard Changes". The title is the verb and the thing in Title Case without a question mark ("Delete Note"), the body one sentence with the consequence, the confirm button repeats the title.
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
      /* The body clips what leaves it, and a full-width field has its 2 px focus ring outside its box: 3 px of room all round (pulled back by the same
         margin, so nothing moves) keep the ring whole at the left and right edges. */
      padding: 3px;
      margin: -3px;
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
  `,
  template: `
    <p-dialog
      styleClass="mf-dlg mf-confirmdlg"
      [header]="title()"
      [modal]="true"
      [closable]="true"
      closeIcon="pi pi-times"
      closeAriaLabel="Close dialog"
      [mfDialogFocus]="visible()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [style]="{ width: width(), whiteSpace: 'normal' }"
    >
      <div class="mf-dlg__body">
        <div class="mf-confirm__body" data-confirm-body [mfScrollRegion]="scrollLabel()">
          <ng-content />
        </div>
        <span class="mf-confirm__sr" role="status">{{ busy() ? 'Working...' : '' }}</span>
      </div>
      <ng-template #footer>
        <div class="mf-dlg__foot">
          <!-- A failed confirm stays in the dialog (TY-K, #414): the message is read here, where focus is. -->
          @if (error()) {
            <p class="mf-dlg__error" role="alert" data-confirm-error>
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>{{ error() }}
            </p>
          }
          <div
            class="mf-dlg__buttons"
            [class.mf-dlg__buttons--end]="!showConfirm() && extraLabel() === ''"
          >
            <p-button [label]="cancelLabel()" severity="secondary" (onClick)="visible.set(false)" />
            @if (showConfirm() || extraLabel() !== '') {
              <span class="mf-dlg__buttons-end">
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
              </span>
            }
          </div>
        </div>
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

  /** Width: `small` 416 px (the default, a confirmation), `default` 576 px, `large` 768 px (D-32). */
  readonly size = input<'small' | 'default' | 'large'>('small');

  protected readonly width = computed(() => DIALOG_WIDTHS[this.size()]);

  readonly visible = model(false);
  readonly confirmed = output<void>();
  readonly extra = output<void>();
}
