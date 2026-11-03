import { Injectable } from '@angular/core';
import { Observable, delay, of } from 'rxjs';
import { DashboardSummary } from '../../../api/generated/api-client';
import { CapacityPerson, CapacitySummary, UnassignedGauge } from '../dash-v4-contract';
import { FIXTURE_GAUGE, capacityOf, fixturePeople } from '../dash-v4-fixtures';

/**
 * The one door to the Dashboard v4 data that is not in the generated client yet (epic #1063). Today it answers from the typed fixtures in
 * `dash-v4-fixtures.ts`; when Agent G has pushed the regenerated nswag client, ONLY this class changes (the methods call `DashboardClient`
 * and the temporary types go away). Nothing else imports the fixtures.
 */
@Injectable({ providedIn: 'root' })
export class DashV4Api {
  /** `GET /dashboard/capacity` (Dashboard.ViewUsers). `scope` is the page scope (`all`, `mine` or a pod id). */
  capacity(scope: string): Observable<CapacitySummary> {
    return of(capacityOf(fixturePeopleFor(scope))).pipe(delay(0));
  }

  /** `GET /dashboard/capacity/people` (Dashboard.ViewUsers), called when the People popover opens. */
  people(scope: string, q?: string): Observable<CapacityPerson[]> {
    const needle = (q ?? '').trim().toLowerCase();
    return of(
      fixturePeopleFor(scope).filter(
        (p) => needle === '' || p.displayName.toLowerCase().includes(needle),
      ),
    ).pipe(delay(0));
  }

  /** The `unassignedGauge` block of the summary; null when the viewer has no Dashboard.ViewSummary. */
  gaugeOf(summary: DashboardSummary): UnassignedGauge | null {
    const real = summary['unassignedGauge'] as UnassignedGauge | null | undefined;
    if (real !== undefined) return real;
    return { ...FIXTURE_GAUGE, count: summary.unassigned.count };
  }
}

function fixturePeopleFor(scope: string): CapacityPerson[] {
  return fixturePeople(scope === 'all' || scope === 'mine' ? 12 : 6);
}
