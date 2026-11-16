import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatterLookupClient } from '../../api/generated/api-client';

/** The state of the Matter Lookup integration for the Lookup button (`GET /matter-lookup/status`). `unknown` until the first answer. */
export type LookupState = 'unknown' | 'READY' | 'NOT_SET_UP' | 'DISABLED' | 'FAILED';

/** What a Lookup call came back with. `failed` is "the call did not work now" (no answer, error, or the status said it is not available any more). */
export type LookupAnswer =
  | {
      kind: 'found';
      clientNumber?: string;
      clientName?: string;
      matterNumber?: string;
      matterName?: string;
    }
  | { kind: 'not-found' }
  | { kind: 'failed' };

/**
 * The Lookup button of New Client and New Matter (#1395). One place that knows the state of the Matter Lookup integration and runs a lookup. A form calls `refresh()` when it opens; the
 * button reads `state`. Typing by hand always works: nothing here blocks a form, and every failure is a plain answer, never an exception.
 */
@Injectable({ providedIn: 'root' })
export class MatterLookup {
  private readonly api = inject(MatterLookupClient);
  readonly state = signal<LookupState>('unknown');

  async refresh(): Promise<void> {
    try {
      const status = await firstValueFrom(this.api.getMatterLookupStatus());
      const s = status.state;
      this.state.set(
        s === 'READY' || s === 'NOT_SET_UP' || s === 'DISABLED' || s === 'FAILED' ? s : 'FAILED',
      );
    } catch {
      // The status could not be read: the button stays off rather than promising a lookup.
      this.state.set('FAILED');
    }
  }

  /** A client (client number only) or a matter (client number and matter number). */
  async search(clientNumber: string, matterNumber?: string): Promise<LookupAnswer> {
    try {
      const r = await firstValueFrom(
        this.api.searchMatterLookup({ clientNumber, matterNumber: matterNumber || undefined }),
      );
      if (r.outcome === 'FOUND')
        return {
          kind: 'found',
          clientNumber: r.clientNumber,
          clientName: r.clientName,
          matterNumber: r.matterNumber,
          matterName: r.matterName,
        };
      if (r.outcome === 'NOT_FOUND') return { kind: 'not-found' };
      return { kind: 'failed' };
    } catch {
      return { kind: 'failed' };
    }
  }
}
