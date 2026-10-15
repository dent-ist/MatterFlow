import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Dashboard > Users tab (team workload).
 *
 * TODO(#73): placeholder registered by the Swimlane work (#72) so the tab exists in the tab list; the real
 * implementation (one card per user, coloured by highest open priority, availability) replaces this component.
 * Lazy-loaded through `@defer` in the dashboard page; shown only with Dashboard.ViewDepartment like the other tabs.
 */
@Component({
  selector: 'mf-dash-users-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="soon" data-users-soon>
      <i class="pi pi-users" aria-hidden="true"></i>
      <span>Team workload is coming soon.</span>
    </p>
  `,
  styles: `
    .soon {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      padding: var(--mf-s4);
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
    }
  `,
})
export class DashUsersTab {}
