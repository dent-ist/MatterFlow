import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The Dashboard places that show a silhouette while their first read is on its way (P8, #96). */
export type DashSkeletonKind =
  'summary' | 'breakdowns' | 'trends' | 'swimlane' | 'lane' | 'users' | 'coverage';

/**
 * The loading silhouette of a Dashboard tab (P8, #96): the shape of what will be there, not eight identical blocks. Summary is two tile
 * groups and three list panels, Breakdowns four cards with four bar rows, Trends two chart frames with axis lines next to the panel, Swimlane
 * the cards of one lane, Users a grid of small tiles, Coverage table rows.
 *
 * The boxes use the same breakpoints, gaps and heights as the loaded content, so replacing the silhouette moves nothing. It is decorative:
 * the bones are `aria-hidden`, the host is `aria-busy` and one visually hidden status says "Loading" (a polite live region, announced once
 * per place, never once per bone). The shimmer is a slow opacity pulse and is switched off by `prefers-reduced-motion`. A manual Refresh that
 * already has data never shows this (the figures stay), the hosts only render it on a first or scope-changing read.
 */
@Component({
  selector: 'mf-dash-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mf-fill',
    '[attr.data-skeleton]': 'kind()',
    'aria-busy': 'true',
  },
  template: `
    <span class="sr-only" role="status">{{ label() }}</span>
    <div
      class="sil"
      [class]="'sil sil--' + kind() + (chrome() ? ' sil--chrome' : '')"
      [class.sil--compact]="compact()"
      aria-hidden="true"
    >
      @if (chrome()) {
        <!-- The toolbars the tab will draw above its content, before the page knows the tab is allowed to mount (the Scope is still unknown). -->
        <span class="bone bone--chrome c1"></span>
        @if (kind() === 'users') {
          <span class="bone bone--chrome c2"></span>
          <span class="bone bone--chrome c3"></span>
        }
        @if (kind() === 'swimlane') {
          <span class="bone bone--chrome c2"></span>
        }
      }
      @switch (kind()) {
        @case ('summary') {
          <div class="sum-tiles">
            @for (g of two; track g) {
              <div class="grp">
                <span class="bone bone--h"></span>
                <div class="tiles">
                  @for (n of four; track n) {
                    <span class="bone bone--tile"></span>
                  }
                </div>
              </div>
            }
          </div>
          <div class="sum-lists">
            @for (l of three; track l) {
              <div class="list">
                <span class="bone bone--h bone--lh"></span>
                <div class="lrows">
                  @for (n of five; track n) {
                    <span class="bone bone--row"></span>
                  }
                </div>
              </div>
            }
          </div>
        }
        @case ('breakdowns') {
          <span class="bone bone--cap"></span>
          <div class="cards">
            @for (c of four; track c) {
              <div class="card">
                <span class="bone bone--h"></span>
                @for (n of four; track n) {
                  <span class="bone bone--bar"></span>
                }
              </div>
            }
          </div>
        }
        @case ('trends') {
          <div class="trend-main">
            <span class="frame frame--flows"><span class="axis"></span></span>
            <span class="frame frame--backlog"><span class="axis"></span></span>
          </div>
          <div class="trend-side">
            <span class="bone bone--h"></span>
            @for (n of four; track n) {
              <span class="bone bone--row"></span>
            }
          </div>
        }
        @case ('swimlane') {
          <div class="lanes">
            @for (l of four; track l) {
              <div class="lane">
                <span class="bone bone--h"></span>
                @for (n of three; track n) {
                  <span class="bone bone--card"></span>
                }
              </div>
            }
          </div>
        }
        @case ('lane') {
          @for (n of three; track n) {
            <span class="bone bone--card"></span>
          }
        }
        @case ('users') {
          <div class="grid">
            @for (n of tiles; track n) {
              <span class="bone bone--user"></span>
            }
          </div>
        }
        @case ('coverage') {
          <div class="rows">
            @for (n of five; track n) {
              <span class="bone bone--line"></span>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .sil {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
      min-width: 0;
      height: 100%;
      overflow: hidden;
    }
    .bone,
    .frame {
      display: block;
      box-sizing: border-box;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      animation: mf-skeleton-pulse 1.4s ease-in-out infinite;
    }
    @keyframes mf-skeleton-pulse {
      50% {
        opacity: 0.55;
      }
    }
    /* A slow pulse is motion: with reduced motion the silhouette is simply still. */
    @media (prefers-reduced-motion: reduce) {
      .bone,
      .frame {
        animation: none;
      }
    }
    .bone--h {
      width: 7rem;
      height: 1.25rem;
      border-color: transparent;
    }
    .bone--cap {
      width: min(24rem, 100%);
      height: 1.25rem;
      border-color: transparent;
      flex: none;
    }

    /* ---- Toolbars of Swimlane, Users and Coverage (heights measured on the loaded tabs: 32 / 49, 32, 48 or 28 px; wrapped on a phone) */
    .sil--chrome {
      gap: var(--mf-s2);
    }
    .sil--chrome.sil--swimlane {
      gap: var(--mf-s3);
    }
    .bone--chrome {
      flex: none;
      border-color: transparent;
    }
    .sil--swimlane .c1 {
      height: 32px;
    }
    .sil--swimlane .c2 {
      display: none;
    }
    .sil--users .c1,
    .sil--coverage .c1 {
      height: 49px;
    }
    .sil--coverage .c1 {
      height: 32px;
    }
    .sil--users .c2 {
      height: 32px;
    }
    .sil--users .c3 {
      height: 48px;
    }
    @media (min-width: 1600px) {
      .sil--users .c3 {
        height: 28px;
      }
    }
    @media (max-width: 899px) {
      .sil--swimlane .c2 {
        display: block;
        height: 56px;
      }
    }
    @media (max-width: 560px) {
      .sil--swimlane .c1 {
        height: 72px;
      }
      .sil--users .c1 {
        height: 226px;
      }
      .sil--users .c2 {
        height: 88px;
      }
      .sil--users .c3 {
        height: 79px;
      }
    }

    /* ---- Summary: tiles left, the three lists beside them from 1280 px, under the tiles below */
    .sil--summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      column-gap: var(--mf-s5);
      align-items: start;
    }
    .grp {
      margin-bottom: var(--mf-s5);
    }
    .grp .bone--h {
      margin-bottom: var(--mf-s2);
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 220px));
      justify-content: start;
      gap: var(--mf-s3);
    }
    /* Sizes are px measured on the loaded tabs (the root font size of the app is 14 px, so rem is not the same as 16 px). */
    .bone--tile {
      height: 116px;
      border-radius: var(--mf-radius-lg);
    }
    .sum-lists {
      display: grid;
      gap: var(--mf-s2);
      min-width: 0;
    }
    /* A list panel is 9 px of frame and padding, a 28 px heading row, five 44 px rows and 9 px (266 px), as the loaded list is. */
    .list {
      display: block;
      padding: 8px var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .bone--lh {
      margin: 4px 0;
    }
    .lrows {
      display: grid;
    }
    .bone--row {
      height: 44px;
    }
    @media (max-width: 480px) {
      .tiles {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--mf-s2);
      }
    }
    @media (max-width: 340px) {
      .tiles {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    @media (min-width: 1280px) {
      .sil--summary {
        grid-template-columns: minmax(0, clamp(360px, 27vw, 452px)) minmax(0, 1fr);
      }
    }
    @media (min-width: 1280px) and (min-height: 561px) {
      .sil--summary {
        grid-template-rows: minmax(0, 1fr);
        align-items: stretch;
      }
      .sum-tiles {
        min-height: 0;
        overflow: hidden;
      }
      .sum-tiles .tiles {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--mf-s2);
      }
      .sum-lists {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .list {
        flex: 0 1 auto;
        min-height: 9rem;
        overflow: hidden;
      }
    }

    /* ---- Breakdowns: a caption and four cards in the grid the tab uses (4 across from 1300 px, 2 columns from 700 px, else 1) */
    :host([data-skeleton='breakdowns']) {
      container-type: inline-size;
    }
    .cards {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s4);
      align-items: start;
    }
    .card {
      display: grid;
      gap: var(--mf-s1);
      padding: var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .card .bone--h {
      margin-bottom: var(--mf-s2);
    }
    .bone--bar {
      height: 32px;
    }
    @container (min-width: 700px) {
      .cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @container (min-width: 1300px) {
      .cards {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }

    /* ---- Trends: two chart frames with an axis line each and the panel beside them from 1000 px */
    .sil--trends {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s5);
      align-items: stretch;
    }
    .trend-main {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
      min-width: 0;
    }
    .frame {
      position: relative;
      border-radius: var(--mf-radius-lg);
    }
    .frame--flows {
      flex: 320 1 0;
      min-height: 12rem;
    }
    .frame--backlog {
      flex: 200 1 0;
      min-height: 8rem;
    }
    .axis {
      position: absolute;
      inset: auto var(--mf-s4) var(--mf-s4) 3rem;
      height: 1px;
      background: var(--mf-border-strong);
    }
    .frame::before {
      content: '';
      position: absolute;
      inset: var(--mf-s4) auto var(--mf-s4) 3rem;
      width: 1px;
      background: var(--mf-border-strong);
    }
    .trend-side {
      display: grid;
      align-content: start;
      gap: var(--mf-s2);
      padding: var(--mf-s4) 0 0;
      border-top: 1px solid var(--mf-border);
    }
    @media (min-width: 1000px) {
      .sil--trends {
        grid-template-columns: minmax(0, 1fr) clamp(300px, 24vw, 340px);
      }
      .trend-side {
        padding: 0 0 0 var(--mf-s4);
        border-top: 0;
        border-left: 1px solid var(--mf-border);
      }
    }
    @media (max-width: 480px) {
      /* The phone chart is 16:9 and the Task Types list is folded away. */
      .frame--flows {
        flex: none;
        aspect-ratio: 16 / 9;
        min-height: 0;
      }
      .frame--backlog {
        flex: none;
        height: 7rem;
        min-height: 0;
      }
      .trend-side {
        display: none;
      }
    }

    /* ---- Swimlane: lanes of cards (the board before it knows its lanes); Lane: the cards of one real lane */
    .sil--lane {
      gap: var(--mf-s2);
    }
    .lanes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: var(--mf-s3);
      height: 100%;
    }
    .sil--compact .bone--card {
      height: 44px;
    }
    .lane {
      display: grid;
      align-content: start;
      gap: var(--mf-s2);
      padding: var(--mf-s3);
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .bone--card {
      height: 172px;
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
    }

    /* ---- Users: tiles of about 9rem x 3.3rem, the grid of the workload tab */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(9rem, 100%), 1fr));
      gap: var(--mf-s2);
    }
    .bone--user {
      min-height: 60px;
      border-radius: var(--mf-radius-lg);
    }

    /* ---- Coverage: matrix rows */
    .rows {
      display: grid;
      gap: var(--mf-s2);
    }
    .bone--line {
      height: 45px;
    }
  `,
})
export class DashSkeleton {
  readonly kind = input.required<DashSkeletonKind>();
  /** What the single status says; the host names the thing that loads. */
  readonly label = input('Loading');
  /** Also draw the tab's toolbars above the silhouette (the page-level skeleton of Swimlane and Users, before the tab itself is mounted). */
  readonly chrome = input(false);
  /** The Swimlane's compact density: cards of one line (44 px) instead of about 11 rem. */
  readonly compact = input(false);

  protected readonly two = [1, 2];
  protected readonly three = [1, 2, 3];
  protected readonly four = [1, 2, 3, 4];
  protected readonly five = [1, 2, 3, 4, 5];
  protected readonly tiles = Array.from({ length: 24 }, (_, i) => i);
}
