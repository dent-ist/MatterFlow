import { signal } from '@angular/core';

/** How long a row that left its tab (cancelled or completed from the row) stays on screen in its new state (BUG-9, product decision). */
export const LEAVE_DELAY_MS = 4000;
/** While the person works with the row (its menu is open) removal waits; this is how often it looks again. */
const RETRY_MS = 300;

/**
 * Rows that no longer belong in the tab they are shown in, waiting to be removed: a row stays for `LEAVE_DELAY_MS` so the person
 * sees the result next to the toast, then `remove` is called with its task id. Removal is held while `busy` says the person is
 * using the row (an inline menu of that row is open), and happens as soon as they are done. The page owns what removal means.
 */
export class RowLeaving {
  /** Task ids shown in their new state, for the table to mute. */
  readonly ids = signal<ReadonlySet<number>>(new Set());
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly remove: (taskId: number) => void,
    private readonly busy: (taskId: number) => boolean,
    private readonly delay = LEAVE_DELAY_MS,
  ) {}

  /** The row left the tab: starts the countdown (once per row). */
  start(taskId: number, onStart?: () => void): void {
    if (this.timers.has(taskId)) return;
    this.ids.update((set) => new Set(set).add(taskId));
    this.timers.set(
      taskId,
      setTimeout(() => this.tryRemove(taskId), this.delay),
    );
    onStart?.();
  }

  /** The row is back in the tab (the change was reverted): it stays. */
  cancel(taskId: number): void {
    const timer = this.timers.get(taskId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(taskId);
    this.ids.update((set) => {
      const next = new Set(set);
      next.delete(taskId);
      return next;
    });
  }

  /** Forgets every pending row (the list was loaded again, or the page goes away). */
  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.ids().size > 0) this.ids.set(new Set());
  }

  private tryRemove(taskId: number): void {
    if (!this.timers.has(taskId)) return;
    if (this.busy(taskId)) {
      this.timers.set(
        taskId,
        setTimeout(() => this.tryRemove(taskId), RETRY_MS),
      );
      return;
    }
    this.timers.delete(taskId);
    this.ids.update((set) => {
      const next = new Set(set);
      next.delete(taskId);
      return next;
    });
    this.remove(taskId);
  }
}
