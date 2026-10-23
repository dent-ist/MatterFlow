import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import {
  AssignmentMatrixResponse,
  ReportAssignmentClient,
} from '../../../api/generated/api-client';

/**
 * Admin: the Assignments tab of the Reports page (spec 9.4, issue #717; `Report.Assign`): a read-only overview of which active role may run which
 * report, reports down the side and roles across, a "Yes" where a role holds the report. Names only, never the query. Changes are made on a
 * role (Users > Roles > Reports) or on a report (Roles tab of its editor).
 */
@Component({
  selector: 'mf-report-matrix-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollArea],
  host: { class: 'mf-fill' },
  template: `
    <p class="rm__hint">
      Read-only overview of the active roles. To change it, open a role on Users &gt; Roles and use
      its Reports tab, or open a report and use its Roles tab.
    </p>
    @if (failure(); as f) {
      <p class="rm__error" role="alert" data-failure>{{ f }}</p>
    }
    @if (matrix(); as m) {
      @if (m.reports.length === 0 || m.roles.length === 0) {
        <p data-empty>
          {{ m.reports.length === 0 ? 'There are no reports yet.' : 'There are no active roles.' }}
        </p>
      } @else {
        <div class="mf-table-wrap" mfScrollArea="Assignment matrix">
          <div class="mf-scroll">
            <table class="mf-grid rm__table" data-matrix>
              <caption class="mf-sr-only">
                Reports by roles
              </caption>
              <thead>
                <tr>
                  <th scope="col">Report</th>
                  @for (r of m.roles; track r.id) {
                    <th scope="col" class="rm__role">{{ r.name }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (rep of m.reports; track rep.reportId) {
                  <tr [attr.data-report]="rep.reportId">
                    <th scope="row">
                      {{ rep.name }}
                      <span class="rm__muted"
                        >{{ rep.categoryName }}{{ rep.isActive ? '' : ', inactive' }}</span
                      >
                    </th>
                    @for (r of m.roles; track r.id) {
                      <td class="rm__cell">
                        @if (has(rep.reportId, r.id)) {
                          <span data-yes>Yes</span>
                        } @else {
                          <span class="mf-sr-only">No</span><span aria-hidden="true">-</span>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    } @else if (!failure()) {
      <p data-loading>Loading...</p>
    }
  `,
  styles: `
    .rm__hint,
    .rm__muted {
      color: var(--mf-text-muted);
    }

    .rm__muted {
      display: block;
      font-size: var(--mf-fs-sm);
      font-weight: 400;
    }

    .rm__error {
      color: var(--mf-danger);
    }

    .rm__scroll {
      max-width: 100%;
      overflow: auto;
    }

    .rm__role {
      min-width: 6rem;
    }

    .rm__cell {
      text-align: center;
    }
  `,
})
export class ReportMatrixTab {
  private readonly api = inject(ReportAssignmentClient);
  protected readonly matrix = signal<AssignmentMatrixResponse | null>(null);
  protected readonly failure = signal('');
  private readonly cells = computed(
    () => new Set((this.matrix()?.cells ?? []).map((c) => `${c.roleId}:${c.reportId}`)),
  );

  constructor() {
    firstValueFrom(this.api.getReportAssignmentMatrix()).then(
      (m) => this.matrix.set(m),
      () => this.failure.set('The overview could not be loaded.'),
    );
  }

  protected has(reportId: number, roleId: number): boolean {
    return this.cells().has(`${roleId}:${reportId}`);
  }
}
