import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  model,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { focusFirstInvalid } from '../forms/focus-invalid';
import { LeaveConfirmService } from '../guards/unsaved-changes.guard';
import { DialogFocus } from './dialog-focus';

/**
 * The lookup dialog (#564): the "short form is a dialog" rule of ux-spec 5.4 for the small admin records (a priority, a link role, a status
 * label's name). One form in a dialog instead of inline row edits and an Add form under the table.
 *
 *   <mf-lookup-dialog title="Rename status label" submitLabel="Save name" [(visible)]="open" [dirty]="name() !== original()"
 *       [saving]="busy()" [error]="serverError()" [summary]="summary()" (save)="save()" (cancel)="reset()">
 *     <mf-text-field inputId="sl-name" label="Name" [required]="true" [maxLength]="50" [counter]="true" [error]="nameError()" [(value)]="name" />
 *     <mf-priority-badge mfPreview [label]="name()" [color]="color()" />        <!-- live preview of the result (optional) -->
 *   </mf-lookup-dialog>
 *
 * - Fields go in the default slot; a live preview (the badge as it will look) in the `mfPreview` slot, under the fields, named "Preview".
 * - Validation (#361): the page validates on `(save)` and passes the messages as `summary`. The summary shows at the top ("Fix the following to
 *   save:", role=alert), each field shows its own message with the icon (`mf-text-field [error]`), and focus goes to the first field marked
 *   `aria-invalid`. A server failure goes in `error` (role=alert, the dialog stays open, focus stays on the button).
 * - Closing with unsaved edits (`dirty`) asks "Leave without saving?" through `LeaveConfirmService` (Stay is the default); Escape, the X and
 *   Cancel all go through it. `(cancel)` fires once the dialog has closed without saving. The page closes the dialog itself after a save.
 * - Focus: the first field when it opens; back to the control that opened it (the row menu button or the New button) when it closes
 *   (`DialogFocus`); the focus trap is the dialog's own. Enter in a field saves. While `saving` the buttons keep focus and ignore clicks.
 * - No keyboard shortcut is added.
 */
