import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { queueParams } from '../dashboard-links';

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
  imports: [RouterLink, NgTemplateOutlet, TaskTypeIcon],
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
                <th scope="col" class="num">Share</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track $index) {
                <tr>
                  <th scope="row">
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
                  <td class="num">{{ share(item.count) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <ul class="bars">
          @for (item of items(); track $index) {
            <li>
              @if (item.query; as q) {
                <a class="row" routerLink="/tasks" [queryParams]="params(q)">
                  <ng-container
                    *ngTemplateOutlet="rowBody; context: { $implicit: item }"
                  ></ng-container>
                </a>
              } @else {
                <div class="row">
                  <ng-container
                    *ngTemplateOutlet="rowBody; context: { $implicit: item }"
                  ></ng-container>
                </div>
              }
            </li>
          }
        </ul>
      }
    </section>

    <ng-template #rowBody let-item>
      <span class="namecell">
        @if (item.iconKey) {
          <mf-task-type-icon class="ti" [iconKey]="item.iconKey" size="sm" />
        }
        <span class="name">{{ item.label }}</span>
      </span>
      <span class="track" aria-hidden="true">
        @if (item.count > 0) {
          <span
            class="bar"
            [class.muted]="item.muted"
            [style.width.%]="width(item.count)"
            [style.background]="item.muted ? null : (item.fill ?? color(item.tone))"
            [style.border-color]="item.outline ?? null"
            [class.outlined]="!!item.outline"
          ></span>
        }
      </span>
      <span class="count">{{ item.count }}</span>
      <span class="pct">{{ share(item.count) }}</span>
    </ng-template>
  `,
  styles: `
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
    .row {
      display: grid;
      grid-template-columns: minmax(6rem, 12rem) 1fr 2.5rem 3rem;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s1) var(--mf-s2);
      border-radius: var(--mf-radius);
      color: var(--mf-text);
      text-decoration: none;
    }
    a.row:hover {
      background: var(--mf-selected-bg);
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
      display: block;
      height: 100%;
      min-width: 2px;
      background: var(--mf-primary);
      border-radius: var(--mf-radius);
    }
    .bar.muted {
      background: var(--mf-border-strong);
    }
    .bar.outlined {
      box-sizing: border-box;
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
    @media (max-width: 480px) {
      .row {
        grid-template-columns: minmax(4.5rem, 6.5rem) 1fr 2rem 2.5rem;
        gap: var(--mf-s2);
      }
    }
  `,
})
export class BarList {
  readonly heading = input.required<string>();
  readonly items = input.required<readonly BarItem[]>();
  /** First column heading of the table view, e.g. "Pod". */
  readonly rowHeading = input('Name');
  readonly note = input<string | null>(null);
  readonly emptyText = input('Nothing to show.');

  protected readonly id = `mf-bars-${nextId++}`;
  protected readonly asTable = signal(false);
  protected readonly total = computed(() => this.items().reduce((sum, i) => sum + i.count, 0));
  private readonly max = computed(() => Math.max(0, ...this.items().map((i) => i.count)));

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
