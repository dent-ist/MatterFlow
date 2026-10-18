import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';

/**
 * One placeholder row of the work table while the first page (or another tab) loads (G4). The cells carry the `data-col` of the real
 * columns, so the fixed widths of `task-table.scss` apply and the Title column does not change width when the rows arrive. The shimmer
 * is switched off for people who prefer reduced motion. The `Loading tasks` status row is the table's own.
 */
@Component({
  // An attribute selector on the native <tr>, so the table keeps its semantics.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'tr[mfTaskSkeleton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The cells sit in the table's own rows, so they follow its padding, heights and borders: the styles below are global, under the row's attribute.
  encapsulation: ViewEncapsulation.None,
  host: { 'aria-hidden': 'true', 'data-skeleton': '' },
  template: `
    @for (key of columns(); track key) {
      <td [attr.data-col]="key">
        @if (key === 'title') {
          <span class="sk sk--title"></span>
          <span class="sk sk--sub"></span>
        } @else {
          <span class="sk" [class]="'sk sk--' + key"></span>
        }
      </td>
    }
  `,
  styles: `
    tr[mfTaskSkeleton] td {
      height: var(--mf-row-h);
      padding: 2px var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
      vertical-align: middle;
    }
    .wt--compact tr[mfTaskSkeleton] td {
      height: 36px;
      padding-block: 2px;
    }
    .wt--compact tr[mfTaskSkeleton] .sk--sub {
      display: none;
    }
    tr[mfTaskSkeleton] .sk {
      display: block;
      width: 6rem;
      height: 12px;
      border-radius: 3px;
      background: var(--mf-border);
      opacity: 0.55;
    }
    tr[mfTaskSkeleton] .sk--title {
      width: 62%;
      height: 14px;
      margin-bottom: 3px;
    }
    tr[mfTaskSkeleton] .sk--sub {
      width: 42%;
      height: 10px;
    }
    tr[mfTaskSkeleton] .sk--ref {
      width: 3.5rem;
    }
    tr[mfTaskSkeleton] .sk--matter {
      width: 10rem;
    }
    tr[mfTaskSkeleton] .sk--progress,
    tr[mfTaskSkeleton] .sk--due {
      width: 8rem;
    }
    tr[mfTaskSkeleton] .sk--priority,
    tr[mfTaskSkeleton] .sk--status {
      width: 5.5rem;
      height: 20px;
      border-radius: 10px;
    }
    @media (prefers-reduced-motion: no-preference) {
      tr[mfTaskSkeleton] .sk {
        animation: mf-sk-pulse 1.4s ease-in-out infinite;
      }
    }
    @keyframes mf-sk-pulse {
      50% {
        opacity: 0.25;
      }
    }
  `,
})
export class TaskSkeleton {
  readonly columns = input.required<readonly string[]>();
}
