import { Injectable, signal } from '@angular/core';

/**
 * Hands the reference id of the latest failed page load to the inline error alert (UXR-18). The HTTP layer reports a
 * server fault of a GET here and holds the toast back for a moment; an alert that shows `<mf-error-reference />` claims the
 * error, so the reference appears once, inside the alert (copyable), and is not repeated as an auto-dismissing toast.
 * Pages without such an alert still get the toast.
 */
@Injectable({ providedIn: 'root' })
export class ErrorReferenceStore {
  readonly reference = signal<string | undefined>(undefined);
  private readonly pending = new Set<ReturnType<typeof setTimeout>>();

  /** Remember `reference` and run `showToast` after `delayMs` unless an inline alert claims the error first. */
  report(reference: string | undefined, showToast: () => void, delayMs = 400): void {
    this.reference.set(reference);
    const timer = setTimeout(() => {
      this.pending.delete(timer);
      showToast();
    }, delayMs);
    this.pending.add(timer);
  }

  /** An inline alert is showing the error: drop the held toast(s). */
  claim(): void {
    for (const timer of this.pending) clearTimeout(timer);
    this.pending.clear();
  }
}
