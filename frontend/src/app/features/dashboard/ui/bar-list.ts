import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { queueParams } from '../dashboard-links';
import {
  BarStroke,
  NORMAL_STROKE,
  OVERDUE_CSS,
  overdueParams,
  overdueShare,
  overdueText,
  strokeFill,
} from './breakdown-overdue';

/** One bar: a text label, its number, and the Task Queue query it drills into (null: not linkable). */
export interface BarItem {
  label: string;
  count: number;
  query?: string | null;
  /** Status code or other token that picks the bar color; default is the primary color. */
  tone?: string | null;
  muted?: boolean;
  /** Explicit bar fill and outline (CSS colours), for example the badge colours of a priority. */
  fill?: string | null;
  outline?: string | null;
  /** Task Type icon key (task type breakdown only); drawn before the label, neutral colour. */
  iconKey?: string | null;
  /** How many of `count` are overdue (Breakdowns B1): the bar gets an overdue segment and the row a "N overdue" link; undefined: no split. */
  overdue?: number;
  /** Outline style of a coloured bar (Normal solid, Low dotted); default solid. */
  stroke?: BarStroke;
}

/** "42%", or "<1%" for a small non-zero share; no decimals, so a list can add up to 99 or 101. */
export function sharePercent(count: number, total: number): string {
  if (total <= 0 || count <= 0) return '0%';
  const value = (count / total) * 100;
  return value < 1 ? '<1%' : `${Math.round(value)}%`;
}

let nextId = 0;

/**
 * Accessible horizontal bar list (UX `BarListChart`): every bar has its label, count and share of the total as text, so color is never
 * the only carrier, and "View as table" swaps the bars for a plain table of the same numbers. The longest bar fills the track, the others
 * are in proportion to it, and the percentage next to each is its share of all tasks in the list. Rows with a query are links to the Task Queue.
 */
