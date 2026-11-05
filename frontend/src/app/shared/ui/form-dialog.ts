import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { DialogFocus } from './dialog-focus';

/** Dialog widths (D-32; the tokens of docs/ux/tokens.css): 416 px small, 576 px default, 768 px large; `max-width: calc(100vw - 32px)` is in styles/_dialogs.scss. */
export const DIALOG_WIDTHS = {
  small: 'var(--mf-dialog-w-sm)',
  default: 'var(--mf-dialog-w)',
  large: 'var(--mf-dialog-w-lg)',
} as const;

/**
 * The app standard for creating and editing a record (epic #1001, MD-22, #1026; owner decision 2026-11-02, addendum AQ): a centred pop-up dialog with
 * a header (title, close), a scrolling body and a footer with **Cancel on the left and the primary action on the right** (anatomy in `styles/_dialogs.scss`, shared with the confirm and lookup dialogs). Side panels
 * (`mf-slide-panel`) stay for read and detail context only.
 *
 * It is an accessible modal dialog (PrimeNG `p-dialog`): Esc and a click on the scrim close it, Tab stays inside, focus moves to the first
 * field when it opens and returns to the control that opened it when it closes. While `dirty` is set, Esc, the scrim, the X and Cancel do not
 * close it at once: "You have unsaved changes. Discard them?" asks first ([Keep Editing] [Discard Changes]). `busy` disables the actions and shows "Saving..."; `error`
 * shows a message in the footer (`role="alert"`). The page owns the form and the save: it listens to `(submitted)` and closes the dialog with
 * `visible.set(false)` when the save worked. Sizes: `small` (416 px), `default` (576 px), `large` (768 px); on a phone it fills the screen.
 *
 * ```html
 * <mf-form-dialog title="New Project" primaryLabel="Add Project" [dirty]="form.dirty" [busy]="busy()" [(visible)]="open" (submitted)="save()">
 *   <form>...</form>
 * </mf-form-dialog>
 * ```
 */
