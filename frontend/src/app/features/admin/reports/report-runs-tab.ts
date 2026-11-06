import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ReportAdminClient, ReportRunLogItemResponse } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { LoadState } from '../../../shared/ui/data-table';
import { Badge, BadgeTone } from '../../../shared/ui/badge';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';

const PAGE = 50;

/** The chip of a run's status (D-12): a tone and an icon with the words, never colour alone. */
const STATUS_CHIPS: Readonly<Record<string, { label: string; tone: BadgeTone; icon: string }>> = {
  Succeeded: { label: 'Succeeded', tone: 'success', icon: 'pi-check-circle' },
  Truncated: { label: 'Truncated', tone: 'warning', icon: 'pi-exclamation-triangle' },
  Failed: { label: 'Failed', tone: 'danger', icon: 'pi-times-circle' },
  TimedOut: { label: 'Timed Out', tone: 'warning', icon: 'pi-clock' },
  Cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'pi-ban' },
  Rejected: { label: 'Rejected', tone: 'danger', icon: 'pi-times-circle' },
  Running: { label: 'Running', tone: 'info', icon: 'pi-spinner' },
};

/**
 * Admin: the Run Log tab of the Reports page (spec 9.1, issue #712), read-only: who ran or previewed which version of which report with which
 * values, how it ended and how long it took, newest first. Filter by status and kind; older rows load page by page. The values are the ones
 * that were bound (long values shortened), never the query. Needs `Report.Manage`.
 */
