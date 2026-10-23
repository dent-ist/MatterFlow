import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ReportAdminClient, ReportsStatusResponse } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';

/**
 * Admin: the Settings tab of the Reports page (spec 8.3 step 6, issue #712): whether reports can run and why not (no report login, the login is the
 * application's own, the role is missing, too many rights, database compatibility level too low), and what the startup probe found: the login name,
 * "writes denied", "audit tables denied" and how many tables it can read. Check again probes the login once more, for after the DBA fixed it.
 */
@Component({
  selector: 'mf-reports-health-tab',
  imports: [MfDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <section class="rh" aria-labelledby="rh-title" data-health>
      <h2 id="rh-title" class="rh__title">Report login</h2>
      <p class="mf-sr-only" role="status" aria-live="polite">{{ announcement() }}</p>
      @if (failure(); as f) {
        <p class="rh__bad" role="alert" data-failure>{{ f }}</p>
      }
      @if (status(); as s) {
        <p class="rh__state" data-state>
          <span class="rh__chip" [class.rh__chip--ok]="s.enabled" data-chip>{{
            s.enabled ? 'Ready' : 'Not ready'
          }}</span>
          {{ s.message }}
        </p>
        @if (s.login; as l) {
          <dl class="rh__facts" data-login>
            <dt>Login</dt>
            <dd>{{ l.loginName }}</dd>
            <dt>Writes</dt>
            <dd>{{ l.writesDenied ? 'Denied' : 'Not denied' }}</dd>
            <dt>Audit and credential tables</dt>
            <dd>{{ l.auditTablesDenied ? 'Denied' : 'Not denied' }}</dd>
            <dt>Tables it can read</dt>
            <dd>{{ l.readableTables }}</dd>
            <dt>Database compatibility level</dt>
            <dd>{{ l.compatibilityLevel }}</dd>
            <dt>Checked</dt>
            <dd>{{ l.checkedAtUtc | mfDate: 'datetime' }}</dd>
          </dl>
        }
        <p>
          <button type="button" class="mf-btn" (click)="check()" [disabled]="busy()" data-check>
            {{ busy() ? 'Checking...' : 'Check again' }}
          </button>
        </p>
      } @else if (!failure()) {
        <p data-loading>Loading...</p>
      }
    </section>
  `,
  styles: `
    .rh__title {
      margin: 0 0 var(--mf-s3);
      font-size: var(--mf-fs-lg);
    }

    .rh__bad {
      color: var(--mf-danger);
    }

    .rh__chip {
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-warning-bg);
      font-weight: 600;
    }

    .rh__chip--ok {
      background: var(--mf-success-bg);
    }

    .rh__facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--mf-s1) var(--mf-s4);
      max-width: 36rem;
    }

    .rh__facts dt {
      color: var(--mf-text-muted);
    }

    .rh__facts dd {
      margin: 0;
    }
  `,
})
export class ReportsHealthTab {
  private readonly api = inject(ReportAdminClient);

  protected readonly status = signal<ReportsStatusResponse | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');

  constructor() {
    void this.run(() => this.api.getReportsStatus());
  }

  protected check(): void {
    void this.run(() => this.api.checkReportsStatus());
  }

  private async run(call: () => ReturnType<ReportAdminClient['getReportsStatus']>): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const s = await firstValueFrom(call());
      this.status.set(s);
      this.announcement.set(
        s.enabled ? 'Reports are ready.' : `Reports are not ready: ${s.message}`,
      );
    } catch (e) {
      this.failure.set(e instanceof ApiError ? e.message : 'The state could not be read.');
    } finally {
      this.busy.set(false);
    }
  }
}
