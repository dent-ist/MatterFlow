import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  DRILL_SOURCES,
  RECORD_ORIGINS,
  isRecordOrigin,
  originNav,
  parseOrigin,
} from '../work-queue/drill';
import { DetailLayout } from './detail-layout';
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
    { key: 'details', label: 'Overview' },
    { key: 'matters', label: 'Matters', counted: true },
  ],
  matter: [
    { key: 'details', label: 'Overview' },
    { key: 'tasks', label: 'Tasks', counted: true },
    { key: 'projects', label: 'Projects', counted: true },
    { key: 'assets', label: 'Assets', counted: true },
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
  imports: [RecordHeader, Tabs, DetailLayout, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.rk-task]': "kind() === 'task'" },
  template: `
    <div class="rk" aria-busy="true" data-record-skeleton [attr.data-kind]="kind()">
      <span class="mf-sr-only" role="status" data-loading>Loading {{ noun() }}</span>
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
      <mf-record-header
        kind="task"
        [parents]="taskParents()"
        [backTo]="taskBack()"
        [skeleton]="true"
      />
      <ul class="mf-facts rk__facts" data-facts-skeleton>
        @for (w of facts; track $index) {
          <li class="mf-facts__tile">
            <span class="rk__bar rk__label"></span>
            <span class="rk__bar rk__fact" [style.width.rem]="w"></span>
          </li>
        }
      </ul>
      <mf-detail-layout [split]="true" [splitKey]="splitKey()">
        <div mfTop class="rk__bar rk__nav"></div>
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
    /* The tab strip of the Task page (same box as the dense mf-tabs: 2.5rem tall, 4px below), so nothing moves when the page arrives. */
    .rk__nav {
      display: block;
      width: 16rem;
      max-width: 100%;
      height: 2.5rem;
      margin-bottom: var(--mf-s1);
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
    .rk__facts {
      margin-top: var(--mf-s2);
      margin-bottom: var(--mf-s2);
    }
    @media (max-width: 639px) {
      .rk__facts {
        margin-bottom: var(--mf-s1);
      }
    }
    .rk__label {
      width: 3rem;
      height: 0.75rem;
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
  protected readonly facts = [5, 4, 6, 7, 6, 7] as const;
  private readonly route = inject(ActivatedRoute);
  /** The list the Task was opened from (`?from=`), as the real header names it. */
  private readonly source = computed(() => {
    const from = parseOrigin(this.route.snapshot.queryParamMap.get('from'));
    if (!from) return null;
    // A Matter's, Project's, Dashboard's or Search origin is named by its kind until the task says which one (T9, #324).
    return isRecordOrigin(from)
      ? { label: RECORD_ORIGINS[from].label, path: originNav(from) ?? '/search' }
      : DRILL_SOURCES[from];
  });
  protected readonly taskParents = computed<Crumb[]>(() => [
    { label: this.source()?.label ?? 'Tasks', link: this.source()?.path ?? '/tasks' },
    { label: '' },
  ]);
  protected readonly taskBack = computed(() => {
    const src = this.source();
    return src ? { label: src.label, link: src.path } : { label: 'Tasks', link: '/tasks' };
  });
  protected readonly tabs = computed(() => {
    const kind = this.kind();
    // The Task page has no tab strip; the Administration pages bring theirs with their record pages (the Task Type page: #380).
    if (kind === 'taskType') {
      return [
        { key: 'overview', label: 'Overview' },
        { key: 'workflows', label: 'Workflows', count: '--' },
        { key: 'form', label: 'Request form' },
      ];
    }
    if (kind === 'step') {
      return [
        { key: 'details', label: 'Details' },
        { key: 'inputs', label: 'Inputs' },
        { key: 'used-by', label: 'Used by', count: '--' },
      ];
    }
    if (kind !== 'client' && kind !== 'matter' && kind !== 'project') return [];
    return recordTabs(
      kind,
      kind === 'matter'
        ? { tasks: '--', projects: '--', assets: '--' }
        : kind === 'project'
          ? { tasks: '--' }
          : { matters: '--' },
    );
  });
  /** What the page is called in the loading message: "Loading task type". */
  protected readonly noun = computed(() =>
    this.kind() === 'taskType' ? 'task type' : this.kind(),
  );
  protected readonly tab = computed(() => {
    const t = this.activeTab();
    return this.tabs().some((x) => x.key === t) ? t : (this.tabs()[0]?.key ?? 'details');
  });
  /** The steps before the current page, from the address; the bars are the parts the record will fill in. */
  protected readonly parents = computed<Crumb[]>(() => {
    switch (this.kind()) {
      case 'task':
        return [];
      case 'taskType':
        return [
          { label: 'Administration', plain: true },
          { label: 'Task Types', link: '/admin/task-types' },
          { label: '' },
        ];
      case 'step':
        return [
          { label: 'Administration', plain: true },
          { label: 'Task Types', link: '/admin/task-types' },
          { label: 'Workflow Steps', link: '/admin/steps' },
          { label: '' },
        ];
      case 'client':
        return [{ label: 'Clients', link: '/clients' }];
      case 'matter':
        return [{ label: 'Matters', link: '/matters' }];
      default:
        return [{ label: 'Matters', link: '/matters' }, { label: '' }];
    }
  });
}
