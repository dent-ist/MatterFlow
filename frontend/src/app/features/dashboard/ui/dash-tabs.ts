import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { iconForPath } from '../../../shared/layout/section-icons';
import { PageHeader } from '../../../shared/ui/page-header';
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
  imports: [PageHeader, Tabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head" data-dash-head>
      <!-- The one page header (D-21, #1135): the tile, the H1 and, at the right of the title row, the stale text, Scope and Refresh; the tab list is under the title. -->
      <mf-page-header [heading]="heading()" [icon]="icon" titleId="mf-dash-h1" data-dash-title-row>
        <div mfActions class="end"><ng-content /></div>
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
      </mf-page-header>
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
    .head {
      min-width: 0;
      max-width: 100%;
      box-shadow: inset 0 -1px 0 var(--mf-border);
    }
    mf-page-header {
      margin-bottom: 0;
    }
    /* The stale text, Scope and Refresh sit in the page header's action slot as one group. */
    .end {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s2);
      min-width: 0;
      max-width: 100%;
    }
    .end:empty {
      display: none;
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
    this.tabs().map((t) => ({
      key: t.key,
      label: t.label,
      // The Dashboard's Summary tab has its own icon so it does not repeat the Dashboard tile (pi-home, #1133).
      icon: tabIcon(t.key === 'summary' ? 'dashboard-summary' : t.key),
    })),
  );

  protected choose(key: string): void {
    if (key !== this.selected()) this.tabChange.emit(key);
  }
}
