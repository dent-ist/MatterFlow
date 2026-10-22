import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  DestroyRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { iconForPath } from '../../../shared/layout/section-icons';

/**
 * Scrolls the tab list (and only it) so that the tab is fully inside it. `scrollIntoView` would also scroll the document sideways whenever the
 * list is wider than the window, which is how a tab row can push the page 9 px out at 320 px.
 */
export function revealInList(tab: HTMLElement | null | undefined): void {
  const list = tab?.parentElement;
  if (!tab || !list) return;
  const t = tab.getBoundingClientRect();
  const l = list.getBoundingClientRect();
  if (t.left < l.left) list.scrollLeft -= l.left - t.left;
  else if (t.right > l.right) list.scrollLeft += t.right - l.right;
}

export interface DashTab {
  key: string;
  label: string;
}

/** Ids tie each tab to its panel (`aria-controls`, `aria-labelledby`); the page renders the panel with `panelId`. */
export const tabId = (key: string) => `mf-dash-tab-${key}`;
export const panelId = (key: string) => `mf-dash-panel-${key}`;

/**
 * The header of the Dashboard (UX review 2, P4 and R3; page-header contract S20, #603): the page heading (H1, 22 px / 700) with the controls
 * projected into it (stale text, Scope, Refresh) at the right of the title row, and the tab list under the title. The row sticks to the top while the page scrolls (600 px and
 * wider; the fixed-height layout never scrolls it away). With one permitted tab (or none) the tab list is not rendered and the heading
 * names the tab.
 *
 * The tab list of the Dashboard (WAI-ARIA tabs pattern, automatic activation): the selected tab is the only tab stop (roving tabindex),
 * Left and Right arrows move between tabs and wrap round, Home and End jump to the first and last, and moving to a tab selects it. The
 * page owns the selection (it lives in the address, `?tab=`) and renders the matching `role="tabpanel"`. On a narrow screen the list
 * scrolls sideways instead of wrapping.
 */
