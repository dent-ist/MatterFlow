import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  MatterEventItemClient,
  MatterEventTypesClient,
  MatterEventsClient,
  MyMattersClient,
} from '../../../api/generated/api-client';
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
import { STATUS_FILTERS } from './mm-models';

/**
 * The server calls of the My Matters update through the GENERATED client (contract `docs/ux/ui-update/api-contract.md`). The generated types say `undefined` where the page's models say
 * `null`; the answers are the same JSON, so they are cast once here and nowhere else.
 */
@Injectable({ providedIn: 'root' })
export class GeneratedMmApi extends MmApi {
  private readonly my = inject(MyMattersClient);
  private readonly events_ = inject(MatterEventsClient);
  private readonly item = inject(MatterEventItemClient);
  private readonly typesApi = inject(MatterEventTypesClient);

  tree(f: MmFilters, opts: { q?: string; activeOnly?: boolean } = {}): Observable<MatterTree> {
    const a = commonArgs(f);
    return this.my
      .getMyMattersTree(
        undefined,
        opts.q,
        opts.activeOnly || undefined,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
        undefined,
        a.matterId,
      )
      .pipe(map((r) => r as unknown as MatterTree));
  }
  eventTypes(): Observable<MatterEventType[]> {
    return this.typesApi.listMatterEventTypes() as unknown as Observable<MatterEventType[]>;
  }
  events(f: MmFilters, from: string, to: string): Observable<EventList> {
    const a = commonArgs(f);
    return this.my
      .getMyMattersEvents(
        undefined,
        a.scope,
        a.role,
        a.clientId,
        from,
        to,
        a.managerId,
        undefined,
        a.matterId,
      )
      .pipe(map((r) => r as unknown as EventList));
  }
  upcoming(f: MmFilters, days: number, take: number): Observable<EventList> {
    const a = commonArgs(f);
    return this.my
      .getMyMattersUpcomingEvents(
        days,
        take,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
        undefined,
        a.matterId,
      )
      .pipe(map((r) => r as unknown as EventList));
  }
  createEvent(matterId: number, body: EventInput): Observable<MatterEvent> {
    return this.events_
      .createMatterEvent(matterId, {
        typeCode: body.typeCode,
        title: body.title,
        date: body.date,
        time: body.time ?? undefined,
        note: body.note ?? undefined,
      })
      .pipe(map((r) => r as unknown as MatterEvent));
  }
  updateEvent(eventId: number, body: EventInput): Observable<MatterEvent> {
    return this.item
      .updateMatterEvent(eventId, {
        rowVersion: body.rowVersion ?? '',
        typeCode: body.typeCode,
        title: body.title,
        date: body.date,
        time: body.time ?? undefined,
        note: body.note ?? undefined,
      })
      .pipe(map((r) => r as unknown as MatterEvent));
  }
  deleteEvent(eventId: number, rowVersion: string): Observable<void> {
    return this.item.deleteMatterEvent(eventId, rowVersion);
  }
  feed(f: MmFilters, q: FeedQuery): Observable<Feed> {
    const a = commonArgs(f);
    return this.my
      .getMyMattersFeed(
        q.kind,
        undefined,
        q.unread,
        q.page,
        q.pageSize,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
        undefined,
        a.matterId,
      )
      .pipe(map((r) => r as unknown as Feed));
  }
  markSeen(): Observable<void> {
    return this.my.markMyMattersActivitySeen({}).pipe(map(() => undefined));
  }
  taskCounts(f: MmFilters, status: StatusFilter, show: ShowFilter): Observable<TaskCounts> {
    const a = commonArgs(f);
    const codes =
      status === 'open'
        ? undefined
        : [...(STATUS_FILTERS.find((s) => s.key === status)?.codes ?? [])];
    return this.my
      .getMyMattersTaskCounts(
        codes,
        show === 'everything' ? undefined : show,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
        undefined,
        a.matterId,
      )
      .pipe(map((r) => r as unknown as TaskCounts));
  }
  assets(f: MmFilters, q: AssetQuery): Observable<AssetPage> {
    const a = commonArgs(f);
    return this.my
      .getMyMattersAssets(
        q.q,
        q.name,
        q.assetTypeId,
        q.status,
        q.createdFrom,
        q.createdTo,
        q.updatedFrom,
        q.updatedTo,
        q.sort,
        q.dir,
        q.page,
        q.pageSize,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
        undefined,
        a.matterId,
      )
      .pipe(map((r) => r as unknown as AssetPage));
  }
  asset(assetId: number): Observable<AssetDetail> {
    return this.my.getMyMattersAsset(assetId).pipe(map((r) => r as unknown as AssetDetail));
  }
}
