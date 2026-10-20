import { Injectable, signal } from '@angular/core';

/** How long the Undo toast stays (product owner decision on UXR-26). */
export const UNDO_LIFE_MS = 8000;

export interface UndoOffer {
  /** Changes with every offer, so the toast can tell a new offer from the same one. */
  readonly id: number;
  readonly message: string;
  readonly undo: () => Promise<void>;
  /** Kept so callers compile; the one toast host (`mf-toast-host`) is always bottom right (#616 reverses the bottom-left placement of decision T #158). */
  readonly placement: 'end' | 'start';
}

/**
 * One Undo toast at a time ("PQ-1042 priority set to Low. Undo"). A new offer replaces the old one. The offer lives outside
 * the component that made it, so it still works after a table row has been redrawn. The one toast host (`mf-toast-host`) shows it
 * in a polite live region. Pointer or focus on the toast pauses the countdown, and leaving restarts the full time.
 */
@Injectable({ providedIn: 'root' })
export class UndoService {
  readonly current = signal<UndoOffer | null>(null);
  readonly working = signal(false);
  /** Counts finished Undo runs, so a screen whose row no longer exists (for example a list that dropped it) can read its data again. */
  readonly settled = signal(0);
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  offer(
    message: string,
    undo: () => Promise<void>,
    options: { placement?: 'end' | 'start' } = {},
  ): void {
    this.working.set(false);
    this.current.set({ id: ++this.seq, message, undo, placement: options.placement ?? 'end' });
    this.start();
  }

  dismiss(): void {
    this.stop();
    this.working.set(false);
    this.current.set(null);
  }

  /** Pointer or focus is on the toast: keep it. */
  hold(): void {
    this.stop();
  }

  release(): void {
    if (this.current() && !this.working()) this.start();
  }

  /** Runs the undo and closes the toast. The undo reports its own result (success or the reason it failed). */
  async run(): Promise<void> {
    const offer = this.current();
    if (!offer || this.working()) return;
    this.stop();
    this.working.set(true);
    try {
      await offer.undo();
    } finally {
      if (this.current()?.id === offer.id) this.dismiss();
      this.settled.update((n) => n + 1);
    }
  }

  private start(): void {
    this.stop();
    this.timer = setTimeout(() => this.dismiss(), UNDO_LIFE_MS);
  }

  private stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
