import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';

/** Browser storage key prefix of the remembered height choice (#1342); the person's id (or `anon`) follows. */
export const NOTES_HEIGHT_KEY = 'mf.notes.height.v1.';

/**
 * Matter > Notes height toggle (#1342, D-46a): "folded" hides the matter header's breadcrumb and title row so the Notes card uses the whole height under the top
 * bar. The choice is remembered per person in browser storage (`1` = folded, the entry is removed when off, anything else = off). Every storage access is guarded:
 * blocked storage means the toggle works for the visit and starts off after a reload. The matter page (header, skeleton) and the Notes tab read the same state.
 */
@Injectable({ providedIn: 'root' })
export class NotesHeightPref {
  private readonly auth = inject(AuthStore);
  /** The storage key of the signed-in person. */
  readonly key = computed(() => NOTES_HEIGHT_KEY + (this.auth.profile()?.userId || 'anon'));
  private readonly rev = signal(0);
  /** The choice made in this visit; wins over storage so a blocked storage still honours the click. */
  private readonly session = signal<{ key: string; value: boolean } | null>(null);

  /** True while the matter header is folded (when the Notes tab is showing). */
  readonly folded = computed(() => {
    this.rev();
    const key = this.key();
    const s = this.session();
    if (s && s.key === key) return s.value;
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  /** Reads storage again (the Notes tab calls it when it is created); keeps this visit's choice only when storage cannot be read. */
  refresh(): void {
    try {
      localStorage.getItem(this.key());
      this.session.set(null);
    } catch {
      // Storage is blocked: keep what was chosen in this visit.
    }
    this.rev.update((n) => n + 1);
  }

  toggle(): void {
    const key = this.key();
    const next = !this.folded();
    this.session.set({ key, value: next });
    try {
      if (next) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch {
      // The choice is a convenience.
    }
  }
}
