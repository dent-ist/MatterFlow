import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { MmFilters } from '../my-matters-filters';
import {
  AssetDetail,
  AssetPage,
  AssetStatusCode,
  EventInput,
  EventList,
  Feed,
  FeedKind,
  MatterEvent,
  MatterEventType,
  MatterTree,
  ShowFilter,
  StatusFilter,
  TaskCounts,
} from './mm-models';
import { EVENT_TYPES } from '../../../shared/ui/event-type';

export interface AssetQuery {
  q?: string;
  name?: string;
  assetTypeId?: number[];
  status?: AssetStatusCode[];
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface FeedQuery {
  kind?: FeedKind[];
  unread?: boolean;
  page: number;
  pageSize: number;
}

/**
 * The My Matters update's server calls in one place (epic #953; contract `docs/ux/ui-update/api-contract.md`). The components call this, never the generated client's positional
 * methods, so a regenerated client changes one file. Every call takes the page's scope (`MmFilters`: scope, role, client, matter, manager).
 *
 * This is the interface plus the typed stand-in the page runs on until the endpoints exist (flagged in `progress.md`); `GeneratedMmApi` (mm-api-generated.ts) replaces it.
 */
export abstract class MmApi {
  abstract tree(f: MmFilters, opts?: { q?: string; activeOnly?: boolean }): Observable<MatterTree>;
  abstract eventTypes(): Observable<MatterEventType[]>;
  abstract events(f: MmFilters, from: string, to: string): Observable<EventList>;
  abstract upcoming(f: MmFilters, days: number, take: number): Observable<EventList>;
  abstract createEvent(matterId: number, body: EventInput): Observable<MatterEvent>;
  abstract updateEvent(eventId: number, body: EventInput): Observable<MatterEvent>;
  abstract deleteEvent(eventId: number, rowVersion: string): Observable<void>;
  abstract feed(f: MmFilters, q: FeedQuery): Observable<Feed>;
  abstract markSeen(): Observable<void>;
  abstract taskCounts(f: MmFilters, status: StatusFilter, show: ShowFilter): Observable<TaskCounts>;
  abstract assets(f: MmFilters, q: AssetQuery): Observable<AssetPage>;
  abstract asset(assetId: number): Observable<AssetDetail>;
}

/** The fixed list of the eight types (contract 2.1) for the stand-in. */
export const STANDIN_EVENT_TYPES: MatterEventType[] = EVENT_TYPES.map((t, i) => ({
  code: t.code,
  label: t.name,
  iconKey: t.code.toLowerCase(),
  colourKey: t.colourKey,
  sortOrder: i + 1,
}));

/** An empty, well-typed stand-in: the page renders its empty states until the real endpoints are wired. */
@Injectable({ providedIn: 'root' })
export class EmptyMmApi extends MmApi {
  tree(): Observable<MatterTree> {
    return of({
      asOfUtc: new Date().toISOString(),
      activeDays: 7,
      clientCount: 0,
      matterCount: 0,
      clients: [],
    });
  }
  eventTypes(): Observable<MatterEventType[]> {
    return of(STANDIN_EVENT_TYPES);
  }
  events(f: MmFilters, from: string, to: string): Observable<EventList> {
    void f;
    return of({ from, to, total: 0, items: [] });
  }
  upcoming(): Observable<EventList> {
    return of({ from: '', to: '', total: 0, items: [] });
  }
  createEvent(): Observable<MatterEvent> {
    throw new Error('Events are not available yet.');
  }
  updateEvent(): Observable<MatterEvent> {
    throw new Error('Events are not available yet.');
  }
  deleteEvent(): Observable<void> {
    throw new Error('Events are not available yet.');
  }
  feed(): Observable<Feed> {
    return of({
      asOfUtc: new Date().toISOString(),
      seenAtUtc: null,
      unreadCount: 0,
      total: 0,
      page: 1,
      pageSize: 25,
      countsByKind: {
        NEW_ASSETS: 0,
        NEW_COMMENTS: 0,
        NEW_STATUS_UPDATES: 0,
        ON_HOLD: 0,
        OVERDUE: 0,
        DUE_DATE_UPDATED: 0,
      },
      items: [],
    });
  }
  markSeen(): Observable<void> {
    return of(undefined);
  }
  taskCounts(): Observable<TaskCounts> {
    return of({
      byStatus: { allOpen: 0, new: 0, inProgress: 0, onHold: 0, completed: 0, cancelled: 0 },
      byShow: { everything: 0, overdue: 0, risk: 0, unassigned: 0, critical: 0, due7: 0 },
    });
  }
  assets(): Observable<AssetPage> {
    return of({ total: 0, page: 1, pageSize: 25, items: [] });
  }
  asset(): Observable<AssetDetail> {
    throw new Error('Assets are not available yet.');
  }
}
