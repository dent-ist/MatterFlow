import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ReportViewLayout,
  ReportViewResponse,
  ReportViewsClient,
} from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { QuietRequests } from '../../core/http/interceptors';

/** The views the server allows one person for one report (`GET .../views` says it in `limit`; this is what shows before the list is read). */
export const DEFAULT_VIEW_LIMIT = 25;
/** The longest view name the server takes. */
export const VIEW_NAME_MAX = 80;

export type ViewsLoadState = 'idle' | 'loading' | 'ready' | 'error';

/** The words of a refused view call that the person can act on (spec 6.3), or null for any other failure. */
export function viewErrorText(error: unknown, limit = DEFAULT_VIEW_LIMIT): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'VIEW_NAME_EXISTS') return 'You already have a view with this name.';
  if (error.code === 'VIEW_LIMIT_REACHED') {
    return `You can save up to ${limit} views for this report.`;
  }
  return null;
}

/** Why a view name cannot be used (spec 6.3), or null: empty, over 80 characters, or the name of another view of this report (any case). */
export function viewNameError(name: string, others: readonly string[]): string | null {
  const text = name.trim();
  if (text === '') return 'Enter a view name.';
  if (text.length > VIEW_NAME_MAX) return `View name must be ${VIEW_NAME_MAX} characters or fewer.`;
  const lower = text.toLowerCase();
  if (others.some((o) => o.trim().toLowerCase() === lower)) {
    return 'You already have a view with this name.';
  }
  return null;
}

/** The name the Save dialog starts with: "<Report name> view", numbered ("... view 2") while that name is taken, cut to the 80 characters a name may have. */
export function suggestedViewName(reportName: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  const fit = (base: string, suffix: string): string =>
    `${base.slice(0, VIEW_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
  const first = fit(reportName, ' view');
  if (!used.has(first.toLowerCase())) return first;
  for (let n = 2; n < 1000; n++) {
    const candidate = fit(reportName, ` view ${n}`);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return first;
}

/** The default view first, then by name (the order the server lists them in). */
function ordered(views: readonly ReportViewResponse[]): ReportViewResponse[] {
  return [...views].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

/**
 * The saved views of one person for one report (#722): the list and the five calls of `/api/v1/reports/{id}/views`. One instance per result grid (it is
 * provided by the grid), so the menu and the grid read the same list. Every call is quiet (the menu says what failed in its own words) and keeps the
 * list in step by hand: a new default clears the old one, a delete drops the row.
 */
@Injectable()
export class ReportViewsStore {
  private readonly api = inject(ReportViewsClient);
  private readonly quiet = inject(QuietRequests);

  readonly views = signal<readonly ReportViewResponse[]>([]);
  readonly limit = signal(DEFAULT_VIEW_LIMIT);
  readonly state = signal<ViewsLoadState>('idle');

  /** Reads the list. A failure leaves the list empty and `state` at `error` (the menu offers Retry); it never throws. */
  async load(reportId: number): Promise<void> {
    this.state.set('loading');
    try {
      const res = await this.quiet.run(() => firstValueFrom(this.api.listReportViews(reportId)));
      this.views.set(ordered(res.views));
      this.limit.set(res.limit > 0 ? res.limit : DEFAULT_VIEW_LIMIT);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  find(viewId: number | null): ReportViewResponse | undefined {
    return viewId === null ? undefined : this.views().find((v) => v.viewId === viewId);
  }

  defaultView(): ReportViewResponse | undefined {
    return this.views().find((v) => v.isDefault);
  }

  async create(
    reportId: number,
    name: string,
    layout: ReportViewLayout,
    isDefault: boolean,
  ): Promise<ReportViewResponse> {
    const made = await this.quiet.run(() =>
      firstValueFrom(this.api.createReportView(reportId, { name, layout, isDefault })),
    );
    this.views.update((list) => [...(isDefault ? clearDefault(list) : list), made]);
    this.views.update(ordered);
    return made;
  }

  /** Renames the view and/or stores a new layout in it. */
  async update(
    reportId: number,
    viewId: number,
    change: { name?: string; layout?: ReportViewLayout },
  ): Promise<ReportViewResponse> {
    const changed = await this.quiet.run(() =>
      firstValueFrom(
        this.api.updateReportView(reportId, viewId, {
          name: change.name,
          layout: change.layout,
        }),
      ),
    );
    this.replace(changed);
    return changed;
  }

  async remove(reportId: number, viewId: number): Promise<void> {
    await this.quiet.run(() => firstValueFrom(this.api.deleteReportView(reportId, viewId)));
    this.views.update((list) => list.filter((v) => v.viewId !== viewId));
  }

  /** Makes this view the default (the server clears the old one). */
  async setDefault(reportId: number, viewId: number): Promise<void> {
    const changed = await this.quiet.run(() =>
      firstValueFrom(this.api.setDefaultReportView(reportId, viewId)),
    );
    this.views.update((list) => clearDefault(list).map((v) => (v.viewId === viewId ? changed : v)));
    this.views.update(ordered);
  }

  async clearDefault(reportId: number, viewId: number): Promise<void> {
    const changed = await this.quiet.run(() =>
      firstValueFrom(this.api.clearDefaultReportView(reportId, viewId)),
    );
    this.replace(changed);
  }

  private replace(changed: ReportViewResponse): void {
    this.views.update((list) =>
      ordered(list.map((v) => (v.viewId === changed.viewId ? changed : v))),
    );
  }
}

function clearDefault(list: readonly ReportViewResponse[]): ReportViewResponse[] {
  return list.map((v) => (v.isDefault ? { ...v, isDefault: false } : v));
}