@Component({
  selector: 'mf-dash-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head" data-dash-head>
      <div class="row" data-dash-title-row>
        <h1 class="h1" data-page-title id="mf-dash-h1">
          <!-- The section icon of every page title (UXR-02), the same one the left navigation shows; decorative, so the heading's name is the text. -->
          @if (icon) {
            <i class="h1__icon" [class]="icon" aria-hidden="true" data-page-icon></i>
          }
          {{ heading() }}
        </h1>
        <!-- Stale text, Scope and Refresh: at the right of the title row (the page-header contract, shape B). -->
        <div class="end" data-page-actions><ng-content /></div>
      </div>
      @if (showTabs()) {
        <div
          class="strip"
          [attr.data-more-start]="edges().start"
          [attr.data-more-end]="edges().end"
        >
          <div class="tabs" role="tablist" [attr.aria-label]="label()" (scroll)="measure()">
            @for (t of tabs(); track t.key) {
              <button
                type="button"
                role="tab"
                class="tab"
                [id]="tabId(t.key)"
                [attr.data-tab]="t.key"
                [attr.aria-selected]="t.key === selected()"
                [attr.aria-controls]="t.key === selected() ? panelId(t.key) : null"
                [attr.tabindex]="t.key === selected() ? 0 : -1"
                (click)="choose(t.key)"
                (keydown)="onKey($event)"
              >
                {{ t.label }}
              </button>
            }
          </div>
          <!-- Scroll hints for a tab list wider than its room (phones): a fade and a chevron at the edge that has more tabs. -->
          <i class="hint hint--start pi pi-chevron-left" aria-hidden="true"></i>
          <i class="hint hint--end pi pi-chevron-right" aria-hidden="true"></i>
        </div>
      }
    </div>
  `,
  styles: `
    /* Sticky from 600 px while the page scrolls (the fallback below 768 x 561); in the fixed-height layout the row is never scrolled away. */
    :host {
      display: block;
      min-width: 0;
      max-width: 100%;
      margin-bottom: var(--mf-s2);
      background: var(--mf-bg, var(--mf-surface));
    }
    @media (min-width: 600px) {
      :host {
        position: sticky;
        top: 0;
        z-index: 9;
      }
    }
    /* The page-header contract (S20, #603, shape B workspace page): the title row is the H1 (22px / 700, 18px below 640px, one 36px row) with
       the stale text, Scope and Refresh at its right; the tab strip is under the title, as on My Work. The first row sits 12px below the top
       of the main area: the shell's padding is 12px on a fixed page, 24px on a page that scrolls and 16px on a phone, so the header is pulled
       up by the difference (the same numbers as mf-page-header). */
    :host {
      margin-top: calc(-1 * var(--mf-s3));
    }
    @media (max-width: 639.98px) {
      :host {
        margin-top: calc(-1 * var(--mf-s1));
      }
    }
    @media (min-width: 768px) and (min-height: 561px) {
      :host {
        margin-top: 0;
      }
    }
    .head {
      min-width: 0;
      max-width: 100%;
      box-shadow: inset 0 -1px 0 var(--mf-border);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      min-width: 0;
      max-width: 100%;
      align-items: flex-start;
      justify-content: space-between;
      column-gap: var(--mf-s3);
    }
    .h1 {
      flex: 0 1 auto;
      min-width: 0;
      margin: 0;
      padding-block: max(0px, calc((36px - 1.3em) / 2));
      font-size: var(--mf-fs-h2);
      line-height: 1.3;
      font-weight: 700;
    }
    @media (max-width: 639.98px) {
      .h1 {
        font-size: var(--mf-fs-h3);
      }
    }
    .h1__icon {
      margin-right: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: 0.75em;
      vertical-align: 0.04em;
    }
    .end {
      display: flex;
      flex: 0 1 auto;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s2);
      min-width: 0;
      min-height: 36px;
      max-width: 100%;
      margin-left: auto;
    }
    .end:empty {
      display: none;
    }
    /* On a small phone the Scope and Refresh controls do not fit beside the title once the pods have been read, so they take their own line
       then. Taking it from the start (while the first read is still going) keeps the page from jumping down by that line when the Scope
       appears (a 36 px layout shift on every tab at 375 px). */
    @media (max-width: 400px) {
      .end {
        flex-basis: 100%;
      }
    }
    /* The tab list is the only part of the row that may be wider than the window: it scrolls inside itself (contain: inline-size, so what is inside never
       adds to the width of the row or the document, whatever the number or the width of the tabs). */
    .strip {
      position: relative;
      min-width: 0;
      max-width: 100%;
    }
    .hint {
      position: absolute;
      top: 0;
      bottom: 0;
      display: none;
      align-items: center;
      width: 1.75rem;
      color: var(--mf-text);
      font-size: 0.75rem;
      pointer-events: none;
    }
    .hint--start {
      left: 0;
      justify-content: flex-start;
      background: linear-gradient(to right, var(--mf-bg, var(--mf-surface)) 40%, transparent);
    }
    .hint--end {
      right: 0;
      justify-content: flex-end;
      background: linear-gradient(to left, var(--mf-bg, var(--mf-surface)) 40%, transparent);
    }
    .strip[data-more-start='true'] .hint--start,
    .strip[data-more-end='true'] .hint--end {
      display: flex;
    }
    .tabs {
      min-width: 0;
      max-width: 100%;
      contain: inline-size;
      overscroll-behavior-x: contain;
      display: flex;
      gap: var(--mf-s1);
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: thin;
    }
    .tab {
      flex: none;
      min-height: 2.75rem;
      padding: 0 var(--mf-s4);
      color: var(--mf-text-muted);
      background: none;
      border: 0;
      border-bottom: 3px solid transparent;
      font: inherit;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
    }
    .tab:hover {
      color: var(--mf-text);
      background: var(--mf-surface-alt);
    }
    .tab[aria-selected='true'] {
      color: var(--mf-text);
      font-weight: 600;
      border-bottom-color: var(--mf-primary);
    }
    /* On a phone the three tabs share the width instead of scrolling out of view. */
    @media (max-width: 480px) {
      .tab {
        flex: 1 1 auto;
        padding: 0 var(--mf-s2);
      }
    }
    .tab:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
  `,
})
export class DashTabs {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private observed: HTMLElement | null = null;
  private resizer: ResizeObserver | null = null;
  /** Whether the tab list has more tabs out of view at its start and at its end (drives the scroll hints). */
  protected readonly edges = signal({ start: false, end: false });
  protected readonly tabId = tabId;
  protected readonly panelId = panelId;
  protected readonly icon = iconForPath('/dashboard');

  readonly tabs = input.required<readonly DashTab[]>();
  readonly selected = input.required<string>();
  readonly label = input('Dashboard views');
  /** The page heading: "Dashboard", or the name of the only tab. */
  readonly heading = input('Dashboard');
  /** False hides the tab list (one permitted tab, or an empty department). */
  readonly showTabs = input(true);
  /** The tab the person chose (click or keyboard). */
  readonly tabChange = output<string>();

  /** Reads the scroll position of the tab list. */
  protected measure(): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>('.tabs');
    if (!el) return;
    // The tab list changes size when the controls beside it arrive (the Scope select) without the host changing: watch it too.
    if (this.observed !== el) {
      this.observed = el;
      this.resizer?.observe(el);
    }
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    const now = this.edges();
    if (now.start !== start || now.end !== end) this.edges.set({ start, end });
  }

  constructor() {
    afterNextRender(
      () => {
        if (typeof ResizeObserver !== 'undefined') {
          const ro = new ResizeObserver(() => {
            this.measure();
            // The Scope select and the Refresh button arrive after the first read and take room from the tab list: the chosen tab may have been pushed
            // out of view (768 px, Pod Lead: "Summary, Swimlane" with Users selected and out of sight), so bring it back in.
            this.revealSelected();
          });
          this.resizer = ro;
          ro.observe(this.host.nativeElement);
          this.destroyRef.onDestroy(() => ro.disconnect());
        }
        this.measure();
      },
      { injector: this.injector },
    );
    // The tab list exists once the tabs are shown (it may arrive after the first render): start watching its size and read it.
    effect(() => {
      this.showTabs();
      this.tabs();
      afterNextRender(() => this.measure(), { injector: this.injector });
    });
    // On a phone the five tabs scroll sideways: a tab chosen by a link (or a reload) is brought into view inside the tab list.
    effect(() => {
      const key = this.selected();
      afterNextRender(
        () =>
          revealInList(this.host.nativeElement.querySelector<HTMLElement>(`[data-tab="${key}"]`)),
        { injector: this.injector },
      );
    });
  }

  /** Brings the selected tab into view inside the tab list (the list only, never the document). */
  private revealSelected(): void {
    revealInList(
      this.host.nativeElement.querySelector<HTMLElement>(`[data-tab="${this.selected()}"]`),
    );
  }

  protected choose(key: string): void {
    if (key !== this.selected()) this.tabChange.emit(key);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const keys = this.tabs().map((t) => t.key);
    const at = Math.max(0, keys.indexOf(this.selected()));
    let to: number;
    switch (event.key) {
      case 'ArrowRight':
        to = (at + 1) % keys.length;
        break;
      case 'ArrowLeft':
        to = (at - 1 + keys.length) % keys.length;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = keys.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const tab = this.host.nativeElement.querySelector<HTMLElement>(`[data-tab="${keys[to]}"]`);
    // Focus without letting the browser scroll anything: a focused tab that sits past the edge of the tab list is brought into view in the list only.
    tab?.focus({ preventScroll: true });
    revealInList(tab);
    this.choose(keys[to]);
  }
}
