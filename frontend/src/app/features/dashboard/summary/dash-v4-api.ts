import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CapacityPerson,
  DashboardCapacity,
  DashboardBoardClient,
  DashboardSummary,
  DashboardUnassignedGauge,
} from '../../../api/generated/api-client';

/**
 * The one door to the Dashboard v4 data that is not part of the summary itself (epic #1063): the capacity of the scope and the People behind it. It was a fixture
 * facade until the regenerated client arrived; now it calls `DashboardBoardClient`. Both calls need Dashboard.ViewUsers; `scope` is the page scope (`all`, `mine` or a pod id).
 */
@Injectable({ providedIn: 'root' })
export class DashV4Api {
  private readonly api = inject(DashboardBoardClient);

  /** `GET /dashboard/capacity`. */
  capacity(scope: string): Observable<DashboardCapacity> {
    return this.api.getDashboardCapacity(scope);
  }

  /** `GET /dashboard/capacity/people`, called when the People popover opens (the search is a client filter over up to 200 people). */
  people(scope: string): Observable<CapacityPerson[]> {
    return this.api.getDashboardCapacityPeople(undefined, undefined, scope);
  }

  /** The `unassignedGauge` block of the summary; null without Dashboard.ViewSummary. */
  gaugeOf(summary: DashboardSummary): DashboardUnassignedGauge | null {
    return summary.unassignedGauge ?? null;
  }
}
