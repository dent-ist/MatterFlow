import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { iconForPath } from '../../../shared/layout/section-icons';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { tabIcon } from '../../../shared/ui/tab-icons';

export interface DashTab {
  key: string;
  label: string;
}

/** Ids tie each tab to its panel (`aria-controls`, `aria-labelledby`); the page renders the panel with `panelId`. */
export const tabId = (key: string) => `mf-dash-tab-${key}`;
/** The one panel of the strip (`mf-tabs` points the selected tab at `<prefix>-panel`). */
export const panelId = () => 'mf-dash-panel';

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
  imports: [Tabs],
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
        <!-- The shared strip (LC-10): icons, counts, overflow cues and the arrow keys are mf-tabs'. -->
        <mf-tabs
          [tabs]="items()"
          [selected]="selected()"
          [label]="label()"
          idPrefix="mf-dash"
          (tabChange)="choose($event)"
        />
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
    /* Below 768 px the shared dropdown (the Scope) is a 44 px target: the row is that tall from the start, so it does not grow by 8 px when the Scope appears. */
    @media (max-width: 767.98px) {
      .end {
        min-height: 44px;
      }
    }
    mf-tabs {
      margin-bottom: 0;
    }
  `,
})
export class DashTabs {
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

  protected readonly items = computed<MfTab[]>(() =>
    this.tabs().map((t) => ({ key: t.key, label: t.label, icon: tabIcon(t.key) })),
  );

  protected choose(key: string): void {
    if (key !== this.selected()) this.tabChange.emit(key);
  }
}
