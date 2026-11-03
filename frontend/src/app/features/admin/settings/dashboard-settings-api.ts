import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { DEFAULT_GAUGE_SETTINGS, GaugeSettings } from './dashboard-settings-model';

/**
 * The one door to the gauge settings (Settings.Manage). TEMPORARY (epic #1063): the backend has not published an endpoint for the `Dashboard:Gauge:*` keys yet, so this keeps
 * the values in memory for the session. When Agent G pushes the generated client, only this class changes (read the keys, write them, pass the server's validation
 * messages through as `ApiError` field errors).
 */
@Injectable({ providedIn: 'root' })
export class DashboardSettingsApi {
  private current: GaugeSettings = { ...DEFAULT_GAUGE_SETTINGS };

  load(): Observable<GaugeSettings> {
    return of(structuredClone(this.current));
  }

  save(next: GaugeSettings): Observable<GaugeSettings> {
    this.current = structuredClone(next);
    return of(structuredClone(this.current));
  }
}
