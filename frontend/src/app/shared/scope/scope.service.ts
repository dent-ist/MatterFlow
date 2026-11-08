import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../core/auth/auth.store';
import { QuietRequests } from '../../core/http/interceptors';

/** The two scopes of a list for a project manager: the matters they manage, or all of them. */
export type Scope = 'mine' | 'all';

/** The starter role whose members count as project managers even when they are also System Admin (same rule as the landing page). */
const PROJECT_MANAGER_ROLE = 'Project Manager';

export function isScope(value: string | null | undefined): value is Scope {
  return value === 'mine' || value === 'all';
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The rules behind the "My matters / All" switch (epic #758, README 3), kept in one place so every list means the same:
 *   - the switch exists only for people who can be a matter's project manager (`Matter.BeManager`); everybody else sees exactly what they
 *     saw before. A System Admin holds every permission implicitly, so they count only when they are explicitly a Project Manager (the role
 *     is on their profile), the rule of `landsOnMyMatters`; otherwise the administrator would meet a list of nothing;
 *   - the default is `mine` for a person who manages at least one matter, and `all` for one who manages none (a Director who is not a
 *     project manager of anything would otherwise open five empty lists; epic #1330, #1334); a person who may not choose All stays on `mine`;
 *     `all` is offered, and accepted from storage or from an address, only with `Matter.AssignManagers`;
 *   - the choice is remembered per page and per person in the browser (a convenience: storage may be blocked, the page works without it).
 * "My matters" is a default view, never access control: opening a record outside the scope by link works.
 */
@Injectable({ providedIn: 'root' })
export class ScopeService {
  private readonly auth = inject(AuthStore);
  private readonly injector = inject(Injector);
  private readonly quiet = inject(QuietRequests);

  /** Whether the person manages at least one active matter: null until it has been read (or when the read failed: then the old default, `mine`, stays). */
  private readonly read_ = signal<{ userId: number; value: boolean } | null>(null);
  private reading: Promise<void> | null = null;
  readonly managesMatters = computed(() => {
    const read = this.read_();
    return read && read.userId === (this.auth.profile()?.userId ?? 0) ? read.value : null;
  });

  /** The person can be a project manager: the switch and the default scope apply. */
  readonly eligible = computed(
    () =>
      this.auth.has('Matter.BeManager') &&
      (!this.auth.isSystemAdmin() ||
        (this.auth.profile()?.roles ?? []).includes(PROJECT_MANAGER_ROLE)),
  );

  /** "All" is offered: the permission that can already change managers. */
  readonly canAll = computed(() => this.eligible() && this.auth.has('Matter.AssignManagers'));

  /** A scope as this person may use it: an `all` without the permission is `mine`; nothing at all (null) when the switch does not apply. */
  clamp(scope: Scope | null): Scope | null {
    if (!this.eligible()) return null;
    return scope === 'all' && !this.canAll() ? 'mine' : (scope ?? 'mine');
  }

  private key(pageKey: string): string {
    return `mf.scope.${pageKey}.${this.auth.profile()?.userId ?? 0}`;
  }

  /** The scope this person last chose on the page, or null (never chosen, storage blocked, or `all` without the permission any more). */
  remembered(pageKey: string): Scope | null {
    try {
      const value = storage()?.getItem(this.key(pageKey));
      if (!isScope(value)) return null;
      return value === 'all' && !this.canAll() ? null : value;
    } catch {
      return null;
    }
  }

  /**
   * What a plain link to the page opens on: the remembered choice (it always wins), else `mine` for a person who manages a matter, else `all`
   * for one who manages none and may choose All; null when the switch does not apply. Unknown (not read yet, read failed) counts as managing:
   * the list then opens as it always did.
   */
  defaultFor(pageKey: string): Scope | null {
    if (!this.eligible()) return null;
    const remembered = this.remembered(pageKey);
    if (remembered) return remembered;
    return this.managesMatters() === false && this.canAll() ? 'all' : 'mine';
  }

  /**
   * Reads once whether the person manages a matter (the default scope depends on it), for a person the switch applies to; everybody else is
   * not asked. Never rejects. The root guard waits for it, so a list knows its default scope before it asks for its first page.
   */
  ensureKnown(): Promise<void> {
    if (!this.eligible() || this.managesMatters() !== null) return Promise.resolve();
    this.reading ??= this.read().finally(() => (this.reading = null));
    return this.reading;
  }

  private async read(): Promise<void> {
    const userId = this.auth.profile()?.userId ?? 0;
    try {
      // Loaded when needed: the generated client is large and the root guard (initial bundle) must not carry it.
      const { MattersClient } = await import('../../api/generated/api-client');
      const api = this.injector.get(MattersClient);
      const page = await this.quiet.run(() =>
        firstValueFrom(
          // Active matters the person manages, one row: only the total counts.
          api.listMatters(
            undefined,
            undefined,
            true,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            true,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            1,
            1,
            undefined,
          ),
        ),
      );
      this.read_.set({ userId, value: page.total > 0 });
    } catch {
      // Unknown: the default stays `mine`, as before.
    }
  }

  remember(pageKey: string, scope: Scope): void {
    try {
      storage()?.setItem(this.key(pageKey), scope);
    } catch {
      // Not remembering is fine.
    }
  }
}
