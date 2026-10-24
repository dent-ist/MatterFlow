import { Injectable, computed, inject } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';

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
 *   - the default is `mine`; `all` is offered, and accepted from storage or from an address, only with `Matter.AssignManagers`;
 *   - the choice is remembered per page and per person in the browser (a convenience: storage may be blocked, the page works without it).
 * "My matters" is a default view, never access control: opening a record outside the scope by link works.
 */
@Injectable({ providedIn: 'root' })
export class ScopeService {
  private readonly auth = inject(AuthStore);

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

  /** What a plain link to the page opens on: the remembered choice, else `mine`; null when the switch does not apply. */
  defaultFor(pageKey: string): Scope | null {
    return this.eligible() ? (this.remembered(pageKey) ?? 'mine') : null;
  }

  remember(pageKey: string, scope: Scope): void {
    try {
      storage()?.setItem(this.key(pageKey), scope);
    } catch {
      // Not remembering is fine.
    }
  }
}
