import { Observable } from 'rxjs';
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
 * * `GeneratedMmApi` (mm-api-generated.ts) is the one implementation.
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
  abstract taskCounts(
    f: MmFilters,
    statuses: readonly StatusFilter[],
    show: ShowFilter,
  ): Observable<TaskCounts>;
  abstract assets(f: MmFilters, q: AssetQuery): Observable<AssetPage>;
  abstract asset(assetId: number): Observable<AssetDetail>;
}
