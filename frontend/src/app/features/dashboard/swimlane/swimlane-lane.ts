import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { SwimlaneCard } from '../../../api/generated/api-client';
import { priorityColors } from '../../../shared/ui/priority-badge';
import { DashSkeleton } from '../ui/dash-skeleton';
import { SwimlaneCardView, initials } from './swimlane-card';
import { Density, GroupBy, LANE_HINTS, LaneModel, LaneRow, GroupNode } from './swimlane-model';

/** How many cards a lane draws before "Show more": a lane holds at most 200, and a long board stays quick to draw. */
export const LANE_PAGE = 40;

export interface LaneMove {
  /** Lane code the move starts from. */
  from: string;
  dir: -1 | 1;
  /** Position of the focused item in its lane (the target lane focuses its item at the same position). */
  index: number;
}

let nextId = 0;

/**
 * One lane (column) of the board: a sticky header with the lane name, the exact count and the age of its oldest card, then its own
 * scrolling list of cards. Grouped by priority or assignee, a group header precedes its cards; grouped by client and matter, the lane is a
 * WAI-ARIA tree (`role="tree"`, `treeitem`, `aria-level`, `aria-expanded`) with the client at level 1, the matter at level 2 and the cards
 * at level 3. One item is the lane's tab stop (roving tabindex); arrow keys move between items (see `onKey`).
 */
