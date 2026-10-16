import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
} from '@angular/core';

export interface DashTab {
  key: string;
  label: string;
}

/** Ids tie each tab to its panel (`aria-controls`, `aria-labelledby`); the page renders the panel with `panelId`. */
export const tabId = (key: string) => `mf-dash-tab-${key}`;
export const panelId = (key: string) => `mf-dash-panel-${key}`;

/**
 * The header row of the Dashboard (UX review 2, P4 and R3): the page heading (H1, 20 px), the tab list and, at the right end, the controls
 * projected into it (stale text, Refresh), all on one line from 600 px. The row sticks to the top while the page scrolls (600 px and
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
    <div class="row" data-dash-head>
      <h1 class="h1" data-page-title id="mf-dash-h1">{{ heading() }}</h1>
      @if (showTabs()) {
        <div class="tabs" role="tablist" [attr.aria-label]="label()">
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
      } @else {
        <span class="spacer"></span>
      }
      <!-- Controls that belong to the tab row (for example the Swimlane's refresh icon) sit at its right end, on the same line as the labels. -->
      <div class="end"><ng-content /></div>
    </div>
  `,
  styles: `
    /* Sticky from 600 px while the page scrolls (the fallback below 768 x 561); in the fixed-height layout the row is never scrolled away. */
    :host {
      display: block;
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
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      column-gap: var(--mf-s4);
      box-shadow: inset 0 -1px 0 var(--mf-border);
    }
    .h1 {
      flex: none;
      margin: 0;
      font-size: 20px;
      line-height: 1.25;
      font-weight: 600;
    }
    .spacer {
      flex: 1 1 0;
    }
    @media (max-width: 599px) {
      .h1 {
        flex: 1 0 100%;
        padding-top: var(--mf-s1);
      }
    }
    .end {
      display: flex;
      flex: none;
      align-items: center;
      gap: var(--mf-s2);
    }
    .end:empty {
      display: none;
    }
    .tabs {
      flex: 1 1 0;
      min-width: 0;
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
  protected readonly tabId = tabId;
  protected readonly panelId = panelId;

  readonly tabs = input.required<readonly DashTab[]>();
  readonly selected = input.required<string>();
  readonly label = input('Dashboard views');
  /** The page heading: "Dashboard", or the name of the only tab. */
  readonly heading = input('Dashboard');
  /** False hides the tab list (one permitted tab, or an empty department). */
  readonly showTabs = input(true);
  /** The tab the person chose (click or keyboard). */
  readonly tabChange = output<string>();

  constructor() {
    // On a phone the five tabs scroll sideways: a tab chosen by a link (or a reload) is brought into view.
    effect(() => {
      const key = this.selected();
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>(`[data-tab="${key}"]`)
            ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }),
        { injector: this.injector },
      );
    });
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
    tab?.focus();
    // A focused tab that sits past the edge of a scrolling tab list is brought into view.
    tab?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    this.choose(keys[to]);
  }
}
