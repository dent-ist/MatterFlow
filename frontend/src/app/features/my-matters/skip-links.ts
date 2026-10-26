import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The panels of the Overview a person can skip to, in page order (the id of a panel's heading is `mm-<key>-h`). */
export const SKIP_PANELS: readonly { key: string; label: string }[] = [
  { key: 'attention', label: 'Needs my attention' },
  { key: 'deadlines', label: 'Upcoming deadlines' },
  { key: 'health', label: 'Matter health' },
  { key: 'activity', label: 'Recent activity' },
];

/**
 * "Skip to" links between the panels of the My Matters Overview (issue #820): the first stops after the tab strip, visually hidden until one
 * has the focus, each moving the focus to the heading of its panel (Enter). They are links, never shortcuts (#420), and the Tab order of the
 * panels themselves is unchanged. A panel that is not on the page (it is rendered with the Overview only) is simply not offered.
 */
@Component({
  selector: 'mf-mm-skip-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .sk {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    /* Visible while a link has the focus. */
    .sk:focus-within {
      position: static;
      width: auto;
      height: auto;
      margin: 0 0 var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      overflow: visible;
      clip-path: none;
      white-space: normal;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .sk ul {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .sk a {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      color: var(--mf-link);
    }
    .sk a:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    @media (max-width: 639.98px) {
      .sk a {
        min-height: 44px;
      }
    }
  `,
  template: `
    <nav class="sk" aria-label="Skip to a panel" data-skip-links>
      <ul>
        <li><span>Skip to</span></li>
        @for (p of panels; track p.key) {
          <li>
            <a
              [attr.href]="'#mm-' + p.key + '-h'"
              [attr.data-skip-to]="p.key"
              (click)="jump($event, p.key)"
              >{{ p.label }}</a
            >
          </li>
        }
      </ul>
    </nav>
  `,
})
export class SkipLinks {
  protected readonly panels = SKIP_PANELS;

  protected jump(event: Event, key: string): void {
    event.preventDefault();
    const heading = document.getElementById(`mm-${key}-h`);
    if (!heading) return;
    heading.focus();
    heading.scrollIntoView({ block: 'start' });
  }
}
