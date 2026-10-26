import { Injectable, Injector, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TaskTypesClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';

/** A task type as the My Matters section toolbars offer it: the badge fields and the name. */
export interface TypeOption {
  readonly id: number;
  readonly name: string;
  readonly iconKey: string;
  readonly colourKey: string | undefined;
  readonly active: boolean;
}

/**
 * The task types the section toolbars filter by (PM v2 #857), read once per session when a toolbar first asks for them and only with
 * `Task.View` (a My Matters person has it anyway). A failure leaves the list empty: the toolbar then offers no choices, but a type in the
 * address or in the remembered state still filters.
 */
@Injectable({ providedIn: 'root' })
export class SectionTypes {
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthStore);
  readonly options = signal<readonly TypeOption[]>([]);
  private started = false;

  ensure(): void {
    if (this.started || !this.auth.has('Task.View')) return;
    this.started = true;
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const api = this.injector.get(TaskTypesClient);
      const types = await firstValueFrom(api.listTaskTypes());
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
