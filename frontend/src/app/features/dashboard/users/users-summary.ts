import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WorkloadSummary } from '../../../api/generated/api-client';
import { unassignedQueueParams } from './users-model';

/**
 * The team summary strip above the cards: Available (nobody open), Busy (open tasks), Out of office and Unassigned tasks. The counts ignore
 * the availability and name filters, so the strip stays steady while the cards are filtered. "Out of office" filters the cards to those
 * people (a toggle) and "Unassigned tasks" opens the Task Queue filtered to open tasks nobody has.
 */
@Component({
  selector: 'mf-users-summary',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="strip" aria-label="Team summary" data-summary>
      <li class="tile tile--free" data-summary-tile="available">
        <i class="pi pi-check-circle" aria-hidden="true"></i>
        <span class="n" data-n>{{ shown('available') }}</span>
        <span class="t">Available <span class="sub">no open tasks</span></span>
      </li>
      <li class="tile" data-summary-tile="busy">
        <i class="pi pi-briefcase" aria-hidden="true"></i>
        <span class="n" data-n>{{ shown('busy') }}</span>
        <span class="t">Busy <span class="sub">have open tasks</span></span>
      </li>
      <li class="tile tile--ooo" data-summary-tile="out">
        <i class="pi pi-calendar-minus" aria-hidden="true"></i>
        <span class="n" data-n>{{ shown('outOfOffice') }}</span>
        <button
          type="button"
          class="t link"
          data-summary-out
          [attr.aria-pressed]="outOnly()"
          (click)="toggleOut.emit()"
        >
          Out of office
          <span class="sub">{{ outOnly() ? 'showing only these' : 'show only these' }}</span>
        </button>
      </li>
      <li class="tile tile--warn" data-summary-tile="unassigned">
        <i class="pi pi-inbox" aria-hidden="true"></i>
        <span class="n" data-n>{{ shown('unassignedTasks') }}</span>
        <a class="t link" data-summary-unassigned routerLink="/tasks" [queryParams]="queue">
          Unassigned tasks <span class="sub">open in the Task Queue</span>
        </a>
      </li>
    </ul>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s3);
    }
    .strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tile {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .tile--free {
      color: var(--mf-success);
      background: var(--mf-success-bg);
      border-color: var(--mf-success);
    }
    .tile--ooo {
      border-style: dashed;
      border-color: var(--mf-border-strong);
    }
    .tile--warn .pi {
      color: var(--mf-warning);
    }
    .n {
      font-size: var(--mf-fs-h3, 1.375rem);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .t {
      display: grid;
      color: inherit;
      font-weight: 600;
      text-align: left;
    }
    .sub {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 400;
    }
    .tile--free .sub {
      color: var(--mf-success);
    }
    button.link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    a.link {
      color: var(--mf-link);
      text-decoration: none;
    }
    .link:hover {
      text-decoration: underline;
    }
    button.link[aria-pressed='true'] {
      text-decoration: underline;
    }
  `,
})
export class UsersSummary {
  readonly summary = input<WorkloadSummary | null>(null);
  readonly outOnly = input(false);
  readonly toggleOut = output<void>();

  protected readonly queue = unassignedQueueParams();

  protected shown(key: 'available' | 'busy' | 'outOfOffice' | 'unassignedTasks'): string {
    const s = this.summary();
    return s ? String(s[key]) : '-';
  }
}
