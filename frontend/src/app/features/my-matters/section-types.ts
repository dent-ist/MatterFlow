import { Injectable, Injector, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TaskTypesClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionReset } from '../../core/session/session-reset';

/** A task type as the My Matters section toolbars offer it: the badge fields and the name. */
export interface TypeOption {
  readonly id: number;
  readonly name: string;
  readonly iconKey: string;
  readonly colourKey: string | undefined;
  readonly active: boolean;
}

/**
 * The task types the section toolbars filter by (PM v2 #857), read once per person and role set (Task Type access rule, epic #1397: only the types the person may see) when a toolbar first asks for them and only with
 * `Task.View` (a My Matters person has it anyway). A failure leaves the list empty: the toolbar then offers no choices, but a type in the
 * address or in the remembered state still filters.
 */
@Injectable({ providedIn: 'root' })
export class SectionTypes {
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthStore);
  readonly options = signal<readonly TypeOption[]>([]);
  private started = false;
  private loadedFor = '';

  constructor() {
    // Another person behind the page starts from nothing.
    inject(SessionReset).register(() => {
      this.started = false;
      this.loadedFor = '';
      this.options.set([]);
    });
  }

  /** The person and the roles the list belongs to: a role change shows in /me, so the next toolbar that asks reads the types again. */
  private cacheKey(): string {
    const p = this.auth.profile();
    return p ? `${p.userId}|${p.isSystemAdmin}|${[...p.roles].sort().join(',')}` : '';
  }

  ensure(): void {
    const key = this.cacheKey();
    if ((this.started && this.loadedFor === key) || !this.auth.has('Task.View')) return;
    this.started = true;
    this.loadedFor = key;
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const api = this.injector.get(TaskTypesClient);
      const types = await firstValueFrom(api.listTaskTypes(undefined, undefined, true));
      this.options.set(
        types
          .map((t) => ({
            id: t.id,
            name: t.name,
            iconKey: t.iconKey,
            colourKey: t.colourKey,
            active: t.isActive,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch {
      // The toolbar works without the choices.
    }
  }
}
