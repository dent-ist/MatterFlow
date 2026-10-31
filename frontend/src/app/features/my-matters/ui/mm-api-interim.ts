import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL, MyMattersClient } from '../../../api/generated/api-client';
import { map } from 'rxjs/operators';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { AssetQuery, FeedQuery, MmApi } from './mm-api';
import {
  AssetDetail,
  AssetPage,
  EventInput,
  EventList,
  Feed,
  MatterEvent,
  MatterEventType,
  MatterTree,
  ShowFilter,
  StatusFilter,
  TaskCounts,
} from './mm-models';

/**
 * INTERIM (flagged in progress.md): the new endpoints of `docs/ux/ui-update/api-contract.md` called by address with the app's HttpClient, because the generated client does not
 * have them yet. It is replaced by `GeneratedMmApi` (generated methods) when UI-03, UI-04 and UI-05 are in the client; the components never see the difference.
 */
@Injectable({ providedIn: 'root' })
export class InterimMmApi extends MmApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL, { optional: true }) ?? '';
  private readonly legacy = inject(MyMattersClient);

  private scope(
    f: MmFilters,
    extra: Record<string, string | number | boolean | readonly string[] | undefined> = {},
  ): HttpParams {
    const a = commonArgs(f);
    const all: Record<string, string | number | boolean | readonly string[] | undefined> = {
      scope: a.scope,
      role: a.role,
      clientId: a.clientId,
      matterId: a.matterId,
      managerId: a.managerId,
      ...extra,
    };
    let p = new HttpParams();
    for (const [k, v] of Object.entries(all)) {
      if (v === undefined || v === '') continue;
      if (Array.isArray(v)) for (const x of v) p = p.append(k, String(x));
      else p = p.set(k, String(v));
    }
    return p;
  }

  private url(path: string): string {
    return `${this.base}/api/v1/${path}`;
  }

  tree(f: MmFilters, opts: { q?: string; activeOnly?: boolean } = {}): Observable<MatterTree> {
    return this.http.get<MatterTree>(this.url('my-matters/tree'), {
      params: this.scope(f, { q: opts.q, activeOnly: opts.activeOnly || undefined }),
    });
  }
  eventTypes(): Observable<MatterEventType[]> {
    return this.http.get<MatterEventType[]>(this.url('matter-event-types'));
  }
  events(f: MmFilters, from: string, to: string): Observable<EventList> {
    return this.http.get<EventList>(this.url('my-matters/events'), {
      params: this.scope(f, { from, to }),
    });
  }
  upcoming(f: MmFilters, days: number, take: number): Observable<EventList> {
    return this.http.get<EventList>(this.url('my-matters/events/upcoming'), {
      params: this.scope(f, { days, take }),
    });
  }
  createEvent(matterId: number, body: EventInput): Observable<MatterEvent> {
    return this.http.post<MatterEvent>(this.url(`matters/${matterId}/events`), body);
  }
  updateEvent(eventId: number, body: EventInput): Observable<MatterEvent> {
    return this.http.put<MatterEvent>(this.url(`matter-events/${eventId}`), body);
  }
  deleteEvent(eventId: number, rowVersion: string): Observable<void> {
    return this.http.delete<void>(this.url(`matter-events/${eventId}`), { params: { rowVersion } });
  }
  feed(f: MmFilters, q: FeedQuery): Observable<Feed> {
    return this.http.get<Feed>(this.url('my-matters/feed'), {
      params: this.scope(f, { kind: q.kind, unread: q.unread, page: q.page, pageSize: q.pageSize }),
    });
  }
  markSeen(): Observable<void> {
    return this.legacy.markMyMattersActivitySeen({}).pipe(map(() => undefined));
  }
  taskCounts(f: MmFilters, status: StatusFilter, show: ShowFilter): Observable<TaskCounts> {
    const codes: Record<StatusFilter, string[]> = {
      open: [],
      new: ['NEW'],
      progress: ['IN_PROGRESS'],
      hold: ['ON_HOLD'],
      completed: ['COMPLETED'],
      cancelled: ['CANCELLED'],
    };
    return this.http.get<TaskCounts>(this.url('my-matters/task-counts'), {
      params: this.scope(f, {
        status: codes[status],
        show: show === 'everything' ? undefined : show,
      }),
    });
  }
  assets(f: MmFilters, q: AssetQuery): Observable<AssetPage> {
    return this.http.get<AssetPage>(this.url('my-matters/assets'), {
      params: this.scope(f, {
        q: q.q,
        name: q.name,
        assetTypeId: q.assetTypeId?.map(String),
        status: q.status,
        createdFrom: q.createdFrom,
        createdTo: q.createdTo,
        updatedFrom: q.updatedFrom,
        updatedTo: q.updatedTo,
        sort: q.sort,
        dir: q.dir,
        page: q.page,
        pageSize: q.pageSize,
      }),
    });
  }
  asset(assetId: number): Observable<AssetDetail> {
    return this.http.get<AssetDetail>(this.url(`my-matters/assets/${assetId}`));
  }
}