@Component({
  selector: 'mf-bar-list',
  imports: [RouterLink, TaskTypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [attr.aria-labelledby]="id + '-h'">
      <header>
        <h3 [id]="id + '-h'">{{ heading() }}</h3>
        @if (items().length > 0) {
          <button type="button" class="toggle" [attr.aria-pressed]="asTable()" (click)="toggle()">
            {{ asTable() ? 'View as bars' : 'View as table'
            }}<span class="sr-only"> for {{ heading() }}</span>
          </button>
        }
      </header>
      @if (note(); as n) {
        <p class="note">{{ n }}</p>
      }
      @if (items().length === 0) {
        <p class="empty">{{ emptyText() }}</p>
      } @else if (asTable()) {
        <div class="mf-scroll">
          <table>
            <caption class="sr-only">
              {{
                heading()
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ rowHeading() }}</th>
                <th scope="col" class="num">Tasks</th>
                @if (hasOverdue()) {
                  <th scope="col" class="num">Overdue</th>
                }
                <th scope="col" class="num">Share</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track $index) {
                <tr>
                  <th scope="row">
                    @if (item.fill) {
                      <span class="marker" aria-hidden="true" [style]="markerStyle(item)"></span>
                    }
                    @if (item.query; as q) {
                      @if (item.iconKey) {
                        <mf-task-type-icon [iconKey]="item.iconKey" size="sm" />
                      }
                      <a routerLink="/tasks" [queryParams]="params(q)">{{ item.label }}</a>
                    } @else {
                      {{ item.label }}
                    }
                  </th>
                  <td class="num">{{ item.count }}</td>
                  @if (hasOverdue()) {
                    <td class="num">
                      @if ((item.overdue ?? 0) > 0 && overdueLink(item); as od) {
                        <a routerLink="/tasks" [queryParams]="od">{{ item.overdue }}</a>
                      } @else {
                        {{ item.overdue ?? 0 }}
                      }
                    </td>
                  }
                  <td class="num">{{ share(item.count) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <ul class="bars">
          @for (item of items(); track $index) {
            <li class="r">
              <div class="row">
                <span class="namecell">
                  @if (item.iconKey) {
                    <mf-task-type-icon class="ti" [iconKey]="item.iconKey" size="md" />
                  }
                  @if (item.query; as q) {
                    <a
                      class="name rowlink"
                      routerLink="/tasks"
                      [queryParams]="params(q)"
                      [attr.aria-label]="rowLabel(item)"
                      >{{ item.label }}</a
                    >
                  } @else {
                    <span class="name">{{ item.label }}</span>
                  }
                </span>
                <span class="track" aria-hidden="true">
                  @if (item.count > 0) {
                    <span
                      class="bar"
                      [class.muted]="item.muted"
                      [style.width.%]="width(item.count)"
                      [style.background]="barFill(item)"
                      [style.border-color]="item.outline ?? null"
                      [style.border-style]="item.outline ? (item.stroke ?? normal).style : null"
                      [style.border-width.px]="item.outline ? (item.stroke ?? normal).width : null"
                      [class.outlined]="!!item.outline"
                    >
                      @if ((item.overdue ?? 0) > 0) {
                        @if (overdueLink(item); as od) {
                          <a
                            class="od"
                            tabindex="-1"
                            routerLink="/tasks"
                            [queryParams]="od"
                            [style.width.%]="overdueWidth(item)"
                          ></a>
                        } @else {
                          <span class="od" [style.width.%]="overdueWidth(item)"></span>
                        }
                      }
                    </span>
                  }
                </span>
                <span class="count">{{ item.count }}</span>
                <span class="pct">{{ share(item.count) }}</span>
                @if ((item.overdue ?? 0) > 0) {
                  @if (overdueLink(item); as od) {
                    <a class="od-text" routerLink="/tasks" [queryParams]="od"
                      >{{ odText(item) }}<span class="sr-only"> in {{ item.label }}</span></a
                    >
                  } @else {
                    <span class="od-text plain">{{ odText(item) }}</span>
                  }
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [
    OVERDUE_CSS,
    `
      :host {
        display: block;
      }
      .card {
        height: 100%;
        box-sizing: border-box;
        padding: var(--mf-s4);
        background: var(--mf-surface);
        border: 1px solid var(--mf-border);
        border-radius: var(--mf-radius-lg);
        container-type: inline-size;
      }
      header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--mf-s3);
        margin-bottom: var(--mf-s3);
      }
      h3 {
        margin: 0;
        font-size: var(--mf-fs-lg);
      }
      .toggle {
        background: none;
        border: 0;
        padding: 0;
        color: var(--mf-link);
        font: inherit;
        font-size: var(--mf-fs-sm);
        cursor: pointer;
        text-decoration: underline;
      }
      .note,
      .empty {
        margin: 0 0 var(--mf-s3);
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .bars {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: var(--mf-s1);
      }
      .r {
        position: relative;
        border-radius: var(--mf-radius);
      }
      .r:hover {
        background: var(--mf-selected-bg);
      }
      .row {
        display: grid;
        grid-template-columns: minmax(5rem, 11rem) minmax(3rem, 1fr) 2.25rem 2.75rem 5.5rem;
        align-items: center;
        gap: var(--mf-s3);
        padding: var(--mf-s1) var(--mf-s2);
        color: var(--mf-text);
      }
      /* The whole row is the link to the queue (stretched over the row); the overdue segment and text sit above it. */
      .rowlink {
        color: inherit;
        text-decoration: none;
      }
      .rowlink::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: var(--mf-radius);
      }
      .rowlink:focus-visible {
        outline: none;
      }
      .rowlink:focus-visible::after {
        outline: 2px solid var(--mf-focus);
        outline-offset: -2px;
      }
      .row .od,
      .row .od-text {
        position: relative;
        z-index: 1;
      }
      .od-text.plain {
        text-decoration: none;
      }
      .od-text {
        justify-self: start;
        min-height: 24px;
        display: inline-flex;
        align-items: center;
      }
      /* A narrow card (four across at 1360 px, or a phone): the overdue text moves under the bar. */
      @container (max-width: 30rem) {
        .row {
          grid-template-columns: minmax(4rem, 6.5rem) minmax(3rem, 1fr) 2rem 2.5rem;
          gap: var(--mf-s1) var(--mf-s2);
        }
        .od-text {
          grid-column: 2 / -1;
        }
      }
      /* Long names wrap to a second line instead of being cut off (a title attribute is not reachable by touch or keyboard). */
      .name {
        min-width: 0;
        overflow-wrap: anywhere;
        font-size: var(--mf-fs-md);
        line-height: 1.25;
      }
      .namecell {
        display: flex;
        align-items: flex-start;
        gap: var(--mf-s2);
        min-width: 0;
      }
      .ti {
        margin-top: 1px;
        color: var(--mf-text-muted);
      }
      .track {
        display: block;
        height: 12px;
        background: var(--mf-surface-alt);
        border-radius: var(--mf-radius);
        overflow: hidden;
      }
      .bar {
        display: flex;
        justify-content: flex-end;
        box-sizing: border-box;
        height: 100%;
        min-width: 2px;
        overflow: hidden;
        background: var(--mf-primary);
        border-radius: var(--mf-radius);
      }
      .bar .od {
        flex: none;
        height: 100%;
      }
      .bar.muted {
        background: var(--mf-border-strong);
      }
      .bar.outlined {
        border: 1px solid;
      }
      .count {
        text-align: right;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .pct {
        text-align: right;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
        font-variant-numeric: tabular-nums;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: var(--mf-s1) var(--mf-s2);
        text-align: left;
        font-weight: 400;
        border-bottom: 1px solid var(--mf-border);
      }
      thead th {
        font-weight: 600;
        font-size: var(--mf-fs-sm);
        background: var(--mf-surface-alt);
      }
      .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .marker {
        display: inline-block;
        width: 0.875rem;
        height: 0.5rem;
        margin-right: var(--mf-s2);
        vertical-align: middle;
        box-sizing: border-box;
        border-radius: 2px;
      }
    `,
  ],
})
export class BarList {
  readonly heading = input.required<string>();
  readonly items = input.required<readonly BarItem[]>();
  /** First column heading of the table view, e.g. "Pod". */
  readonly rowHeading = input('Name');
  readonly note = input<string | null>(null);
  readonly emptyText = input('Nothing to show.');

  protected readonly id = `mf-bars-${nextId++}`;
  protected readonly normal = NORMAL_STROKE;
  protected readonly asTable = signal(false);
  protected readonly total = computed(() => this.items().reduce((sum, i) => sum + i.count, 0));
  private readonly max = computed(() => Math.max(0, ...this.items().map((i) => i.count)));

  /** True when the rows carry an overdue figure (the table gets its column). */
  protected readonly hasOverdue = computed(() => this.items().some((i) => i.overdue !== undefined));

  protected toggle(): void {
    this.asTable.update((v) => !v);
  }

  /** The longest bar fills the track; the others are in proportion to it. The share of all tasks is printed as text next to the bar. */
  protected width(count: number): number {
    const max = this.max();
    return max > 0 ? Math.max(1, Math.round((count / max) * 100)) : 0;
  }

  protected share(count: number): string {
    return sharePercent(count, this.total());
  }

  protected params(query: string) {
    return queueParams(query);
  }

  protected overdueLink(item: BarItem) {
    return overdueParams(item.query);
  }

  protected odText(item: BarItem): string {
    return overdueText(item.overdue ?? 0);
  }

  protected overdueWidth(item: BarItem): number {
    return overdueShare(item.overdue ?? 0, item.count);
  }

  protected rowLabel(item: BarItem): string {
    return `${item.label}: ${item.count} tasks, ${this.share(item.count)}`;
  }

  protected barFill(item: BarItem): string | null {
    if (item.muted) return null;
    const fill = item.fill ?? this.color(item.tone);
    return strokeFill(fill, item.stroke ?? NORMAL_STROKE);
  }

  protected markerStyle(item: BarItem): Record<string, string> {
    const stroke = item.stroke ?? NORMAL_STROKE;
    return {
      background: strokeFill(item.fill ?? 'transparent', stroke),
      border: `${stroke.width}px ${stroke.style} ${item.outline ?? 'currentColor'}`,
    };
  }

  protected color(tone: string | null | undefined): string {
    switch (tone) {
      case 'NEW':
        return 'var(--mf-st-new-fg)';
      case 'IN_PROGRESS':
        return 'var(--mf-st-progress-fg)';
      case 'ON_HOLD':
        return 'var(--mf-st-hold-fg)';
      default:
        return 'var(--mf-primary)';
    }
  }
}