@Component({
  selector: 'mf-lookup-dialog',
  imports: [Dialog, Button, DialogFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape($event)' },
  styles: `
    .ld-head {
      display: flex;
      flex: 1;
      gap: var(--mf-s3);
      align-items: center;
      justify-content: space-between;
      min-width: 0;
    }
    .ld-title {
      min-width: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .ld-close {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: var(--mf-radius);
      background: transparent;
      color: var(--mf-text);
      cursor: pointer;
    }
    .ld-close:hover {
      background: var(--mf-surface-alt);
    }
    .ld-form {
      display: grid;
      gap: var(--mf-s4);
      overflow-wrap: anywhere;
    }
    .ld-summary,
    .ld-error {
      margin: 0;
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
      background: var(--mf-danger-bg);
      color: var(--mf-danger);
    }
    .ld-summary ul {
      margin: var(--mf-s1) 0 0;
      padding-left: var(--mf-s5);
    }
    .ld-preview {
      display: grid;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .ld-preview legend {
      padding: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .ld-preview-body:empty,
    .ld-preview:has(.ld-preview-body:empty) {
      display: none;
    }
    .ld-sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    :host ::ng-deep .ld-busy button {
      opacity: 0.6;
      cursor: progress;
    }
  `,
  template: `
    <p-dialog
      [modal]="true"
      [closable]="false"
      [mfDialogFocus]="visible()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="request($event)"
      (onShow)="focusFirstField()"
      [style]="{ width: '30rem', maxWidth: '95vw', whiteSpace: 'normal' }"
    >
      <!-- PrimeNG closes a dialog by itself on Escape and on the X, which would leave it hidden after "Stay"; this dialog closes through
           request() only, so it has its own header (the title names the dialog) and handles Escape itself. -->
      <ng-template #header let-labelId="ariaLabelledBy">
        <div class="ld-head">
          <span class="ld-title" [id]="labelId" data-lookup-title>{{ title() }}</span>
          <button
            type="button"
            class="ld-close"
            aria-label="Close dialog"
            data-lookup-close
            (click)="request(false)"
          >
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </div>
      </ng-template>
      <form #form class="ld-form" novalidate data-lookup-form (submit)="submit($event)">
        @if (summary().length > 0) {
          <div class="ld-summary" role="alert" data-summary>
            Fix the following to save:
            <ul>
              @for (message of summary(); track message) {
                <li>{{ message }}</li>
              }
            </ul>
          </div>
        }
        @if (error()) {
          <p class="ld-error" role="alert" data-lookup-error>{{ error() }}</p>
        }
        <ng-content />
        <fieldset class="ld-preview" data-preview>
          <legend>Preview</legend>
          <div class="ld-preview-body"><ng-content select="[mfPreview]" /></div>
        </fieldset>
        <span class="ld-sr" role="status">{{ saving() ? 'Saving...' : '' }}</span>
      </form>
      <ng-template #footer>
        <p-button
          [label]="cancelLabel()"
          severity="secondary"
          data-lookup-cancel
          (onClick)="request(false)"
        />
        <p-button
          [label]="submitLabel()"
          severity="primary"
          data-lookup-submit
          [class.ld-busy]="saving()"
          [attr.aria-busy]="saving() ? 'true' : null"
          (onClick)="submit()"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class LookupDialog {
  private readonly injector = inject(Injector);
  private readonly leave = inject(LeaveConfirmService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly form = viewChild<ElementRef<HTMLFormElement>>('form');

  readonly title = input.required<string>();
  readonly visible = model(false);
  /** The person changed something: closing then asks first. */
  readonly dirty = input(false);
  /** The save is running: the buttons keep focus but ignore clicks, and "Saving..." is announced. */
  readonly saving = input(false);
  /** Why the save failed (from the server); the dialog stays open. */
  readonly error = input('');
  /** The validation messages ("Enter a name."); non-empty shows the summary and moves focus to the first invalid field. */
  readonly summary = input<readonly string[]>([]);
  readonly submitLabel = input('Save');
  readonly cancelLabel = input('Cancel');

  /** The person asked to save (the button, or Enter in a field). The page validates and saves. */
  readonly save = output<void>();
  /** The dialog closed without saving (Cancel, Escape or the X, after the leave question if there were edits). */
  // The name is the kit contract of #564 (`(cancel)`); no native element inside the dialog emits a bubbling `cancel` event.
  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly cancel = output<void>();

  /** The control that had focus when the dialog opened (the row's Rename, the New button): focus goes back to it when the dialog is gone. */
  private opener: HTMLElement | null = null;
  private wasVisible = false;

  constructor() {
    effect(() => {
      const open = this.visible();
      untracked(() => {
        if (open && !this.wasVisible) {
          const active = document.activeElement;
          this.opener =
            active instanceof HTMLElement &&
            active !== document.body &&
            !active.closest('.p-dialog')
              ? active
              : this.opener;
        } else if (!open && this.wasVisible) this.restoreFocus();
        this.wasVisible = open;
      });
    });
    // A new set of messages: the summary announces them, focus lands on the first field to fix.
    effect(() => {
      const messages = this.summary();
      if (messages.length === 0 || !this.visible()) return;
      untracked(() => focusFirstInvalid(this.injector, this.dialogRoot()));
    });
  }

  /** The dialog renders in a portal; the form is the root to search for the invalid field. */
  private dialogRoot(): ParentNode {
    return this.form()?.nativeElement ?? this.host.nativeElement;
  }

  /**
   * `DialogFocus` returns focus too, but the leave question ("Stay / Leave") closes at the same moment and takes it to a button that is
   * gone; once every dialog layer is away, a focus that fell to the page body (or to the page's `main`, where the browser puts it after a
   * navigation that only changed the address, the `?edit=` of a Labels dialog) goes back to the opener.
   */
  private restoreFocus(): void {
    let tries = 0;
    const lost = (): boolean => {
      const active = document.activeElement;
      return !active || active === document.body || active.matches('main');
    };
    const settle = (): void => {
      if (document.querySelector('.p-dialog-mask') && tries++ < 40) {
        setTimeout(settle, 50);
        return;
      }
      if (lost() && this.opener?.isConnected) this.opener.focus();
      // The leave question's own focus restore runs a tick after the last mask is gone and may take the focus to <main> (its opener, the
      // Cancel button in this dialog, no longer exists): look once more after it, so the focus ends on the control that opened this dialog.
      setTimeout(() => {
        if (lost() && this.opener?.isConnected) this.opener.focus();
      }, 150);
    };
    setTimeout(settle, 0);
  }

  protected focusFirstField(): void {
    afterNextRender(
      () =>
        this.form()
          ?.nativeElement.querySelector<HTMLElement>(
            'input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)',
          )
          ?.focus(),
      { injector: this.injector },
    );
  }

  protected submit(event?: Event): void {
    event?.preventDefault();
    if (this.saving()) return;
    this.save.emit();
  }

  /** Escape closes the dialog (through the leave question when there are edits), unless that question is itself on screen. */
  protected onEscape(event: Event): void {
    if (!this.visible() || this.leave.open() || event.defaultPrevented) return;
    event.preventDefault();
    void this.request(false);
  }

  /** Every way out (Cancel, Escape, the X) comes here; opening is the page's `visible`. */
  protected async request(open: boolean): Promise<void> {
    if (open) {
      this.visible.set(true);
      return;
    }
    if (this.saving()) return;
    if (this.dirty() && !(await this.leave.ask())) return;
    this.visible.set(false);
    this.cancel.emit();
  }
}
