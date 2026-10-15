import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { UndoService } from '../../core/notify/undo.service';

/**
 * Host of the Undo toast. The live region is always in the page, so a screen reader announces the message when it appears.
 * The Undo button is a normal button; focus is not moved, so typing and menu use are not interrupted.
 */
@Component({
  selector: 'mf-undo-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ut" role="status" aria-live="polite" aria-atomic="true">
      @if (undo.current(); as offer) {
        <div
          class="ut__box"
          data-undo-toast
          (mouseenter)="undo.hold()"
          (mouseleave)="undo.release()"
          (focusin)="undo.hold()"
          (focusout)="undo.release()"
        >
          <span class="ut__msg" data-undo-message>{{ offer.message }}</span>
          <button
            type="button"
            class="mf-btn mf-btn--text"
            data-undo
            aria-keyshortcuts="Alt+Z"
            title="Undo (Alt+Z)"
            [disabled]="undo.working()"
            (click)="undo.run()"
          >
            Undo
          </button>
          <button
            type="button"
            class="mf-btn mf-btn--icon"
            data-undo-dismiss
            aria-label="Dismiss"
            (click)="undo.dismiss()"
          >
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .ut {
      position: fixed;
      /* Same corner as the success and error toasts (UXR2-13); it no longer covers the sidebar footer. */
      right: var(--mf-s4);
      bottom: var(--mf-s4);
      z-index: 1200;
      max-width: min(32rem, calc(100vw - 2 * var(--mf-s4)));
    }
    .ut__box {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-1);
    }
    .ut__msg {
      flex: 1;
    }
  `,
})
export class UndoToast {
  protected readonly undo = inject(UndoService);

  /** Alt+Z undoes the change in the toast, so a keyboard user does not have to tab to the end of the page to reach the button. */
  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyZ') {
      if (!this.undo.current() || this.undo.working()) return;
      event.preventDefault();
      void this.undo.run();
    }
  }
}
