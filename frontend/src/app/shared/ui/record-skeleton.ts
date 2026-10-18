import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DRILL_SOURCES, parseFrom } from '../work-queue/drill';
import { DetailLayout } from './detail-layout';
import { Crumb, PageHeader } from './page-header';
import { RecordHeader } from './record-header';
import { RecordKind } from './record-state';
import { MfTab, Tabs } from './tabs';

/**
 * The tabs of the Client, Matter and Project pages: the keys, the visible labels (the document title uses the same labels) and which tabs show a
 * count. The pages and the skeleton both build their tab strip from here, so the skeleton always has the real labels.
 */
const RECORD_TABS = {
  client: [
    { key: 'details', label: 'Overview' },
    { key: 'matters', label: 'Matters', counted: true },
  ],
  matter: [
    { key: 'details', label: 'Overview' },
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
  imports: [RecordHeader, PageHeader, Tabs, DetailLayout, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.rk-task]': "kind() === 'task'" },
  template: `
    <div class="rk" aria-busy="true" data-record-skeleton [attr.data-kind]="kind()">
      <span class="mf-sr-only" role="status" data-loading>Loading {{ kind() }}</span>
      <div class="rk__vis" inert aria-hidden="true">
        @if (kind() === 'task') {
          <ng-container *ngTemplateOutlet="taskTpl" />
        } @else {
          <mf-record-header [kind]="kind()" [parents]="parents()" [skeleton]="true" />
          <mf-tabs
            [label]="kind() + ' sections'"
            idPrefix="rk"
            [tabs]="tabs()"
            [selected]="tab()"
          />
          <ng-container *ngTemplateOutlet="rowsTpl" />
        }
      </div>
    </div>
    <ng-template #taskTpl>
      @if (source(); as src) {
        <p class="rk__back" data-task-back>
          <i class="pi pi-arrow-left" aria-hidden="true"></i> Back to {{ src.label }}
        </p>
      }
      <mf-page-header class="rk__ph" [crumbs]="taskCrumbs()" icon="">
        <span mfTitle class="rk__bar rk__title" data-title-skeleton></span>
        <div class="rk__facts" data-facts-skeleton>
          @for (w of facts; track $index) {
            <span class="rk__bar rk__fact" [style.width.rem]="w"></span>
          }
        </div>
      </mf-page-header>
      <mf-detail-layout [split]="true" [splitKey]="splitKey()">
        <div mfMain>
          <div class="rk__bar rk__h2"></div>
          <ng-container *ngTemplateOutlet="rowsTpl" />
        </div>
        <div mfAside>
          @for (i of [0, 1, 2, 3, 4, 5]; track i) {
            <div class="rk__bar rk__field"></div>
          }
        </div>
      </mf-detail-layout>
    </ng-template>
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
    /* The Task page scrolls as a whole (it is not a fixed-height record page): its skeleton just flows. */
    :host(.rk-task),
    :host(.rk-task) .rk,
    :host(.rk-task) .rk__vis {
      display: block;
      flex: none;
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
    .rk__h2 {
      display: block;
      width: 6rem;
      height: 1.2rem;
      margin-bottom: var(--mf-s3);
    }
    .rk__field {
      display: block;
      width: 80%;
      height: 12px;
      margin: var(--mf-s3) var(--mf-s4);
    }
    .rk__back {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      margin: 0 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .rk__title {
      display: block;
      /* Not a percentage: the title slot shrinks to its content, a percentage would collapse the bar. */
      width: min(24rem, 60vw);
      height: 1.6rem;
    }
    .rk__facts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s4);
      margin-top: var(--mf-s2);
      min-height: 2rem;
    }
    .rk__fact {
      height: 1rem;
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

  /** The Task page's layout share is remembered per person; the page passes its key so the columns are drawn where they will be. */
  readonly splitKey = input('');

  protected readonly rows = ROWS;
  protected readonly facts = [5, 4, 7, 6, 9, 12] as const;
  private readonly route = inject(ActivatedRoute);
  /** The list the Task was opened from (`?from=`), as the real header names it. */
  protected readonly source = computed(() => {
    const from = parseFrom(this.route.snapshot.queryParamMap.get('from'));
    return from ? DRILL_SOURCES[from] : null;
  });
  protected readonly taskCrumbs = computed<Crumb[]>(() => [
    { label: this.source()?.label ?? 'Tasks', link: this.source()?.path ?? '/tasks' },
    { label: '', skeleton: true },
    { label: '', skeleton: true },
  ]);
  protected readonly tabs = computed(() => {
    const kind = this.kind();
    if (kind === 'task') return [];
    return recordTabs(
      kind,
      kind === 'matter'
        ? { tasks: '--', projects: '--' }
        : kind === 'project'
          ? { tasks: '--' }
          : { matters: '--' },
    );
  });
  protected readonly tab = computed(() => {
    const t = this.activeTab();
    return this.tabs().some((x) => x.key === t) ? t : (this.tabs()[0]?.key ?? 'details');
  });
  /** The steps before the current page, from the address; the bars are the parts the record will fill in. */
  protected readonly parents = computed<Crumb[]>(() => {
    switch (this.kind()) {
      case 'task':
        return [];
      case 'client':
        return [{ label: 'Clients', link: '/clients' }];
      case 'matter':
        return [{ label: 'Matters', link: '/matters' }];
      default:
        return [{ label: 'Matters', link: '/matters' }, { label: '' }];
    }
  });
}
