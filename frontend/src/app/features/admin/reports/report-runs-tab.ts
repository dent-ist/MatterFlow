import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ReportAdminClient, ReportRunLogItemResponse } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { ScrollArea } from '../../../shared/ui/fixed-page';

const PAGE = 50;

/**
 * Admin: the Run log tab of the Reports page (spec 9.1, issue #712), read-only: who ran or previewed which version of which report with which
 * values, how it ended and how long it took, newest first. Filter by status and kind; older rows load page by page. The values are the ones
 * that were bound (long values shortened), never the query. Needs `Report.Manage`.
 */
@Component({
  selector: 'mf-report-runs-tab',
  imports: [MfDatePipe, ScrollArea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <div class="rr__filters">
      <div class="rr__field">
        <label class="mf-label mf-label--sm" for="runs-status">Status</label>
        <select id="runs-status" class="mf-control" (change)="setStatus($any($event.target).value)">
          <option value="">All</option>
          @for (s of statuses; track s) {
            <option [value]="s">{{ s }}</option>
          }
        </select>
      </div>
      <div class="rr__field">
        <label class="mf-label mf-label--sm" for="runs-kind">Kind</label>
        <select id="runs-kind" class="mf-control" (change)="setKind($any($event.target).value)">
          <option value="">All</option>
          @for (k of kinds; track k) {
            <option [value]="k">{{ k }}</option>
          }
        </select>
      </div>
    </div>
    <p class="mf-sr-only" role="status" aria-live="polite" data-announce>{{ announcement() }}</p>
    @if (failure(); as f) {
      <p class="rr__error" role="alert" data-failure>
        {{ f }}
        <button type="button" class="mf-btn mf-btn--text" (click)="reload()">Try again</button>
      </p>
    }
    <div class="mf-table-wrap" mfScrollArea="Run log">
      <div class="mf-scroll">
        <table class="mf-grid" id="runs-table" data-runs>
          <caption class="mf-sr-only">
            Report runs, newest first
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Report</th>
              <th scope="col">Person</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th class="mf-cell-num" scope="col">Rows</th>
              <th class="mf-cell-num" scope="col">Time</th>
              <th scope="col">Values</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.runId) {
              <tr [attr.data-run]="r.runId">
                <td>{{ r.startedAtUtc | mfDate: 'datetime' }}</td>
                <td>
                  {{ r.reportName }} <span class="rr__muted">v{{ r.versionNo }}</span>
                </td>
                <td>{{ r.userName }}</td>
                <td>{{ r.kind }}</td>
                <td>
                  {{ r.status }}{{ r.truncated ? ' (cut off)' : '' }}
                  @if (r.errorCode) {
                    <span class="rr__muted">{{ r.errorCode }}</span>
                  }
                </td>
                <td class="mf-cell-num">{{ r.rowCount ?? '' }}</td>
                <td class="mf-cell-num">
                  {{
                    r.durationMs === null || r.durationMs === undefined ? '' : r.durationMs + ' ms'
                  }}
                </td>
                <td class="rr__values">{{ r.parameters.join('; ') }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" data-empty>
                  {{ loading() ? 'Loading the run log...' : 'No runs yet.' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
    @if (next() !== null) {
      <p>
        <button type="button" class="mf-btn" (click)="more()" [disabled]="loading()" data-more>
          Show older runs
        </button>
      </p>
    }
  `,
  styles: `
    .rr__filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }

    .rr__field {
      display: grid;
      gap: var(--mf-s1);
    }

    .rr__error {
      color: var(--mf-danger);
    }

    .rr__muted {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }

    .rr__values {
      max-width: 24rem;
      overflow-wrap: anywhere;
    }
  `,
})
export class ReportRunsTab {
  private readonly api = inject(ReportAdminClient);

  protected readonly statuses = [
    'Succeeded',
    'Truncated',
    'Failed',
    'TimedOut',
    'Cancelled',
    'Rejected',
    'Running',
  ];
  protected readonly kinds = ['Run', 'Preview', 'Export', 'ChoiceQuery'];
  protected readonly rows = signal<ReportRunLogItemResponse[]>([]);
  protected readonly next = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  private status = '';
  private kind = '';

  constructor() {
    void this.run(true);
  }

  protected setStatus(value: string): void {
    this.status = value;
    void this.run(true);
  }

  protected setKind(value: string): void {
    this.kind = value;
    void this.run(true);
  }

  protected reload(): void {
    void this.run(true);
  }

  protected more(): void {
    void this.run(false);
  }

  private async run(replace: boolean): Promise<void> {
    this.loading.set(true);
    this.failure.set('');
    try {
      const page = await firstValueFrom(
        this.api.listReportRuns(
          undefined,
          this.status || undefined,
          this.kind || undefined,
          undefined,
          replace ? undefined : (this.next() ?? undefined),
          PAGE,
        ),
      );
      this.rows.set(replace ? page.items : [...this.rows(), ...page.items]);
      this.next.set(page.nextBefore ?? null);
      this.announcement.set(`${this.rows().length} runs shown.`);
    } catch (e) {
      this.failure.set(
        e instanceof ApiError && e.status === 403
          ? 'You may not see the run log.'
          : 'The run log could not be loaded.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
