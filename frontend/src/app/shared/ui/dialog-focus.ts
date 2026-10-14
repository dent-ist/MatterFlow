import { DestroyRef, Directive, effect, inject, input, untracked } from '@angular/core';

/**
 * Shared accessibility behavior for PrimeNG dialogs (UAT2-03, UAT2-06). Put it on `<p-dialog [mfDialogFocus]="visible">`:
 *
 * - when the dialog opens, the element that had focus (the control that opened it) is remembered;
 * - when it closes (Escape, the X, Cancel, Confirm), focus returns to that control, or to the main area when it is gone;
 * - the dialog's hidden focus-trap sentinels lose `aria-hidden` (they are focusable, which axe reports as aria-hidden-focus).
 */
@Directive({ selector: '[mfDialogFocus]' })
export class DialogFocus {
  /** True while the dialog is open. */
  readonly open = input<boolean | null | undefined>(false, { alias: 'mfDialogFocus' });

  private trigger: HTMLElement | null = null;
  private wasOpen = false;
  private observer: MutationObserver | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
    effect(() => {
      const isOpen = !!this.open();
      untracked(() => (isOpen ? this.opened() : this.closed()));
    });
  }

  private opened(): void {
    if (this.wasOpen) return;
    this.wasOpen = true;
    const active = document.activeElement;
    this.trigger = active instanceof HTMLElement && active !== document.body ? active : null;
    this.observer?.disconnect();
    // The dialog renders in a portal (document.body), so watch there for the sentinels PrimeNG adds.
    this.observer = new MutationObserver(() => this.cleanSentinels());
    this.observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => this.cleanSentinels(), 0);
  }

  private closed(): void {
    if (!this.wasOpen) return;
    this.wasOpen = false;
    const trigger = this.trigger;
    this.trigger = null;
    setTimeout(() => {
      this.observer?.disconnect();
      this.observer = null;
      // The page may already have moved focus on purpose (for example to the step a dialog link pointed at): leave that alone.
      const active = document.activeElement;
      if (active && active !== document.body && !active.closest('.p-dialog-mask')) return;
      const target =
        trigger && trigger.isConnected && !trigger.hasAttribute('disabled')
          ? trigger
          : document.querySelector<HTMLElement>('main h1, main');
      if (!target) return;
      if (!target.matches('a, button, input, select, textarea, [tabindex]')) {
        target.setAttribute('tabindex', '-1');
      }
      target.focus({ preventScroll: true });
    }, 0);
  }

  private cleanSentinels(): void {
    if (typeof document === 'undefined') return;
    document
      .querySelectorAll('.p-dialog-mask .p-hidden-focusable[aria-hidden]')
      .forEach((el) => el.removeAttribute('aria-hidden'));
  }
}
