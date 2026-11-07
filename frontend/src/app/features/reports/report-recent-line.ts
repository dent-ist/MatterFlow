import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RecentReportResponse } from '../../api/generated/api-client';
import { Badge } from '../../shared/ui/badge';
import { NumericDatePipe } from '../../shared/ui/numeric-date';
import { Tip } from '../../shared/ui/tip';

/**
 * The Recent line above the Reports grid (issue #723, spec 7.2): the label "Recent" and up to five report names as chips that open the run page, newest
 * first, in one row that never wraps. A chip that does not fit the width is hidden (not just clipped, so it is no Tab stop either): at 1366 four fit.
 * The chip is a link (`mf-btn mf-btn--text mf-btn--chip` around the shared neutral `mf-badge` pill with a history icon, D-12) with the category and the last run in its tooltip. The page decides when
 * the line is shown at all (a run, no search or filter); this component draws what it is given.
 */
@Component({
  selector: 'mf-report-recent-line',
  imports: [Badge, NumericDatePipe, RouterLink, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      margin: 0 0 var(--mf-s2);
    }
    .rr {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-chip-h);
      overflow: hidden;
    }
    .rr__label {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-chip);
      font-weight: var(--mf-fw-semibold);
    }
    .rr__chips {
      display: flex;
      flex: 1 1 auto;
      flex-wrap: nowrap;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      margin: 0;
      padding: 0;
      overflow: hidden;
      list-style: none;
    }
    .rr__chips > li {
      flex: none;
    }
    /* The name inside the shared neutral badge (the pill the link wraps, D-12): cut at 140 px with an ellipsis, so the whole chip stays at 180 px. */
    .rr__name {
      display: inline-block;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: bottom;
    }
  `,
  template: `
    <div class="rr" data-recent-line>
      <span class="rr__label" id="rr-label">Recent</span>
      <ul #chips class="rr__chips" aria-labelledby="rr-label">
        @for (r of items(); track r.reportId) {
          <li data-recent-item>
            <a
              class="mf-btn mf-btn--text mf-btn--chip"
              [routerLink]="['/reports', r.reportId]"
              [attr.data-recent]="r.reportId"
              [mfTip]="r.categoryName + '\\nLast run ' + (r.lastRunAtUtc | mfNum)"
              ><mf-badge tone="neutral" icon="pi-history"
                ><span class="rr__name">{{ r.name }}</span></mf-badge
              ></a
            >
          </li>
        }
      </ul>
    </div>
  `,
})
export class ReportRecentLine {
  /** The reports to show, newest first (the page passes at most five). */
  readonly items = input.required<readonly RecentReportResponse[]>();

  private readonly list = viewChild.required<ElementRef<HTMLElement>>('chips');
  private observer: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => {
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => this.fit());
        this.observer.observe(this.list().nativeElement);
      }
      this.fit();
    });
    // A new list of chips is measured after it is drawn.
    effect(() => {
      this.items();
      queueMicrotask(() => this.fit());
    });
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }

  /** Hides, from the right, every chip that does not fit the row (the first chip is always kept: its pill is cut at 180 px, never more). */
  private fit(): void {
    const list = this.list().nativeElement;
    const entries = Array.from(list.children) as HTMLElement[];
    for (const e of entries) e.hidden = false;
    const right = list.getBoundingClientRect().right;
    let fitted = 0;
    for (const e of entries) {
      if (e.getBoundingClientRect().right <= right + 0.5) fitted++;
      else break;
    }
    entries.forEach((e, i) => (e.hidden = i >= Math.max(fitted, 1)));
  }
}
