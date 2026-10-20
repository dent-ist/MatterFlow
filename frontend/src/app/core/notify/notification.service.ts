import { Injectable, signal } from '@angular/core';

/** An identical toast (same severity, summary and detail) is shown again only after this long (BUG-4). */
export const TOAST_DEDUPE_MS = 5000;

export type ToastSeverity = 'success' | 'info' | 'warn' | 'error';

export interface ToastOptions {
  /** A toast with the same key replaces the one before it (for example out of office, then "I'm back"). */
  readonly key?: string;
}

export interface Toast {
  readonly id: number;
  readonly severity: ToastSeverity;
  readonly summary: string;
  readonly detail: string | undefined;
  readonly key: string | undefined;
  /** How many identical messages this toast stands for ("x3"). */
  readonly count: number;
  /** Milliseconds it stays after the last identical message (4 s, errors and warnings 8 s). */
  readonly life: number;
}

const LIFE_MS: Record<ToastSeverity, number> = {
  success: 4000,
  info: 4000,
  warn: 8000,
  error: 8000,
};

/**
 * The toast facade (UX `mf-toast`). It only keeps the list; the one host (`mf-toast-host`, shared/ui) draws it.
 *
 * A toast with the same severity, summary and detail as one that is still showing is folded into it (its count goes up and its
 * time starts again); one that was shown less than five seconds ago and has closed is dropped. A toast with a `key` replaces the
 * toast that was shown with the same key. Pointer or focus on the host holds the countdown (`hold`), leaving restarts it.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly toasts = signal<readonly Toast[]>([]);

  private seq = 0;
  private holding = false;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly lastShown = new Map<string, number>();

  success(summary: string, detail?: string, options?: ToastOptions): void {
    this.show('success', summary, detail, options);
  }

  info(summary: string, detail?: string, options?: ToastOptions): void {
    this.show('info', summary, detail, options);
  }

  warn(summary: string, detail?: string, options?: ToastOptions): void {
    this.show('warn', summary, detail, options);
  }

  error(summary: string, detail?: string, options?: ToastOptions): void {
    this.show('error', summary, detail, options);
  }

  dismiss(id: number): void {
    this.stop(id);
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Pointer or focus is on the toasts: keep them while the person reads or reaches for a button. */
  hold(): void {
    this.holding = true;
    for (const id of [...this.timers.keys()]) this.stop(id);
  }

  release(): void {
    this.holding = false;
    for (const t of this.toasts()) this.start(t);
  }

  private show(
    severity: ToastSeverity,
    summary: string,
    detail: string | undefined,
    options?: ToastOptions,
  ): void {
    const now = Date.now();
    const sig = JSON.stringify([severity, summary, detail ?? '']);
    const same = this.toasts().find((t) => this.signature(t) === sig);
    if (same) {
      const next = { ...same, count: same.count + 1 };
      this.toasts.update((list) => list.map((t) => (t === same ? next : t)));
      this.lastShown.set(sig, now);
      this.start(next);
      return;
    }
    const last = this.lastShown.get(sig);
    if (last !== undefined && now - last < TOAST_DEDUPE_MS) return;
    for (const [s, at] of this.lastShown) if (now - at >= TOAST_DEDUPE_MS) this.lastShown.delete(s);

    const key = options?.key;
    if (key !== undefined) {
      for (const old of this.toasts()) if (old.key === key) this.stop(old.id);
    }
    const toast: Toast = {
      id: ++this.seq,
      severity,
      summary,
      detail,
      key,
      count: 1,
      life: LIFE_MS[severity],
    };
    this.lastShown.set(sig, now);
    this.toasts.update((list) => [
      ...list.filter((t) => key === undefined || t.key !== key),
      toast,
    ]);
    this.start(toast);
  }

  private signature(t: Toast): string {
    return JSON.stringify([t.severity, t.summary, t.detail ?? '']);
  }

  private start(toast: Toast): void {
    this.stop(toast.id);
    if (this.holding) return;
    this.timers.set(
      toast.id,
      setTimeout(() => this.dismiss(toast.id), toast.life),
    );
  }

  private stop(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
  }
}
