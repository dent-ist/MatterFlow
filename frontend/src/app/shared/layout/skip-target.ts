import { Injectable, signal } from '@angular/core';

export interface SkipTargetDef {
  /** The link text ("Skip to task list"). */
  label: string;
  /** Moves focus to where the page's main content begins. */
  focus: () => void;
}

/**
 * A page's own first Tab stop (#181): the work pages offer "Skip to task list" ahead of "Skip to main content", and it moves focus to
 * the first row. The shell shows the link only while a page has registered a target.
 */
@Injectable({ providedIn: 'root' })
export class SkipTarget {
  private readonly current = signal<SkipTargetDef | null>(null);
  readonly target = this.current.asReadonly();

  /** Offers the link until the returned function is called. */
  register(def: SkipTargetDef): () => void {
    this.current.set(def);
    return () => this.current.update((c) => (c === def ? null : c));
  }
}
