import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IdentityAdminApi } from './identity-admin-api';

/** Number of users waiting for access; drives the badge on the Users & roles nav item (S12). */
@Injectable({ providedIn: 'root' })
export class PendingUsersStore {
  private readonly api = inject(IdentityAdminApi, { optional: true });
  private readonly _count = signal(0);
  readonly count = this._count.asReadonly();

  /** Reloads the count; failures leave the previous value (the badge is a convenience). Never rejects. */
  async refresh(): Promise<void> {
    if (!this.api) return;
    try {
      this._count.set((await firstValueFrom(this.api.userCounts())).pending);
    } catch {
      /* keep the last known count */
    }
  }

  /** Lets the users screen publish a count it already knows. */
  set(count: number): void {
    this._count.set(count);
  }
}
