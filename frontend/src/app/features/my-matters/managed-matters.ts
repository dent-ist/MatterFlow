import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatterResponse, MattersClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { QuietRequests } from '../../core/http/interceptors';

/** How many of the person's matters are read; more than this is treated as "several of everything" (a manager of 100 matters has clients and roles). */
const READ_MAX = 100;

/**
 * The active matters the signed-in person manages (primary or secondary), read once for the whole My Matters page (issue #904 and #906, epic #893).
 * Three things on the page depend on it: the filter bar (Client is offered only when the matters belong to two or more clients, Role only when the
 * person is Primary on some and Secondary on others), the create-task button (one matter: the shell button opens Create task with it filled in) and
 * the list "New task for" menu. A failed read answers "unknown", and unknown means the controls stay as they were (nothing is hidden on a guess).
 */
@Injectable()
export class ManagedMatters {
  private readonly api = inject(MattersClient);
  private readonly auth = inject(AuthStore);
  private readonly quiet = inject(QuietRequests);

  readonly items = signal<MatterResponse[]>([]);
  readonly total = signal(0);
  /** `loading` until the first answer, `error` when it failed. */
  readonly state = signal<'loading' | 'ready' | 'error'>('loading');

  /** The whole list was read (a person with more than {@link READ_MAX} matters has a partial list, and then nothing is concluded from it). */
  readonly complete = computed(
    () => this.state() === 'ready' && this.total() <= this.items().length,
  );

  /** The one matter, when the person manages exactly one. */
  readonly only = computed<MatterResponse | null>(() =>
    this.complete() && this.items().length === 1 ? this.items()[0] : null,
  );

  /** Two or more clients among the matters (true when not known, so the Client filter is never hidden by mistake). */
  readonly severalClients = computed(
    () => !this.complete() || new Set(this.items().map((m) => m.clientId)).size > 1,
  );

  /** Primary on some matters and Secondary on others (true when not known). */
  readonly mixedRoles = computed(() => {
    if (!this.complete()) return true;
    const me = this.auth.profile()?.userId ?? 0;
    const primary = this.items().some((m) => m.primaryManager?.userId === me);
    const secondary = this.items().some(
      (m) => m.secondaryManager?.userId === me && m.primaryManager?.userId !== me,
    );
    return primary && secondary;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const page = await this.quiet.run(() =>
        firstValueFrom(
          this.api.listMatters(
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
            1,
            READ_MAX,
            undefined,
          ),
        ),
      );
      this.items.set(page.items);
      this.total.set(page.total);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }
}
