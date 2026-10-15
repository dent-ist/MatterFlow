import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

/** Viewport width from which the Details panel sits to the right of the main area. */
export const DETAIL_WIDE_QUERY = '(min-width: 1100px)';
/** Viewport width from which the collapsed summary starts expanded (tablets and up); phones start collapsed. */
export const DETAIL_TABLET_QUERY = '(min-width: 600px)';

let nextId = 0;

/**
 * The shared layout of the Client, Matter and Project detail pages: the record's main content (a grid) on the left and a Details panel
 * on the right.
 *
 * - From 1100 px: two columns, the main area fluid and an `aside` of about 340 px that stays in view while the page scrolls (and scrolls
 *   itself when it is taller than the window).
 * - Below 1100 px: one column; the panel moves ABOVE the main area (also in the reading and tab order) and its heading becomes a
 *   disclosure button (`aria-expanded`). It starts collapsed on phones and expanded on tablets.
 *
 * Slots: `mfMain` (the main area) and `mfAside` (the Details content; the panel adds the "Details" heading, which names the `aside`).
 *
 *   <mf-detail-layout><div mfMain>...</div><div mfAside>...</div></mf-detail-layout>
 */
@Component({
  selector: 'mf-detail-layout',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="dl"
      [class.dl--wide]="wide()"
      data-detail-layout
      [attr.data-layout]="wide() ? 'wide' : 'narrow'"
    >
      @if (!wide()) {
        <ng-container [ngTemplateOutlet]="panel" />
      }
      <div class="dl__main" data-detail-main>
        <ng-content select="[mfMain]" />
      </div>
      @if (wide()) {
        <ng-container [ngTemplateOutlet]="panel" />
      }
    </div>

    <ng-template #panel>
      <aside class="dl__aside" [attr.aria-labelledby]="uid + '-h'" data-detail-panel>
        <h2 class="dl__h" [id]="uid + '-h'">
          @if (wide()) {
            <span class="dl__t">{{ heading() }}</span>
          } @else {
            <button
              type="button"
              class="dl__toggle"
              data-detail-toggle
              [attr.aria-expanded]="open()"
              [attr.aria-controls]="uid + '-body'"
              (click)="open.set(!open())"
            >
              <span>{{ heading() }}</span>
              <i
                class="pi dl__chevron"
                [class.pi-chevron-up]="open()"
                [class.pi-chevron-down]="!open()"
                aria-hidden="true"
              ></i>
            </button>
          }
        </h2>
        <div class="dl__body" [id]="uid + '-body'" [hidden]="!wide() && !open()" data-detail-body>
          <ng-content select="[mfAside]" />
        </div>
      </aside>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    .dl {
      display: block;
    }
    .dl--wide {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: var(--mf-s5);
      align-items: start;
    }
    .dl__main {
      min-width: 0;
    }
    .dl__aside {
      min-width: 0;
      margin-bottom: var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      box-shadow: var(--mf-shadow-1);
    }
    .dl--wide .dl__aside {
      position: sticky;
      top: calc(var(--mf-header-h, 3.75rem) + var(--mf-s4));
      max-height: calc(100vh - var(--mf-header-h, 3.75rem) - var(--mf-s5) - var(--mf-s4));
      margin-bottom: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .dl__h {
      margin: 0;
      font-size: var(--mf-fs-h3);
      line-height: 1.3;
    }
    .dl__t {
      display: block;
      padding: var(--mf-s3) var(--mf-s4);
    }
    .dl__toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s3);
      width: 100%;
      min-height: 2.75rem;
      padding: var(--mf-s3) var(--mf-s4);
      background: none;
      border: 0;
      color: inherit;
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .dl__toggle:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .dl__body {
      padding: 0 var(--mf-s4) var(--mf-s4);
      overflow-wrap: anywhere;
    }
    .dl__body[hidden] {
      display: none;
    }
  `,
})
export class DetailLayout {
  readonly heading = input('Details');

  protected readonly uid = `dl-${nextId++}`;
  /** True from 1100 px (two columns). Without `matchMedia` (tests) the wide layout is used. */
  protected readonly wide = signal(true);
  /** Whether the collapsible summary is open (only meaningful below 1100 px). */
  protected readonly open = signal(true);

  constructor() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia(DETAIL_WIDE_QUERY);
    this.wide.set(wide.matches);
    this.open.set(window.matchMedia(DETAIL_TABLET_QUERY).matches);
    const onChange = (e: MediaQueryListEvent) => this.wide.set(e.matches);
    wide.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => wide.removeEventListener('change', onChange));
  }
}
