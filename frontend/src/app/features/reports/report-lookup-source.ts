import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ReportChoicesClient } from '../../api/generated/api-client';
import { QuietRequests } from '../../core/http/interceptors';

/** What a lookup parameter of a report points at (the server's `lookupKind`). */
export type LookupKind = 'matter' | 'client' | 'user' | 'pod' | 'role' | 'taskType';

/** One record a person can choose for a lookup parameter: its id (what the report takes) and its words. */
export interface LookupRecord {
  readonly id: number;
  readonly label: string;
  readonly inactive?: boolean;
}

/** Which parameter of which report a lookup belongs to: the server decides the kind and the access from the report, not from the caller. */
export interface LookupTarget {
  readonly reportId: number;
  /** The parameter's name as the report defines it. */
  readonly parameter: string;
}

/** The kinds a person finds by typing (long lists); the others are short enough to show whole. */
export const SEARCHED_KINDS: ReadonlySet<string> = new Set<LookupKind>([
  'matter',
  'client',
  'user',
]);

/** How many rows a typed search asks for. */
const SEARCH_TAKE = 25;
/** The short kinds (pods, roles, task types) come in one call; the server allows 50 at most. */
const LIST_TAKE = 50;
/** The server resolves at most 200 ids per call. */
const IDS_PER_CALL = 200;

/**
 * THE one place the Reports pages read records for a lookup parameter (matter, client, user, pod, role, task type). It uses the reports-owned
 * endpoint `GET /reports/{id}/lookups/{parameter}?q=&take=&ids=` (owner decision 13): the person needs `Report.Run` and the report assigned to a
 * role, and nothing else (no `Client.View`, `Matter.View`...). The answer is `{id, label}` only; sensitive matters are never in it, searched or
 * resolved. There is no second line any more. Nothing else in the Reports feature may call another module's lookup endpoint. Every method rejects
 * with the HTTP error (an `ApiError`) when the server refuses; the control shows its own message.
 */
@Injectable({ providedIn: 'root' })
export class ReportLookupSource {
  private readonly api = inject(ReportChoicesClient);
  private readonly quiet = inject(QuietRequests);

  /** Whether the kind is found by typing (`search`) or shown whole (`list`). */
  isSearched(kind: string | undefined): boolean {
    return !!kind && SEARCHED_KINDS.has(kind);
  }

  /** Active records whose words contain the text (the first rows when the text is empty), by label. */
  async search(target: LookupTarget, text: string): Promise<LookupRecord[]> {
    const q = text.trim() || undefined;
    return this.read(target, q, SEARCH_TAKE);
  }

  /** Every record of a short kind (pods, roles, task types), active ones only, by name. */
  async list(target: LookupTarget): Promise<LookupRecord[]> {
    return this.read(target, undefined, LIST_TAKE);
  }

  /**
   * The words of records the form already holds by id (an address or a default carries ids only). The server answers for the ids it knows, active or
   * not; an unknown id (or a sensitive matter) is simply missing from the answer.
   */
  async labels(target: LookupTarget, ids: readonly number[]): Promise<LookupRecord[]> {
    const wanted = [...new Set(ids)];
    const rows: LookupRecord[] = [];
    for (let i = 0; i < wanted.length; i += IDS_PER_CALL) {
      const chunk = wanted.slice(i, i + IDS_PER_CALL);
      rows.push(...(await this.read(target, undefined, undefined, chunk)));
    }
    return rows;
  }

  private async read(
    target: LookupTarget,
    q: string | undefined,
    take: number | undefined,
    ids?: number[],
  ): Promise<LookupRecord[]> {
    const items = await this.call(() =>
      this.api.getReportLookup(target.reportId, target.parameter, q, take, ids),
    );
    return items.map((i) => ({ id: i.id, label: i.label }));
  }

  /** A failed read is shown by the control itself, never as a second toast. */
  private call<T>(start: () => Observable<T>): Promise<T> {
    // The request must start inside `run` (firstValueFrom subscribes at once), or the interceptor would still toast.
    return this.quiet.run(() => firstValueFrom(start()));
  }
}
