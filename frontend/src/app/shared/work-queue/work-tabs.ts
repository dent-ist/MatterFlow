import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MfTab, Tabs } from '../ui/tabs';
import { tabIcon } from '../ui/tab-icons';

export interface WorkTab {
  key: string;
  label: string;
  /** Count shown in parentheses; `null` while it is not known yet shows a reserved "(--)", undefined shows none. */
  count?: number | null;
  /** Tooltip: what the tab holds. */
  hint?: string;
}

/**
 * The tabs of My Work and Pod Work: the shared `mf-tabs` strip (LC-10, #1058) with the work lists' own tab shape. The icon comes from the label
 * (`tabIcon`), so the same concept has the same icon on every strip. The page renders the matching `role="tabpanel"` with `id="<idPrefix>-panel"`.
 */
@Component({
  selector: 'mf-work-tabs',
  imports: [Tabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-tabs
      [tabs]="items()"
      [selected]="selected()"
      [label]="label()"
      [idPrefix]="idPrefix()"
      (tabChange)="selectedChange.emit($event)"
    />
  `,
  styles: `
    :host {
      display: block;
    }
    :host ::ng-deep mf-tabs {
      margin-bottom: 0;
    }
  `,
})
export class WorkTabs {
  readonly tabs = input.required<readonly WorkTab[]>();
  readonly selected = input.required<string>();
  readonly label = input('Views');
  /** Prefix of the element ids (`<prefix>-tab-<key>`, and the panel `<prefix>-panel`). */
  readonly idPrefix = input('work');
  readonly selectedChange = output<string>();

  protected readonly items = computed<MfTab[]>(() =>
    this.tabs().map((t) => ({
      key: t.key,
      label: t.label,
      icon: tabIcon(t.label),
      ...(t.count === undefined ? {} : { count: t.count === null ? '--' : t.count }),
      ...(t.hint ? { hint: t.hint } : {}),
    })),
  );
}
