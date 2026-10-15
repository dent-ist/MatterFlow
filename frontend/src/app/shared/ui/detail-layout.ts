import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FixedPage } from './fixed-page';

/** Viewport width from which the Details panel sits to the right of the main area. */
export const DETAIL_WIDE_QUERY = '(min-width: 1100px)';
/** Viewport width from which the Details panel is always open (a `collapsible` layout lets people collapse it below this). */
export const DETAIL_XWIDE_QUERY = '(min-width: 1400px)';
/** Viewport width from which the collapsed summary starts expanded (tablets and up); phones start collapsed. */
export const DETAIL_TABLET_QUERY = '(min-width: 600px)';
/** The same, on a fixed-header page (record pages): only a tall window starts with the summary open, a short one leaves the height to the grid. */
export const DETAIL_TABLET_TALL_QUERY = '(min-width: 600px) and (min-height: 900px)';

let nextId = 0;
const PANEL_KEY = 'mf.detail-panel.open';

function readPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) === '1';
  } catch {
    return false;
  }
}

function savePanelOpen(open: boolean): void {
  try {
    localStorage.setItem(PANEL_KEY, open ? '1' : '0');
  } catch {
    // Not persisted (private window or blocked storage).
  }
}

/**
 * The shared layout of the Client, Matter and Project detail pages: the record's main content (a grid) on the left and a Details panel
 * on the right.
 *
 * - From 1100 px: two columns, the main area fluid and an `aside` of about 340 px that stays in view while the page scrolls (and scrolls
 *   itself when it is taller than the window).
 * - `collapsible` (Matter and Project, whose main area is a wide task grid): between 1100 and 1399 px the panel can be collapsed to a
 *   slim "Details" button so the grid gets the width. It starts collapsed there and the choice is remembered. From 1400 px it is always open.
 * - Below 1100 px: one column; the panel moves ABOVE the main area (also in the reading and tab order) and its heading becomes a
 *   disclosure button (`aria-expanded`). It starts collapsed on phones and expanded on tablets.
 *
 * Slots: `mfMain` (the main area), `mfAside` (the Details content; the panel adds the "Details" heading, which names the `aside`) and the
 * optional `mfAfter` (a further section of the panel, for example the Task's Assets: inside the sticky panel below Details from 1100 px,
 * and BELOW the main area on narrower screens, so the reading order there is Details, main, then this section).
 *
 *   <mf-detail-layout><div mfMain>...</div><div mfAside>...</div><section mfAfter>...</section></mf-detail-layout>
 */
@Component({
  selector: 'mf-detail-layout',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.dl--fixed]': 'fixed' },
  template: `
    <div
      class="dl"
      [style.--dl-aside]="asideWidth()"
      [class.dl--wide]="wide()"
      [class.dl--slim]="mid() && !isOpen()"
      data-detail-layout
      [attr.data-layout]="wide() ? (mid() ? 'wide-collapsible' : 'wide') : 'narrow'"
    >
      @if (!wide()) {
        <ng-container [ngTemplateOutlet]="panel" />
      }
      <div class="dl__main" data-detail-main>
        <ng-content select="[mfMain]" />
      </div>
      @if (wide()) {
        <ng-container [ngTemplateOutlet]="panel" />
      } @else {
        <div class="dl__after dl__after--below" data-detail-after>
          <ng-container [ngTemplateOutlet]="after" />
        </div>
      }
    </div>

    <ng-template #after><ng-content select="[mfAfter]" /></ng-template>

    <ng-template #panel>
      <aside class="dl__aside" [attr.aria-labelledby]="uid + '-h'" data-detail-panel>
        <h2 class="dl__h" [id]="uid + '-h'">
          @if (!wide() || mid()) {
            <button
              type="button"
              class="dl__toggle"
              data-detail-toggle
              [attr.aria-expanded]="isOpen()"
              [attr.aria-controls]="uid + '-body'"
              (click)="toggle()"
            >
              <span>{{ heading() }}</span>
              <i class="pi dl__chevron" [class]="chevron()" aria-hidden="true"></i>
            </button>
          } @else {
            <span class="dl__t">{{ heading() }}</span>
          }
        </h2>
        <div class="dl__body" [id]="uid + '-body'" [hidden]="!isOpen()" data-detail-body>
          <ng-content select="[mfAside]" />
        </div>
        @if (wide()) {
          <div class="dl__after" [hidden]="!isOpen()" data-detail-after>
            <ng-container [ngTemplateOutlet]="after" />
          </div>
        }
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
      grid-template-columns: minmax(0, 1fr) var(--dl-aside, 340px);
      gap: var(--mf-s5);
      align-items: start;
    }
    .dl--slim {
      grid-template-columns: minmax(0, 1fr) auto;
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
    .dl__after[hidden] {
      display: none;
    }
    .dl__after:empty {
      display: none;
    }
    .dl__after {
      padding: var(--mf-s4);
      border-top: 1px solid var(--mf-border);
    }
    .dl__after--below {
      padding: 0;
      border: 0;
    }
    /*
     * Inside a fixed-header page (mf-fixed-page) the layout fills what is left under the pinned header: the main area is a column
     * whose grid scrolls, and the Details panel scrolls inside itself (it does not stick to the window). Narrow screens stack them, the
     * panel capped to a third of the window so the grid keeps the rest.
     */
    @media (min-width: 768px) and (min-height: 561px) {
      :host(.dl--fixed) {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      :host(.dl--fixed) .dl {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      :host(.dl--fixed) .dl--wide {
        display: grid;
        grid-template-rows: minmax(0, 1fr);
        align-items: stretch;
      }
      :host(.dl--fixed) .dl__main {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      :host(.dl--fixed) .dl--wide .dl__aside {
        position: static;
        max-height: 100%;
      }
      :host(.dl--fixed) .dl:not(.dl--wide) .dl__aside {
        flex: none;
        max-height: 35dvh;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      :host(.dl--fixed) .dl:not(.dl--wide) .dl__after--below {
        flex: none;
      }
    }
  `,
})
export class DetailLayout {
  /** Inside a fixed-header page (see the styles). */
  protected readonly fixed = inject(FixedPage, { optional: true }) !== null;

