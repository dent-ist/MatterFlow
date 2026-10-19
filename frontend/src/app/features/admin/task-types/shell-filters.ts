import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { ListFilters } from '../../../shared/filters/list-filters';

/** What the open tab hands to the page header: its filters and the id of its filter row (the button's `aria-controls`). */
export interface ShellFilters {
  readonly filters: ListFilters;
  readonly controls: string;
}

/**
 * The Filters button of the Task Types page sits in the page header (#365, the Clients rule) while the filters belong to the open tab
 * (each tab has its own definitions and its own remembered open state). The page provides this registry; a tab calls `register` in its
 * constructor and the page draws `mf-list-filters-button` for whatever is registered. A tab used without the page (a unit test) finds no
 * registry and simply has no header button.
 */
@Injectable()
export class AdminShellFilters {
  readonly current = signal<ShellFilters | null>(null);

  /** Registers the tab's filters for as long as the calling component lives; call in an injection context. */
  static register(entry: ShellFilters): void {
    const shell = inject(AdminShellFilters, { optional: true });
    if (!shell) return;
    shell.current.set(entry);
    inject(DestroyRef).onDestroy(() => {
      // A tab that was replaced already handed its place to the next one: only clear our own entry.
      if (shell.current() === entry) shell.current.set(null);
    });
  }
}