@Component({
  selector: 'mf-report-runs-tab',
  imports: [NumericDatePipe, Badge, Dropdown, RecordCell, RecordGrid],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <div class="rr__filters">
      <mf-dropdown
        buttonId="runs-status"
        label="Status"
        prefix="Status:"
        [items]="statusItems"
        [value]="statusValue()"
        (valueChange)="setStatus($event)"
      />
      <mf-dropdown
        buttonId="runs-kind"
        label="Kind"
        prefix="Kind:"
        [items]="kindItems"
        [value]="kindValue()"
        (valueChange)="setKind($event)"
      />
    </div>
    <p class="mf-sr-only" role="status" aria-live="polite" data-announce>{{ announcement() }}</p>
    @if (failure(); as f) {
      @if (state() === 'ready') {
        <div class="pg-banner pg-banner--danger" role="alert" data-failure>
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
          <span>{{ f }}</span>
          <button type="button" class="mf-btn mf-btn--text" (click)="reload()">Retry</button>
        </div>
      }
    }
    <div class="mf-fill">
      <mf-record-grid
        data-runs
        tableId="runs-table"
        label="Run Log"
        caption="Report runs, newest first"
        noun="runs"
        [grid]="grid"
        [rows]="rows()"
        [rowKey]="runKey"
        [loadState]="state()"
        [empty]="rows().length === 0"
        [filtered]="statusValue() !== '' || kindValue() !== ''"
        emptyText="No runs yet."
        [bones]="bones"
        (retry)="reload()"
        (clear)="clearFilters()"
      >
        <ng-template mfCell="when" let-r>
          <td class="pg-nowrap">{{ r.startedAtUtc | mfNum }}</td>
        </ng-template>
        <ng-template mfCell="report" let-r>
          <td class="rr__namecell">
            <span class="pg-clip" [attr.title]="r.reportName"
              >{{ r.reportName }} <span class="rr__muted">v{{ r.versionNo }}</span></span
            >
          </td>
        </ng-template>
        <ng-template mfCell="person" let-r>
          <td class="pg-clip" [attr.title]="r.userName">{{ r.userName }}</td>
        </ng-template>
        <ng-template mfCell="kind" let-r>
          <td>{{ kindLabel(r.kind) }}</td>
        </ng-template>
        <ng-template mfCell="status" let-r>
          <td class="pg-nowrap" data-status>
            <mf-badge
              [tone]="statusOf(r.status).tone"
              [icon]="statusOf(r.status).icon"
              [attr.title]="r.errorCode || null"
              >{{ statusOf(r.status).label }}{{ r.truncated ? ' (Cut Off)' : '' }}</mf-badge
            >
          </td>
        </ng-template>
        <ng-template mfCell="rows" let-r>
          <td class="pg-num">{{ r.rowCount ?? '' }}</td>
        </ng-template>
        <ng-template mfCell="time" let-r>
          <td class="pg-num">
            {{ r.durationMs === null || r.durationMs === undefined ? '' : r.durationMs + ' ms' }}
          </td>
        </ng-template>
        <ng-template mfCell="values" let-r>
          <td class="rr__values pg-clip" [attr.title]="r.parameters.join('; ')">
            {{ r.parameters.join('; ') }}
          </td>
        </ng-template>
        @if (next() !== null) {
          <div mfGridFoot class="rr__foot">
            <button type="button" class="mf-btn" (click)="more()" [disabled]="loading()" data-more>
              Show More
            </button>
          </div>
        }
      </mf-record-grid>
    </div>
  `,
  styles: `
    .rr__filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s3);
    }

    .rr__namecell {
      max-width: 0;
    }

    .rr__foot {
      display: flex;
      justify-content: center;
      padding: var(--mf-s2);
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
  protected readonly statusItems: DropdownItem[] = [
    { value: '', label: 'All Statuses' },
    ...this.statuses.map((s) => ({ value: s, label: STATUS_CHIPS[s]?.label ?? s })),
  ];
  protected readonly kindItems: DropdownItem[] = [
    { value: '', label: 'All Kinds' },
    ...this.kinds.map((k) => ({ value: k, label: this.kindLabel(k) })),
  ];
  protected readonly rows = signal<ReportRunLogItemResponse[]>([]);
  protected readonly next = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly state = signal<LoadState>('loading');
  protected readonly statusValue = signal('');
  protected readonly kindValue = signal('');
  /** The columns of the shared record grid (D-44a): Report is the spring; the others have fixed widths so the headings never move. */
  protected readonly gridDefs = signal<readonly RecordGridColumn[]>([
    { key: 'when', label: 'When', locked: true, width: '152px', minWidth: '152px' },
    { key: 'report', label: 'Report', minWidth: '200px' },
    { key: 'person', label: 'Person', width: '150px', minWidth: '150px' },
    { key: 'kind', label: 'Kind', width: '120px', minWidth: '120px' },
    { key: 'status', label: 'Status', width: '160px', minWidth: '160px' },
    {
      key: 'rows',
      label: 'Rows',
      num: true,
      width: 'var(--mf-col-count-w)',
      minWidth: 'var(--mf-col-count-w)',
    },
    {
      key: 'time',
      label: 'Time',
      num: true,
      width: 'var(--mf-col-count-w)',
      minWidth: 'var(--mf-col-count-w)',
    },
    { key: 'values', label: 'Values', width: '240px', minWidth: '240px' },
  ]);
  protected readonly grid = new RecordGridState('admin-report-runs', this.gridDefs);
  protected readonly bones: Record<string, string> = {
    when: '6rem',
    report: '10rem',
    person: '6rem',
    kind: '3rem',
    status: '5rem',
    rows: '2rem',
    time: '3rem',
    values: '8rem',
  };
  protected readonly runKey = (r: ReportRunLogItemResponse): number => r.runId;

  protected statusOf(status: string): { label: string; tone: BadgeTone; icon: string } {
    return STATUS_CHIPS[status] ?? { label: status, tone: 'neutral', icon: 'pi-info-circle' };
  }

  protected kindLabel(kind: string): string {
    return kind === 'ChoiceQuery' ? 'Choice Query' : kind;
  }

  constructor() {
    void this.run(true);
  }

  protected setStatus(value: string): void {
    this.statusValue.set(value);
    void this.run(true);
  }

  protected setKind(value: string): void {
    this.kindValue.set(value);
    void this.run(true);
  }

  protected clearFilters(): void {
    this.statusValue.set('');
    this.kindValue.set('');
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
    if (replace && this.rows().length === 0) this.state.set('loading');
    try {
      const page = await firstValueFrom(
        this.api.listReportRuns(
          undefined,
          this.statusValue() || undefined,
          this.kindValue() || undefined,
          undefined,
          replace ? undefined : (this.next() ?? undefined),
          PAGE,
        ),
      );
      this.rows.set(replace ? page.items : [...this.rows(), ...page.items]);
      this.next.set(page.nextBefore ?? null);
      this.announcement.set(`${this.rows().length} runs shown.`);
      this.state.set('ready');
    } catch (e) {
      this.state.set(
        this.rows().length > 0
          ? 'ready'
          : e instanceof ApiError && e.status === 403
            ? 'forbidden'
            : 'error',
      );
      this.failure.set(
        e instanceof ApiError && e.status === 403
          ? 'You may not see the run log.'
          : "Couldn't load the run log.",
      );
    } finally {
      this.loading.set(false);
    }
  }
}
