import { Injectable, inject } from '@angular/core';
import { MessageService, ToastMessageOptions } from 'primeng/api';

/** An identical toast (same severity, summary and detail) is shown again only after this long (BUG-4). */
export const TOAST_DEDUPE_MS = 5000;

export interface ToastOptions {
  /** A toast with the same key replaces the one before it (for example out of office, then "I'm back"). */
  readonly key?: string;
}

interface Live {
  readonly sig: string;
  readonly key: string | undefined;
  readonly message: ToastMessageOptions;
  readonly expiresAt: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Thin toast facade (UX `mf-toast`); the `<p-toast>` host lives in the app root.
 *
 * A toast with the same severity, summary and detail as one that is still showing, or that was shown less than five seconds ago,
 * is folded into it instead of stacking (a burst of one failed request used to show the same error two or three times). A toast
 * with a `key` replaces the toast that was shown with the same key.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly messages = inject(MessageService);
  private live: Live[] = [];
  private readonly lastShown = new Map<string, number>();

  success(summary: string, detail?: string, options?: ToastOptions): void {
    this.show('success', summary, detail, 4000, options);
  }

  info(summary: string, detail?: string, options?: ToastOptions): void {
    this.show('info', summary, detail, 4000, options);
  }

  error(summary: string, detail?: string, options?: ToastOptions): void {
    this.show('error', summary, detail, 8000, options);
  }

  private show(
    severity: string,
    summary: string,
    detail: string | undefined,
    life: number,
    options?: ToastOptions,
  ): void {
    const now = Date.now();
    const sig = JSON.stringify([severity, summary, detail ?? '']);
    if (this.live.some((l) => l.sig === sig)) return;
    const last = this.lastShown.get(sig);
    if (last !== undefined && now - last < TOAST_DEDUPE_MS) return;
    for (const [s, at] of this.lastShown) if (now - at >= TOAST_DEDUPE_MS) this.lastShown.delete(s);

    const key = options?.key;
    const replaced = key !== undefined && this.live.some((l) => l.key === key);
    if (replaced) {
      // PrimeNG cannot remove one message: clear them all and show the others again for the time they have left.
      const kept = this.live.filter((l) => l.key !== key);
      for (const l of this.live) clearTimeout(l.timer);
      this.live = [];
      this.messages.clear();
      for (const l of kept) this.track(l.sig, l.key, l.message, l.expiresAt - now);
    }
    this.lastShown.set(sig, now);
    this.track(sig, key, { severity, summary, detail, life }, life);
  }

  private track(
    sig: string,
    key: string | undefined,
    message: ToastMessageOptions,
    life: number,
  ): void {
    if (life <= 0) return;
    const shown: ToastMessageOptions = { ...message, life };
    this.messages.add(shown);
    const timer = setTimeout(() => {
      this.live = this.live.filter((l) => l.timer !== timer);
    }, life);
    this.live.push({ sig, key, message: shown, expiresAt: Date.now() + life, timer });
  }
}