@Component({
  selector: 'mf-swimlane-lane',
  imports: [DashSkeleton, SwimlaneCardView, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKey($event)',
    '(focusin)': 'onFocusIn($event)',
    '(click)': 'onClick($event)',
  },
  template: `
    @let m = model();
    <section
      class="lane"
      [class.lane--natural]="natural()"
      [attr.aria-labelledby]="hid"
      [attr.data-lane]="m.code"
    >
      <header class="head">
        <h3 class="name" [id]="hid">{{ m.label }}</h3>
        <a
          class="count count--link"
          data-lane-count
          [class.count--caveat]="searching()"
          [routerLink]="['/tasks']"
          [queryParams]="countParams()"
          [attr.aria-label]="countLabel()"
          [attr.title]="searching() ? 'Search text is not included' : 'Open in the Task Queue'"
          >{{ m.count }}</a
        >
        <p class="hint">
          {{ hint }}
          @if (loading() && m.code !== 'COMPLETED') {
            <!-- Holds the room of the age text, so the header keeps its height when the board arrives. -->
            <span class="age age--ghost" aria-hidden="true">· oldest 0d</span>
          } @else if (m.oldestDays !== null && m.code !== 'COMPLETED') {
            <span class="age" data-oldest>
              · oldest {{ m.oldestDays === 0 ? 'today' : m.oldestDays + 'd' }}
            </span>
          }
        </p>
      </header>

      <div class="body" data-lane-body>
        @if (loading()) {
          <!-- Decorative: the board has one "Loading" status (it is aria-busy), not one announcement per lane. -->
          <mf-dash-skeleton kind="lane" [compact]="density() === 'compact'" aria-hidden="true" />
        } @else if (m.rows.length === 0) {
          <p class="empty" data-lane-empty>
            <i class="pi pi-inbox" aria-hidden="true"></i>
            <span>{{ emptyText() }}</span>
          </p>
        } @else {
          @if (!single()) {
            <button type="button" class="skip" data-skip-lane (click)="skipLane.emit(m.code)">
              Skip {{ m.label }} lane
            </button>
          }
          @if (tree()) {
            <ul
              class="rows rows--tree"
              [class.rows--tight]="density() === 'compact'"
              role="tree"
              [attr.aria-label]="m.label + ' tasks by client and matter'"
            >
              @for (row of visibleRows(); track rowKey(row)) {
                @if (row.type === 'group') {
                  <li
                    class="node node--l{{ row.node.level }}"
                    role="treeitem"
                    [attr.aria-level]="row.node.level"
                    [attr.aria-expanded]="row.expanded"
                    [attr.aria-selected]="false"
                    [attr.aria-label]="groupLabel(row.node)"
                    [attr.data-nav]="'group:' + row.node.key"
                    [attr.data-level]="row.node.level"
                    [attr.data-group-kind]="row.node.kind"
                    [attr.tabindex]="tabId() === 'group:' + row.node.key ? 0 : -1"
                  >
                    <i
                      class="pi chevron"
                      [class.pi-chevron-down]="row.expanded"
                      [class.pi-chevron-right]="!row.expanded"
                      aria-hidden="true"
                    ></i>
                    <i
                      class="pi kind"
                      [class.pi-briefcase]="row.node.kind === 'client'"
                      [class.pi-folder]="row.node.kind === 'matter'"
                      aria-hidden="true"
                    ></i>
                    <span class="node-label">
                      @if (row.node.kind === 'client') {
                        <span class="mf-ref">{{ row.node.clientNumber }}</span>
                      } @else {
                        <span class="mf-ref">{{ row.node.matterRef }}</span>
                      }
                      <span class="node-name">{{ row.node.label }}</span>
                    </span>
                    <span class="count count--node" [attr.aria-hidden]="true">{{
                      row.node.count
                    }}</span>
                  </li>
                } @else {
                  <li
                    class="leaf"
                    role="treeitem"
                    [attr.aria-level]="3"
                    [attr.aria-selected]="false"
                    [attr.aria-label]="cardLabel(row.card)"
                    [id]="'sl-item-' + row.card.taskId"
                    [attr.data-nav]="'card:' + row.card.taskId"
                    [attr.data-level]="3"
                    [attr.tabindex]="tabId() === 'card:' + row.card.taskId ? 0 : -1"
                  >
                    <mf-swimlane-card
                      [card]="row.card"
                      [density]="density()"
                      [hideWhere]="true"
                      [navigable]="false"
                      (open)="openCard.emit($event)"
                      (cardChange)="cardChange.emit($event)"
                    />
                  </li>
                }
              }
            </ul>
          } @else {
            <ul class="rows" role="list" [class.rows--tight]="density() === 'compact'">
              @for (row of visibleRows(); track rowKey(row)) {
                @if (row.type === 'group') {
                  <li class="grp" role="listitem">
                    <button
                      type="button"
                      class="grp-btn"
                      [class.grp-btn--priority]="row.node.kind === 'priority'"
                      [attr.data-nav]="'group:' + row.node.key"
                      [attr.data-group-kind]="row.node.kind"
                      [attr.aria-expanded]="row.expanded"
                      [attr.tabindex]="tabId() === 'group:' + row.node.key ? 0 : -1"
                      [style.background]="
                        row.node.kind === 'priority' ? colorsOf(row.node).bg : null
                      "
                      [style.color]="row.node.kind === 'priority' ? colorsOf(row.node).fg : null"
                      (click)="groupToggle.emit(row.node.key)"
                    >
                      <i
                        class="pi chevron"
                        [class.pi-chevron-down]="row.expanded"
                        [class.pi-chevron-right]="!row.expanded"
                        aria-hidden="true"
                      ></i>
                      @if (row.node.kind === 'priority') {
                        <span class="grp-title">{{ row.node.label }}</span>
                      } @else {
                        <span class="avatar" aria-hidden="true">{{
                          row.node.assignee ? initialsOf(row.node.label) : '-'
                        }}</span>
                        <span class="grp-title">{{ row.node.label }}</span>
                        @if (row.node.assignee?.availability?.state === 'OUT_OF_OFFICE') {
                          <span class="chip chip--ooo">
                            <i class="pi pi-calendar-minus" aria-hidden="true"></i>Out of office
                          </span>
                        }
                      }
                      <span class="count count--node"
                        >{{ row.node.count
                        }}<span class="sr-only">
                          {{ row.node.count === 1 ? 'task' : 'tasks' }}</span
                        ></span
                      >
                    </button>
                  </li>
                } @else {
                  <li class="leaf" [class.leaf--in]="row.level > 0">
                    <mf-swimlane-card
                      [card]="row.card"
                      [density]="density()"
                      [hideWho]="groupBy() === 'assignee'"
                      [tabStop]="tabId() === 'card:' + row.card.taskId ? 0 : -1"
                      (open)="openCard.emit($event)"
                      (cardChange)="cardChange.emit($event)"
                    />
                  </li>
                }
              }
            </ul>
          }
          @if (hidden() > 0) {
            <div class="more">
              <button type="button" class="mf-btn" data-show-more (click)="showMore()">
                Show {{ nextChunk() }} more of {{ hidden() }} hidden
              </button>
              <button type="button" class="mf-btn mf-btn--text" data-show-all (click)="showAll()">
                Show all
              </button>
            </div>
          }
          @if (m.truncated) {
            <p class="trunc" data-truncated role="note">
              <i class="pi pi-info-circle" aria-hidden="true"></i>
              <span>
                Showing {{ m.loaded }} of {{ m.count }}.
                <a [routerLink]="['/tasks']" [queryParams]="queueParams()" data-open-queue
                  >Open the Task Queue</a
                >
                to see them all.
              </span>
            </p>
          }
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .lane {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-height: 0;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .head {
      position: sticky;
      top: 0;
      z-index: 2;
      flex: none;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface-alt);
      border-bottom: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg) var(--mf-radius-lg) 0 0;
    }
    .name {
      margin: 0;
      font-size: var(--mf-fs-lg);
    }
    .count {
      display: inline-block;
      min-width: 1.5rem;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface);
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    /* The lane count is a link to the Task Queue (W2): a 24 px target, underlined, with the focus ring of links. */
    .count--link {
      min-height: 24px;
      line-height: 22px;
      box-sizing: border-box;
      color: var(--mf-link);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .count--link:hover {
      border-color: var(--mf-link);
    }
    .count--link:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    /* With search text the target may show other tasks: the link is not drawn as an exact match. */
    .count--caveat {
      border-style: dashed;
      text-decoration-style: dashed;
    }
    /* Phone layout (W4): the only lane shown takes its natural height and the page scrolls; no scroll box of its own, header not sticky. */
    .lane--natural {
      flex: none;
    }
    .lane--natural .head {
      position: static;
    }
    /* On a phone the hint ("Waiting to be started · oldest 14d") has its own line. Beside the name and the count it fitted by a few pixels with
       the placeholder age of the loading state ("oldest 0d") and wrapped as soon as the real age was longer ("oldest 14d", "oldest today"), which
       pushed the whole lane down 15 px when the board arrived (layout shift 0.085 at 375, more with older tasks). */
    .lane--natural .hint {
      flex-basis: 100%;
      text-align: left;
    }
    .lane--natural .body {
      flex: none;
      overflow: visible;
    }
    .age--ghost {
      visibility: hidden;
    }
    .hint {
      flex: 1 1 auto;
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      text-align: right;
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: var(--mf-s2);
      overscroll-behavior: contain;
    }
    .rows {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .rows--tight {
      gap: var(--mf-s1);
    }
    .leaf {
      min-width: 0;
    }
    .rows:not(.rows--tree) .leaf--in {
      margin-left: var(--mf-s2);
    }
    .grp-btn,
    .node {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      width: 100%;
      min-height: 2rem;
      padding: var(--mf-s1) var(--mf-s2);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
      min-width: 0;
    }
    .node {
      align-items: flex-start;
    }
    .node .chevron,
    .node .kind,
    .node .count--node {
      margin-top: 0.15rem;
    }
    .grp-btn--priority {
      border-color: currentColor;
    }
    .grp-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* Tree labels wrap instead of ending in an ellipsis at 260 px lanes (W3); the count stays on the right. */
    .node-label {
      flex: 1;
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.3;
    }
    .node-name {
      margin-left: var(--mf-s1);
    }
    .grp-btn:focus-visible,
    .node:focus-visible,
    .leaf[role='treeitem']:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .count--node {
      flex: none;
      color: var(--mf-text);
    }
    .chevron,
    .kind {
      flex: none;
      font-size: 0.8125rem;
    }
    .kind {
      color: var(--mf-text-muted);
    }
    /* The client > matter tree: each level is indented further (client 0, matter 1, cards 2 steps). */
    .rows--tree .node--l1 {
      margin-top: var(--mf-s1);
      background: var(--mf-surface);
      border-color: var(--mf-border-strong);
    }
    .rows--tree .node--l2 {
      margin-left: var(--mf-s3);
      width: calc(100% - var(--mf-s3));
      font-weight: 500;
    }
    .rows--tree .leaf {
      margin-left: calc(var(--mf-s3) * 2);
      width: calc(100% - var(--mf-s3) * 2);
    }
    .avatar {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      background: var(--mf-selected-bg);
      color: var(--mf-primary);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      flex: none;
      padding: 0 var(--mf-s2);
      border: 1px solid currentColor;
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
      line-height: 1.5;
    }
    .chip--ooo {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
    }
    .empty {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      padding: var(--mf-s4) var(--mf-s2);
      color: var(--mf-text-muted);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
    }
    .trunc {
      display: flex;
      gap: var(--mf-s2);
      margin: var(--mf-s2) 0 0;
      padding: var(--mf-s2);
      color: var(--mf-text);
      background: var(--mf-info-bg);
      border: 1px solid var(--mf-info);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
    }
    .trunc a {
      color: var(--mf-link);
    }
    .more {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      margin-top: var(--mf-s2);
    }
    .skip {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .skip:focus {
      position: static;
      width: auto;
      height: auto;
      margin-bottom: var(--mf-s2);
      overflow: visible;
      clip-path: none;
      padding: var(--mf-s1) var(--mf-s2);
      background: var(--mf-surface);
      color: var(--mf-link);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class SwimlaneLane {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly hid = `mf-lane-${nextId++}`;

  readonly model = input.required<LaneModel>();
  readonly groupBy = input<GroupBy>('none');
  readonly density = input<Density>('comfortable');
  readonly loading = input(false);
  /** The only lane on screen (the phone layout): there is no other lane to skip to. */
  readonly single = input(false);
  /** The lane has its natural height (the page scrolls) instead of a scroll box of its own. */
  readonly natural = input(false);
  /** Why the lane may be empty: filters on, or simply nothing there. */
  readonly filtered = input(false);
  /** Task Queue query parameters that list this lane's tasks (for the truncation note). */
  readonly queueParams = input<Record<string, string | string[]>>({});

  readonly openCard = output<SwimlaneCard>();
  readonly cardChange = output<SwimlaneCard>();
  readonly groupToggle = output<string>();
  readonly laneMove = output<LaneMove>();
  readonly skipLane = output<string>();

  /** Cards drawn so far (grows with "Show more"). */
  private readonly limit = signal(LANE_PAGE);
  private readonly active = signal<string | null>(null);

  protected readonly tree = computed(() => this.groupBy() === 'clientMatter');
  /** The count link carries every filter the Task Queue can show, but not the search text (the link then says so). */
  protected readonly searching = computed(() => 'q' in this.queueParams());
  protected readonly countParams = computed(() => {
    const rest = { ...this.queueParams() };
    delete rest['q'];
    return rest;
  });
  protected readonly countLabel = computed(() => {
    const m = this.model();
    return `${m.count} ${m.label} tasks in the Task Queue${this.searching() ? '. Search text is not included' : ''}`;
  });
  protected get hint(): string {
    return LANE_HINTS[this.model().code];
  }
  protected readonly initialsOf = initials;

  /** Rows up to the card budget; a group header is drawn only together with at least one of its cards. */
  protected readonly visibleRows = computed<LaneRow[]>(() => {
    const rows = this.model().rows;
    const limit = this.limit();
    const out: LaneRow[] = [];
    let cards = 0;
    for (const row of rows) {
      if (row.type === 'card') {
        if (cards >= limit) break;
        cards++;
      } else if (cards >= limit) {
        break;
      }
      out.push(row);
    }
    return out;
  });
  protected readonly hidden = computed(() => {
    const total = this.model().rows.filter((r) => r.type === 'card').length;
    const shown = this.visibleRows().filter((r) => r.type === 'card').length;
    return total - shown;
  });
  protected readonly nextChunk = computed(() => Math.min(LANE_PAGE, this.hidden()));
  protected readonly emptyText = computed(() => {
    const m = this.model();
    if (this.filtered()) return `No ${m.label} tasks match the filters.`;
    return m.code === 'COMPLETED' ? 'Nothing completed in this period.' : `No ${m.label} tasks.`;
  });

  /** The lane's one tab stop: the item last focused, else the first one. */
  protected readonly tabId = computed(() => {
    const ids = this.navIds();
    const a = this.active();
    return a !== null && ids.includes(a) ? a : (ids[0] ?? null);
  });
  private readonly navIds = computed(() =>
    this.visibleRows().map((r) =>
      r.type === 'group' ? `group:${r.node.key}` : `card:${r.card.taskId}`,
    ),
  );

  constructor() {
    // A new lane content (another filter, a refresh) does not reset the budget; a different grouping does.
    effect(() => {
      this.groupBy();
      untracked(() => this.limit.set(LANE_PAGE));
    });
  }

  protected rowKey(row: LaneRow): string {
    return row.type === 'group' ? 'g' + row.node.key : 'c' + row.card.taskId;
  }

  protected colorsOf(node: GroupNode) {
    return priorityColors(node.color);
  }

  protected groupLabel(node: GroupNode): string {
    const head =
      node.kind === 'client'
        ? `${node.label}, client ${node.clientNumber}`
        : `${node.label}, matter ${node.matterRef}`;
    return `${head}, ${node.count} ${node.count === 1 ? 'task' : 'tasks'}`;
  }

  protected cardLabel(card: SwimlaneCard): string {
    return `${card.ref}, ${card.title}, ${card.priority.label} priority`;
  }

  protected showMore(): void {
    this.limit.update((n) => n + LANE_PAGE);
  }

  protected showAll(): void {
    this.limit.set(Number.MAX_SAFE_INTEGER);
  }

  // ---- keyboard

  /** A click on a group row of the tree toggles it (the list modes use real buttons). */
  protected onClick(event: MouseEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>('li[data-nav^="group:"]');
    if (row) this.groupToggle.emit(row.getAttribute('data-nav')!.slice('group:'.length));
  }

  protected onFocusIn(event: FocusEvent): void {
    const el = event.target as HTMLElement;
    if (el.matches?.('[data-nav]')) this.active.set(el.getAttribute('data-nav'));
  }

  private items(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('[data-lane-body] [data-nav]'),
    );
  }

  /** Focuses the item at `index` (clamped), making it the lane's tab stop. */
  focusIndex(index: number): void {
    const items = this.items();
    if (items.length === 0) return;
    this.focusEl(items[Math.max(0, Math.min(items.length - 1, index))]);
  }

  private focusEl(el: HTMLElement | undefined): void {
    if (!el) return;
    this.active.set(el.getAttribute('data-nav'));
    el.focus();
    el.scrollIntoView?.({ block: 'nearest' });
  }

  /**
   * Arrow keys on a lane item (a card title, a group header or a tree item). Up and Down move to the previous and next item, Home and End to the
   * first and last. In the tree, Right opens a closed node or steps into it, Left closes an open node or steps out to its parent; in the other
   * modes Left and Right move to the neighbouring lane. Shift with Left or Right moves between lanes in every mode. Enter or Space on a
   * group toggles it, on a tree card opens it; `m` opens the status menu of the card (the drawer on a one-line card). Keys typed inside a menu or field are left alone.
   */
  protected onKey(event: KeyboardEvent): void {
    const el = event.target as HTMLElement;
    if (!el.matches?.('[data-nav]') || event.ctrlKey || event.metaKey || event.altKey) return;
    const items = this.items();
    const at = items.indexOf(el);
    if (at < 0) return;
    const isGroup = el.getAttribute('data-nav')?.startsWith('group:') === true;
    const level = Number(el.getAttribute('data-level') ?? 0);
    const key = event.key;
    const stop = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (key === 'ArrowDown') {
      stop();
      this.focusEl(items[at + 1]);
    } else if (key === 'ArrowUp') {
      stop();
      this.focusEl(items[at - 1]);
    } else if (key === 'Home') {
      stop();
      this.focusEl(items[0]);
    } else if (key === 'End') {
      stop();
      this.focusEl(items[items.length - 1]);
    } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const dir = key === 'ArrowRight' ? 1 : -1;
      if (event.shiftKey || !this.tree()) {
        stop();
        this.laneMove.emit({ from: this.model().code, dir, index: at });
      } else if (isGroup && dir === 1) {
        stop();
        if (el.getAttribute('aria-expanded') === 'false') this.toggleFocused(el);
        else this.focusEl(items[at + 1]);
      } else if (isGroup && el.getAttribute('aria-expanded') === 'true') {
        stop();
        this.toggleFocused(el);
      } else if (dir === -1) {
        stop();
        // Out to the nearest item above with a lower level (the parent).
        for (let i = at - 1; i >= 0; i--) {
          if (Number(items[i].getAttribute('data-level') ?? 0) < level) {
            this.focusEl(items[i]);
            break;
          }
        }
      }
    } else if (key === 'Enter' || key === ' ') {
      if (!this.tree()) return; // list modes: the buttons do it natively
      if (isGroup) {
        stop();
        this.toggleFocused(el);
      } else {
        stop();
        const id = Number(el.getAttribute('data-nav')?.slice(5));
        const card = this.model().rows.find((r) => r.type === 'card' && r.card.taskId === id);
        if (card?.type === 'card') this.openCard.emit(card.card);
      }
    } else if ((key === 'm' || key === 'M') && !isGroup) {
      stop();
      // The one-line card has no menus: there `m` opens the drawer, where the Status menu is.
      const li = el.closest('li');
      (
        li?.querySelector<HTMLElement>('[data-field="status"] [data-inline-trigger]') ??
        li?.querySelector<HTMLElement>('[data-card-open]')
      )?.click();
    }
  }

  private toggleFocused(el: HTMLElement): void {
    const id = (el.getAttribute('data-nav') ?? '').slice('group:'.length);
    this.groupToggle.emit(id);
    // The row is kept (same key), but make sure it stays the tab stop and holds the focus.
    afterNextRender(
      () => {
        const again = this.host.nativeElement.querySelector<HTMLElement>(
          `[data-lane-body] [data-nav="group:${CSS.escape(id)}"]`,
        );
        if (again && document.activeElement !== again) again.focus();
      },
      { injector: this.injector },
    );
  }
}