@Component({
  selector: 'mf-form-dialog',
  imports: [Dialog, Button, DialogFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .fd__body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
    }
    .fd__guard {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-sem-risk-solid);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-risk-bg);
      color: var(--mf-sem-risk-fg);
    }
    .fd__guard-actions {
      display: flex;
      gap: var(--mf-s2);
    }
    .fd__busy {
      opacity: 0.6;
      cursor: progress;
    }
  `,
  template: `
    <p-dialog
      styleClass="mf-dlg mf-formdlg"
      [modal]="true"
      [closable]="false"
      [dismissableMask]="!dirty()"
      [closeOnEscape]="false"
      [mfDialogFocus]="visible()"
      [focusOnShow]="false"
      (onShow)="focusFirst()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="onVisible($event)"
      [style]="{ width: width() }"
      [contentStyle]="{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }"
    >
      <ng-template #header let-labelId="ariaLabelledBy">
        <span class="mf-dlg__title" data-panel-title [id]="labelId"
          >{{ title() }}
          @if (subtitle()) {
            <span class="mf-dlg__sub">{{ subtitle() }}</span>
          }
        </span>
        <button
          type="button"
          class="mf-dlg__x"
          data-panel-close
          [attr.aria-label]="'Close ' + title()"
          (click)="requestClose()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </ng-template>
      @if (visible()) {
        <div class="fd__body mf-dlg__body" data-panel-body><ng-content /></div>
      }
      <ng-template #footer>
        @if (showFooter()) {
          <div class="mf-dlg__foot" data-panel-footer>
            @if (error()) {
              <p class="mf-dlg__error" role="alert" data-panel-error>
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i>{{ error() }}
              </p>
            }
            @if (guard()) {
              <div
                class="fd__guard"
                role="alertdialog"
                aria-label="Discard changes?"
                data-panel-guard
              >
                <span>You have unsaved changes. Discard them?</span>
                <span class="fd__guard-actions">
                  <p-button
                    label="Keep Editing"
                    severity="secondary"
                    data-guard-keep
                    (onClick)="guard.set(false)"
                  />
                  <p-button
                    label="Discard Changes"
                    severity="danger"
                    data-guard-discard
                    (onClick)="close()"
                  />
                </span>
              </div>
            }
            <div
              class="mf-dlg__buttons"
              [class.mf-dlg__buttons--end]="!showPrimary() && !deleteLabel()"
            >
              @if (deleteLabel()) {
                <p-button
                  [label]="deleteLabel()"
                  severity="danger"
                  [outlined]="true"
                  data-panel-delete
                  (onClick)="!busy() && deleted.emit()"
                />
              }
              <span class="mf-dlg__buttons-end" [class.mf-dlg__buttons-end--split]="!deleteLabel()">
                <p-button
                  [label]="secondaryLabel()"
                  severity="secondary"
                  data-panel-cancel
                  (onClick)="requestClose()"
                />
                @if (showPrimary()) {
                  <p-button
                    [label]="busy() ? busyLabel() : primaryLabel()"
                    [styleClass]="busy() ? 'fd__busy' : ''"
                    [attr.aria-disabled]="!canSubmit() || busy() ? 'true' : null"
                    data-panel-primary
                    (onClick)="canSubmit() && !busy() && submitted.emit()"
                  />
                }
              </span>
            </div>
          </div>
        }
      </ng-template>
    </p-dialog>
  `,
})
export class FormDialog {
  readonly title = input.required<string>();
  /** A quiet line under the title (the CM number). */
  readonly subtitle = input('');
  readonly size = input<'small' | 'default' | 'large'>('default');
  readonly primaryLabel = input('Save');
  readonly secondaryLabel = input('Cancel');
  /** What the primary button says while `busy` is set. */
  readonly busyLabel = input('Saving...');
  /** The save runs: the primary button says "Saving..." and ignores clicks (it stays focusable). */
  readonly busy = input(false);
  /** Why the save failed; shown in the footer and announced. */
  readonly error = input('');
  /** Unsaved changes: closing asks before it discards. */
  readonly dirty = input(false);
  /** False while the form is invalid; the primary button is `aria-disabled` and does nothing. */
  readonly canSubmit = input(true);
  /** False for a dialog that only shows a result: the footer then has just the secondary button (name it "Close"), at the right end. */
  readonly showPrimary = input(true);
  /**
   * A destructive action of the record (Delete): the label of a danger button at the far left of the footer, away from Cancel and the primary
   * (D-30). Empty: no such button. The page confirms or deletes in `(deleted)`.
   */
  readonly deleteLabel = input('');
  /** False for a dialog that has no footer. */
  readonly showFooter = input(true);

  readonly visible = model(false);
  readonly submitted = output<void>();
  readonly cancelled = output<void>();
  readonly deleted = output<void>();

  protected readonly guard = signal(false);
  protected readonly width = computed(() => DIALOG_WIDTHS[this.size()]);

  protected onVisible(v: boolean): void {
    if (v) return;
    this.close();
  }

  /** The X, Cancel: asks first while there are unsaved changes. */
  protected requestClose(): void {
    if (this.dirty()) {
      this.guard.set(true);
      return;
    }
    this.close();
  }

  protected close(): void {
    this.guard.set(false);
    if (this.visible()) {
      this.visible.set(false);
      this.cancelled.emit();
    }
  }

  /**
   * Esc closes the dialog, or asks first while there are unsaved changes (PrimeNG's own Esc handling is off). A key that an open dropdown or menu inside the dialog used
   * to close its own list is left alone.
   */
  @HostListener('document:keydown.escape', ['$event'])
  protected onEscape(e: Event): void {
    if (!this.visible() || e.defaultPrevented || !document.querySelector('.mf-formdlg')) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest('[role=listbox], [role=menu], .dd-panel')) return;
    if (this.dirty()) {
      this.guard.set(true);
      return;
    }
    this.close();
  }

  /** A click on the scrim while there are unsaved changes asks as well. */
  @HostListener('document:click', ['$event'])
  protected onDocClick(e: Event): void {
    const t = e.target;
    if (
      this.visible() &&
      this.dirty() &&
      t instanceof HTMLElement &&
      t.classList.contains('p-dialog-mask') &&
      t.querySelector('.mf-formdlg')
    ) {
      this.guard.set(true);
    }
  }

  /** Focus goes to the first field, or to the close button when the dialog has none. */
  protected focusFirst(): void {
    const root = document.querySelector<HTMLElement>('.mf-formdlg');
    // The person (or a fast test) already moved into a field: the enter animation must not take focus back from it.
    const active = document.activeElement;
    if (
      root &&
      active instanceof HTMLElement &&
      root.querySelector('[data-panel-body]')?.contains(active) &&
      active.matches('input, select, textarea, [tabindex="0"]')
    )
      return;
    const field = root?.querySelector<HTMLElement>(
      '[data-panel-body] input:not([type=hidden]):not([disabled]), [data-panel-body] select:not([disabled]), [data-panel-body] textarea:not([disabled]), [data-panel-body] [tabindex="0"]',
    );
    (field ?? root?.querySelector<HTMLElement>('[data-panel-close]'))?.focus();
  }
}
