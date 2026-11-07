import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import {
  ClientsClient,
  MattersClient,
  PodsClient,
  RolesClient,
  TaskTypesClient,
  UsersClient,
} from '../../api/generated/api-client';
import { QuietRequests } from '../../core/http/interceptors';

/** What a lookup parameter of a report points at (the server's `lookupKind`). */
export type LookupKind = 'matter' | 'client' | 'user' | 'pod' | 'role' | 'taskType';

/** One record a person can choose for a lookup parameter: its id (what the report takes) and its words. */
export interface LookupRecord {
  readonly id: number;
  readonly label: string;
  /** A second muted line (the client of a matter, the pods of a person); optional. */
  readonly sub?: string;
  readonly inactive?: boolean;
}

/** The kinds a person finds by typing (long lists); the others are short enough to show whole. */
export const SEARCHED_KINDS: ReadonlySet<string> = new Set<LookupKind>([
  'matter',
  'client',
  'user',
]);

/** How many rows a typed search asks for. */
const SEARCH_TAKE = 25;

/**
 * THE one place the Reports pages read records for a lookup parameter (matter, client, user, pod, role, task type). Nothing else in the Reports
 * feature may call another module's lookup endpoint. TODAY it uses the endpoints the rest of the app already has, which need the picker's own
 * permission (`Client.View`, `Matter.View`, `User.View`, `Pod.View`, `Role.Manage`, `TaskType.Manage`...): a person who may run a report but not
 * list those gets a 403, and the lookup control shows its own "Couldn't load <things>." with Retry (owner decision 13 of the Reports review is
 * open). When the reports-owned endpoint `GET /reports/{id}/lookups/{parameter}` exists, only this file changes: `search`, `list` and `labels`
 * call it, and no component needs a change. Every method rejects with the HTTP error (an `ApiError`) when the server refuses.
 */
@Injectable({ providedIn: 'root' })
export class ReportLookupSource {
  private readonly matters = inject(MattersClient);
  private readonly clients = inject(ClientsClient);
  private readonly users = inject(UsersClient);
  private readonly pods = inject(PodsClient);
  private readonly roles = inject(RolesClient);
  private readonly taskTypes = inject(TaskTypesClient);
  private readonly quiet = inject(QuietRequests);

  /** Whether the kind is found by typing (`search`) or shown whole (`list`). */
  isSearched(kind: string | undefined): boolean {
    return !!kind && SEARCHED_KINDS.has(kind);
  }

  /** Active records of a searched kind whose words contain the text (the first rows when the text is empty). */
  async search(kind: LookupKind, text: string): Promise<LookupRecord[]> {
    const q = text.trim() || undefined;
    switch (kind) {
      case 'matter': {
        const page = await this.call(() =>
          this.matters.listMatters(
            q,
            undefined,
            true,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            1,
            SEARCH_TAKE,
            undefined,
          ),
        );
        return page.items.map((m) => ({
          id: m.matterId,
          label: `${m.matterRef} ${m.name}`,
          sub: m.clientName,
        }));
      }
      case 'client': {
        const page = await this.call(() =>
          this.clients.listClients(
            q,
            true,
            undefined,
            undefined,
            undefined,
            undefined,
            1,
            SEARCH_TAKE,
            undefined,
          ),
        );
        return page.items.map((c) => ({ id: c.clientId, label: `${c.clientNumber} ${c.name}` }));
      }
      case 'user': {
        const page = await this.call(() =>
          this.users.listUsers(
            'active',
            q,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            1,
            SEARCH_TAKE,
          ),
        );
        return page.items.map((u) => ({
          id: u.userId,
          label: u.displayName,
          sub: u.pods.map((p) => p.name).join(', ') || undefined,
        }));
      }
      default:
        return this.list(kind);
    }
  }

  /** Every record of a short kind (pods, roles, task types), active ones only, by name. */
  async list(kind: LookupKind): Promise<LookupRecord[]> {
    switch (kind) {
      case 'pod': {
        const page = await this.call(() =>
          this.pods.listPods(undefined, undefined, true, 1, 100, 'name'),
        );
        return page.items.map((p) => ({ id: p.podId, label: p.name }));
      }
      case 'role': {
        const roles = await this.call(() => this.roles.listRoles());
        return roles.map((r) => ({ id: r.roleId, label: r.name }));
      }
      case 'taskType': {
        const types = await this.call(() => this.taskTypes.listTaskTypes());
        return types.filter((t) => t.isActive).map((t) => ({ id: t.id, label: t.name }));
      }
      default:
        return this.search(kind, '');
    }
  }

  /** The words of records the form already holds by id (an address or a default carries ids only). Unknown ids are left out. */
  async labels(kind: LookupKind, ids: readonly number[]): Promise<LookupRecord[]> {
    if (ids.length === 0) return [];
    switch (kind) {
      case 'matter':
        return this.each(ids, async (id) => {
          const m = await this.call(() => this.matters.getMatter(id));
          return { id, label: `${m.matterRef} ${m.name}`, sub: m.clientName };
        });
      case 'client':
        return this.each(ids, async (id) => {
          const c = await this.call(() => this.clients.getClient(id));
          return { id, label: `${c.clientNumber} ${c.name}` };
        });
      case 'user':
        return this.each(ids, async (id) => {
          const u = await this.call(() => this.users.getUser(id));
          return { id, label: u.displayName };
        });
      default: {
        const all = await this.list(kind);
        return all.filter((r) => ids.includes(r.id));
      }
    }
  }

  /** A failed read is shown by the control itself, never as a second toast. */
  private call<T>(start: () => Observable<T>): Promise<T> {
    // The request must start inside `run` (firstValueFrom subscribes at once), or the interceptor would still toast.
    return this.quiet.run(() => firstValueFrom(start()));
  }

  private async each(
    ids: readonly number[],
    one: (id: number) => Promise<LookupRecord>,
  ): Promise<LookupRecord[]> {
    // A record that cannot be read (deleted, or the person may not open it) keeps its id as its words instead of failing the whole control.
    const settled = await Promise.allSettled(ids.map(one));
    return settled.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { id: ids[i], label: `#${ids[i]}` },
    );
  }
}
