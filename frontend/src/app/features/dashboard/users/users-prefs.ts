import { Injectable, inject, signal } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import { Layout, TabView, UserSort, isLayout, isTabView, isUserSort } from './users-model';

const PREFIX = 'mf.dashboard.users.v1.';

interface Stored {
  sort: UserSort;
  layout: Layout;
  view: TabView;
}

const FALLBACK: Stored = {
  sort: 'load',
  layout: 'cards',
  view: 'workload',
};

/**
 * What the Users tab remembers per user in this browser: the sort, cards or table, and Workload or Coverage. The filters (pod, availability, name)
 * live in the address instead, so a plain Users link never opens a silently filtered board. Storage may be unavailable (private window,
 * site data cleared): every access is wrapped and the tab works without it.
 */
@Injectable({ providedIn: 'root' })
export class UsersPrefs {
  private readonly auth = inject(AuthStore);
  private loadedFor: number | null = null;
  private stored: Stored = FALLBACK;

  readonly sort = signal<UserSort>(FALLBACK.sort);
  readonly layout = signal<Layout>(FALLBACK.layout);
  readonly view = signal<TabView>(FALLBACK.view);

  /** Reads the saved choices of the signed-in user (once per user). */
  ensureLoaded(): Stored {
    const userId = this.auth.profile()?.userId ?? 0;
    if (this.loadedFor !== userId) {
      this.loadedFor = userId;
      this.stored = this.read(userId);
      this.sort.set(this.stored.sort);
      this.layout.set(this.stored.layout);
      this.view.set(this.stored.view);
    }
    return this.stored;
  }

  remember(choice: Partial<Stored>): void {
    this.ensureLoaded();
    this.stored = { ...this.stored, ...choice };
    if (choice.sort) this.sort.set(choice.sort);
    if (choice.layout) this.layout.set(choice.layout);
    if (choice.view) this.view.set(choice.view);
    this.save();
  }

  private read(userId: number): Stored {
    try {
      const raw = localStorage.getItem(PREFIX + userId);
      if (!raw) return FALLBACK;
      const parsed = JSON.parse(raw) as Partial<Stored>;
      return {
        sort: isUserSort(parsed.sort) ? parsed.sort : FALLBACK.sort,
        // A saved mode that no longer exists (the old tile sizes) falls back to the table, never an error.
        layout: isLayout(parsed.layout) ? parsed.layout : 'table',
        view: isTabView(parsed.view) ? parsed.view : FALLBACK.view,
      };
    } catch {
      return FALLBACK;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(PREFIX + (this.loadedFor ?? 0), JSON.stringify(this.stored));
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }
}
