import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { queueParams } from '../dashboard-links';
import { sharePercent } from './bar-list';

/** One segment of the bar (an age band). */
export interface Segment {
  label: string;
  count: number;
  query: string;
}

let nextId = 0;

/**
 * The age bands are an ordered scale, so they use one hue (the brand blue) from light to dark: older is darker, and nothing says "good"
 * or "bad" (no traffic light; the note under the bar says it is not a service-level target). Every fill carries its own text colour at
 * 4.5:1 or more, and a 1px brand-blue edge keeps the pale fills visible against the white card (checked in chart-contrast.spec.ts).
 */
export const AGE_RAMP: readonly { bg: string; fg: string }[] = [
  { bg: '#DCE8F8', fg: '#102A54' },
  { bg: '#A9C6EE', fg: '#102A54' },
  { bg: '#3B6AB4', fg: '#FFFFFF' },
  { bg: '#16356B', fg: '#FFFFFF' },
];

/**
 * One segmented (100% stacked) bar plus a legend (UX `mf-stacked-bar`): the length of a segment is its share of the total. Every segment
 * and every legend row is a link to the Task Queue, the legend states label, count and percent, and "View as table" shows the same numbers.
 */
@Component({
  selector: 'mf-stacked-bar',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [attr.aria-labelledby]="id + '-h'">
      <header>
        <h3 [id]="id + '-h'">{{ heading() }}</h3>
        @if (total() > 0) {
          <button type="button" class="toggle" [attr.aria-pressed]="asTable()" (click)="toggle()">
            {{ asTable() ? 'View as bar' : 'View as table'
            }}<span class="sr-only"> for {{ heading() }}</span>
          </button>
        }
      </header>
      @if (note(); as n) {
        <p class="note">{{ n }}</p>
      }
      @if (total() === 0) {
        <p class="note">{{ emptyText() }}</p>
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
              @for (s of segments(); track $index) {
                <tr>
                  <th scope="row">
                    <a routerLink="/tasks" [queryParams]="params(s.query)">{{ s.label }}</a>
                  </th>
                  <td class="num">{{ s.count }}</td>
                  <td class="num">{{ share(s.count) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div
          class="stack"
          role="list"
          [attr.aria-label]="heading() + ', share of ' + total() + ' tasks'"
        >
          @for (s of segments(); track $index) {
            @if (s.count > 0) {
              <a
                role="listitem"
                class="seg"
                routerLink="/tasks"
                [queryParams]="params(s.query)"
                [style.flex-grow]="s.count"
                [style.background]="ramp($index).bg"
                [style.color]="ramp($index).fg"
                [attr.aria-label]="s.label + ': ' + s.count + ' tasks, ' + share(s.count)"
                [attr.title]="s.label + ': ' + s.count + ' (' + share(s.count) + ')'"
                ><span aria-hidden="true">{{ s.count }}</span></a
              >
            }
          }
        </div>
        <ul class="legend">
          @for (s of segments(); track $index) {
            <li>
              <a
                class="row"
                routerLink="/tasks"
                [queryParams]="params(s.query)"
                [attr.aria-label]="s.label + ': ' + s.count + ' tasks, ' + share(s.count)"
              >
                <span class="swatch" aria-hidden="true" [style.background]="ramp($index).bg"></span>
                <span class="name">{{ s.label }}</span>
                <span class="count">{{ s.count }}</span>
                <span class="pct">{{ share(s.count) }}</span>
              </a>
            </li>
          }
        </ul>
      }
    </section>
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
    .note {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .stack {
      display: flex;
      gap: 2px;
      height: 2rem;
      margin-bottom: var(--mf-s3);
    }
    .seg {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 1.75rem;
      flex-basis: 0;
      overflow: hidden;
      box-shadow: inset 0 0 0 1px var(--mf-primary);
      font-size: var(--mf-fs-sm);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-decoration: none;
      border-radius: var(--mf-radius);
    }
    .seg:hover {
      box-shadow: inset 0 0 0 2px var(--mf-text);
    }
    .legend {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--mf-s1);
    }
    .row {
      display: grid;
      grid-template-columns: 0.875rem 1fr 2.5rem 3rem;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s1) var(--mf-s2);
      border-radius: var(--mf-radius);
      color: var(--mf-text);
      text-decoration: none;
    }
    .row:hover {
      background: var(--mf-selected-bg);
    }
    .swatch {
      width: 0.875rem;
      height: 0.875rem;
      border-radius: 2px;
      box-shadow: inset 0 0 0 1px var(--mf-primary);
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
  `,
})
export class StackedBar {
  readonly heading = input.required<string>();
  readonly segments = input.required<readonly Segment[]>();
  readonly rowHeading = input('Band');
  readonly note = input<string | null>(null);
  readonly emptyText = input('Nothing to show.');

  protected readonly id = `mf-stack-${nextId++}`;
  protected readonly asTable = signal(false);
  protected readonly total = computed(() => this.segments().reduce((sum, s) => sum + s.count, 0));

  protected toggle(): void {
    this.asTable.update((v) => !v);
  }

  protected params(query: string) {
    return queueParams(query);
  }

  protected share(count: number): string {
    return sharePercent(count, this.total());
  }

  protected ramp(index: number): { bg: string; fg: string } {
    return AGE_RAMP[Math.min(index, AGE_RAMP.length - 1)];
  }
}
