import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Crumb } from './page-header';
import { RecordHeader } from './record-header';
import { RecordKind } from './record-state';
import { MfTab, Tabs } from './tabs';

/**
 * The tabs of the Client, Matter and Project pages: the keys, the visible labels (the document title uses the same labels) and which tabs show a
 * count. The pages and the skeleton both build their tab strip from here, so the skeleton always has the real labels.
 */
const RECORD_TABS = {
  client: [
    { key: 'details', label: 'Details' },
    { key: 'matters', label: 'Matters' },
  ],
  matter: [
    { key: 'details', label: 'Details' },
    { key: 'tasks', label: 'Tasks', counted: true },
    { key: 'projects', label: 'Projects', counted: true },
    { key: 'assets', label: 'Assets' },
  ],
  project: [
    { key: 'tasks', label: 'Tasks', counted: true },
    { key: 'details', label: 'Details' },
  ],
} as const;

/**
 * The tab strip of a Client or Matter page. `counts` gives the number (or `--` while loading, or null for none) of the tabs that show one.
 */
export function recordTabs(
  kind: 'client' | 'matter' | 'project',
  counts: Partial<Record<string, number | string | null>> = {},
): MfTab[] {
  return RECORD_TABS[kind].map((t) => {
    const tab: MfTab = { key: t.key, label: t.label };
    if ('counted' in t) tab.count = counts[t.key] === undefined ? 0 : counts[t.key];
    return tab;
  });
}

/** The visible label of a tab (no count), for the document title. */
export function recordTabLabel(kind: 'client' | 'matter' | 'project', key: string): string {
  return RECORD_TABS[kind].find((t) => t.key === key)?.label ?? RECORD_TABS[kind][0].label;
}

const ROWS = [0, 1, 2, 3, 4] as const;

/**
 * What a Client, Matter or Project page shows while its record loads (#247): the page as it will look, without data. The breadcrumb comes
 * from the address (the last step is a grey bar), the title is a bar, the tab strip has the real labels with `--` for counts, and five
 * 44 px rows stand in for the active tab, so nothing moves when the record arrives. The bars are hidden from assistive technology; the region is `aria-busy` and says "Loading client" once.
 * The shimmer is a slow pulse that `prefers-reduced-motion` switches off.
 */
@Component({
  selector: 'mf-record-skeleton',
  imports: [RecordHeader, Tabs, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rk" aria-busy="true" data-record-skeleton [attr.data-kind]="kind()">
      <span class="mf-sr-only" role="status" data-loading>Loading {{ kind() }}</span>
      <div class="rk__vis" inert aria-hidden="true">
        <mf-record-header [kind]="kind()" [parents]="parents()" [skeleton]="true" />
        <mf-tabs [label]="kind() + ' sections'" idPrefix="rk" [tabs]="tabs()" [selected]="tab()" />
        <ng-container *ngTemplateOutlet="rowsTpl" />
      </div>
    </div>
    <ng-template #rowsTpl>
      <div class="rk__rows">
        @for (i of rows; track i) {
          <div class="rk__row"><span class="rk__bar rk__cell"></span></div>
        }
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    @media (min-width: 768px) and (min-height: 561px) {
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      .rk {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      .rk__vis {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
    }
    .rk__bar {
      display: inline-block;
      border-radius: 3px;
      background: var(--mf-border);
      opacity: 0.55;
    }
    .rk__rows {
      border-top: 1px solid var(--mf-border);
    }
    .rk__row {
      display: flex;
      align-items: center;
      box-sizing: border-box;
      height: var(--mf-grid-row-h, 44px);
      padding: 0 var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
      background: var(--mf-surface);
    }
    .rk__cell {
      width: 55%;
      height: 12px;
    }
    @media (prefers-reduced-motion: no-preference) {
      .rk__bar {
        animation: mf-record-pulse 1.4s ease-in-out infinite;
      }
    }
    @keyframes mf-record-pulse {
      50% {
        opacity: 0.3;
      }
    }
  `,
})
export class RecordSkeleton {
  readonly kind = input.required<RecordKind>();
  /** The tab that is open (the address's `tab`); the first tab when it is not one of the page's. */
  readonly activeTab = input('details');

  protected readonly rows = ROWS;
  protected readonly tabs = computed(() => {
    const kind = this.kind();
    return recordTabs(
      kind,
      kind === 'matter'
        ? { tasks: '--', projects: '--' }
        : kind === 'project'
          ? { tasks: '--' }
          : {},
    );
  });
  protected readonly tab = computed(() => {
    const t = this.activeTab();
    return this.tabs().some((x) => x.key === t) ? t : this.tabs()[0].key;
  });
  /** The steps before the current page, from the address; the bars are the parts the record will fill in. */
  protected readonly parents = computed<Crumb[]>(() => {
    switch (this.kind()) {
      case 'client':
        return [{ label: 'Clients', link: '/clients' }];
      case 'matter':
        return [{ label: 'Matters', link: '/matters' }];
      default:
        return [{ label: 'Matters', link: '/matters' }, { label: '' }];
    }
  });
}