  readonly heading = input('Details');
  /** Lets the panel collapse between 1100 and 1399 px (see the class comment). */
  readonly collapsible = input(false);
  /** Width of the side panel from 1100 px (any CSS length); the Task page asks for more room for its Details. */
  readonly asideWidth = input('340px');

  protected readonly uid = `dl-${nextId++}`;
  /** True from 1100 px (two columns). Without `matchMedia` (tests) the wide layout is used. */
  protected readonly wide = signal(true);
  /** True from 1400 px: the panel is always open. Without `matchMedia` (tests) it is true. */
  protected readonly xwide = signal(true);
  /** Whether the collapsible summary is open (only meaningful below 1100 px). */
  protected readonly open = signal(true);
  /** Whether the panel is open between 1100 and 1399 px in a `collapsible` layout (remembered; starts collapsed). */
  protected readonly midOpen = signal(false);
  /** Wide but not extra wide, in a collapsible layout: the panel has a toggle. */
  protected readonly mid = computed(() => this.collapsible() && this.wide() && !this.xwide());
  protected readonly isOpen = computed(() =>
    !this.wide() ? this.open() : this.mid() ? this.midOpen() : true,
  );
  protected readonly chevron = computed(() =>
    !this.wide()
      ? this.open()
        ? 'pi-chevron-up'
        : 'pi-chevron-down'
      : this.midOpen()
        ? 'pi-chevron-right'
        : 'pi-chevron-left',
  );

  protected toggle(): void {
    if (this.wide()) {
      const next = !this.midOpen();
      this.midOpen.set(next);
      savePanelOpen(next);
    } else {
      this.open.set(!this.open());
    }
  }

  constructor() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia(DETAIL_WIDE_QUERY);
    this.wide.set(wide.matches);
    // Tablets start with the summary open, but on a fixed-header page only when the window is tall: the grid needs the height.
    this.open.set(
      window.matchMedia(this.fixed ? DETAIL_TABLET_TALL_QUERY : DETAIL_TABLET_QUERY).matches,
    );
    const xwide = window.matchMedia(DETAIL_XWIDE_QUERY);
    this.xwide.set(xwide.matches);
    this.midOpen.set(readPanelOpen());
    const onChange = (e: MediaQueryListEvent) => this.wide.set(e.matches);
    const onXChange = (e: MediaQueryListEvent) => this.xwide.set(e.matches);
    wide.addEventListener('change', onChange);
    xwide.addEventListener('change', onXChange);
    inject(DestroyRef).onDestroy(() => {
      wide.removeEventListener('change', onChange);
      xwide.removeEventListener('change', onXChange);
    });
  }
}
