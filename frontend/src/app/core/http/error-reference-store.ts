import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Hands the reference id of the latest failed page load to the inline error alert (UXR-18). The HTTP layer reports a
 * server fault of a GET here and holds the toast back for a moment; an alert that shows `<mf-error-reference />` claims the
 * error, so the reference appears once, inside the alert (copyable), and is not repeated as an auto-dismissing toast.
 * D-52 (#1223): every failed GET is held back this way, and the toast is dropped as well when the page shows its own inline "Couldn't load ..." block
 * (a state block, an alert line): one message per failure. A GET with no inline block anywhere still gets the toast.
 */
@Injectable({ providedIn: 'root' })
export class ErrorReferenceStore {
  readonly reference = signal<string | undefined>(undefined);
  private readonly doc = inject(DOCUMENT);
  private readonly pending = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    // A held toast never fires into an injector that is already gone (the app was torn down, or a test ended).
    inject(DestroyRef).onDestroy(() => this.claim());
  }

  /** Remember `reference` and run `showToast` after `delayMs` unless an inline alert claims the error first. */
  report(reference: string | undefined, showToast: () => void, delayMs = 400): void {
    this.reference.set(reference);
    const timer = setTimeout(() => {
      this.pending.delete(timer);
      if (!this.inlineErrorShown()) showToast();
    }, delayMs);
    this.pending.add(timer);
  }

  /** True while the page shows its own load-error block (an alert or state block that says "Couldn't load ..." or "Couldn't refresh ..."). */
  inlineErrorShown(): boolean {
    return Array.from(this.doc.querySelectorAll('[role="alert"], [data-state-block="error"]')).some(
      (el) => /couldn.t (load|refresh)/i.test(el.textContent ?? ''),
    );
  }

  /** An inline alert is showing the error: drop the held toast(s). */
  claim(): void {
    for (const timer of this.pending) clearTimeout(timer);
    this.pending.clear();
  }
}
