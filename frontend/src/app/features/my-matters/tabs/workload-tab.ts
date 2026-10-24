import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import {
  MyMattersAwayWindow,
  MyMattersClient,
  MyMattersWorkloadPerson,
  MyMattersWorkloadPod,
} from '../../../api/generated/api-client';
import { Clock } from '../../../core/time/clock';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { shortDate } from '../facts';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { PanelBox } from '../panels/panel-box';

/** The words of an away window: "Away Oct 26 to Oct 30", "Away until Oct 30", "Away from Oct 26" (whole days, never a reason in free text). */
export function awayText(away: MyMattersAwayWindow, year: number): string {
  const from = away.from ? shortDate(away.from, year, '') : '';
  const to = away.to ? shortDate(away.to, year, '') : '';
  if (from && to) return from === to ? `Away ${from}` : `Away ${from} to ${to}`;
  if (to) return `Away until ${to}`;
  if (from) return `Away from ${from}, no end date`;
  return 'Away, no end date';
}

/**
 * Inside a pod: people who are away and hold overdue tasks first, then the order the server gave (a sort, never a verdict: no colour and no
 * word judges the combination). Pure.
 */
export function podPeople(people: readonly MyMattersWorkloadPerson[]): MyMattersWorkloadPerson[] {
  const needsCover = (p: MyMattersWorkloadPerson) => !!p.away && p.overdue > 0;
  return people
    .map((p, index) => ({ p, index }))
    .sort((a, b) => Number(needsCover(b.p)) - Number(needsCover(a.p)) || a.index - b.index)
    .map((x) => x.p);
}

/**
 * Workload tab (epic #758, PX-21; README 6.3): the open work on my matters by pod and person: open (a bar and the number), overdue, due this
 * week and on hold, with the days a person is away in the next four weeks as a text badge. A name opens the Task Queue for that person on these
 * matters, so the numbers equal that list. "Show matters" lists the five matters that hold most of a person's work. Never ranked and no
 * threshold: bars share one scale, nothing says "overloaded". Below 640 px every person is a card.
 */
@Component({
  selector: 'mf-mm-workload-tab',
  imports: [PanelBox, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .wt__table {
      width: 100%;
      border-collapse: collapse;
    }
    .wt__table th,
    .wt__table td {
      padding: var(--mf-s1) var(--mf-s2);
      border-top: 1px solid var(--mf-border);
      text-align: left;
      vertical-align: top;
    }
    .wt__table thead th {
      border-top: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      white-space: nowrap;
    }
    .wt__table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .wt__pod th,
    .wt__pod td {
      font-weight: 700;
      background: var(--mf-surface-alt);
    }
    .wt__person th {
      padding-left: var(--mf-s5);
      font-weight: 400;
    }
    .wt__link {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      color: var(--mf-link);
    }
    .wt__bar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s2);
    }
    .wt__track {
      flex: 0 1 8rem;
      height: 8px;
      min-width: 3rem;
      border-radius: 4px;
      background: var(--mf-border);
    }
    .wt__fill {
      display: block;
      height: 100%;
      border-radius: 4px;
      background: var(--mf-primary);
    }
    .wt__away {
      display: inline-block;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-text-muted);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
    }
    .wt__toggle {
      min-height: 24px;
      margin-left: var(--mf-s2);
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      cursor: pointer;
    }
    .wt__matters {
      margin: var(--mf-s1) 0 0;
      padding: 0;
      list-style: none;
      font-size: var(--mf-fs-sm);
    }
    .wt__matters li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
    .wt__muted {
      color: var(--mf-text-muted);
    }
    .wt__cards {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .wt__card {
      display: grid;
      gap: var(--mf-s1);
      padding: var(--mf-s2) 0;
      border-top: 1px solid var(--mf-border);
    }
    .wt__card--pod {
      font-weight: 700;
    }
    .wt__nums {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s3);
      font-size: var(--mf-fs-sm);
    }
    .wt__empty,
    .wt__note {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .wt__note {
      margin-top: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    @media (max-width: 639.98px) {
      .wt__link,
      .wt__toggle {
        min-height: 44px;
      }
    }
  `,
  template: `
    <mf-mm-panel
      name="workload-tab"
      title="Workload"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      @if (pods().length === 0) {
        <p class="wt__empty" data-empty>No open tasks on these matters.</p>
      } @else if (phone()) {
        <ul class="wt__cards" data-workload-cards>
          @for (pod of pods(); track $index) {
            <li class="wt__card wt__card--pod" data-pod>
              <a class="wt__link" routerLink="/tasks" [queryParams]="params(pod.query)">{{
                podName(pod)
              }}</a>
              <span class="wt__nums"
                ><span>Open {{ pod.open }}</span
                ><span>Overdue {{ pod.overdue }}</span
                ><span>On hold {{ pod.onHold }}</span></span
              >
            </li>
            @for (p of people(pod); track $index) {
              <li class="wt__card" data-person>
                <a class="wt__link" routerLink="/tasks" [queryParams]="params(p.query)">{{
                  personName(p)
                }}</a>
                @if (p.away; as away) {
                  <span class="wt__away" data-away>{{ awayWords(away) }}</span>
                }
                <span class="wt__nums"
                  ><span>Open {{ p.open }}</span
                  ><span>Overdue {{ p.overdue }}</span
                  ><span>Due this week {{ p.dueThisWeek }}</span
                  ><span>On hold {{ p.onHold }}</span></span
                >
                @if (p.matters; as m) {
                  <button
                    type="button"
                    class="wt__toggle"
                    data-matters-toggle
                    [attr.aria-expanded]="isOpen(p)"
                    (click)="toggle(p)"
                  >
                    {{ isOpen(p) ? 'Hide matters' : 'Show matters' }}
                  </button>
                  @if (isOpen(p)) {
                    <ul class="wt__matters" data-matters>
                      @for (x of m.top; track x.matterId) {
                        <li>
                          <a routerLink="/tasks" [queryParams]="params(x.query)"
                            >{{ x.matterRef }} {{ x.matterName }}</a
                          ><span class="wt__muted">Open {{ x.open }}, overdue {{ x.overdue }}</span>
                        </li>
                      }
                      @if (m.otherMatters > 0) {
                        <li class="wt__muted">
                          {{ m.otherMatters }} other matters, {{ m.otherOpen }} open
                        </li>
                      }
                    </ul>
                  }
                }
              </li>
            }
          }
        </ul>
      } @else {
        <table class="wt__table" data-workload-table>
          <caption class="mf-sr-only">
            Open tasks on your matters by pod and person
          </caption>
          <thead>
            <tr>
              <th scope="col">Pod / person</th>
              <th scope="col" class="num">Open</th>
              <th scope="col" class="num">Overdue</th>
              <th scope="col" class="num">Due this week</th>
              <th scope="col" class="num">On hold</th>
              <th scope="col">Away</th>
            </tr>
          </thead>
          <tbody>
            @for (pod of pods(); track $index) {
              <tr class="wt__pod" data-pod>
                <th scope="row">
                  <a class="wt__link" routerLink="/tasks" [queryParams]="params(pod.query)">{{
                    podName(pod)
                  }}</a>
                </th>
                <td class="num">{{ pod.open }}</td>
                <td class="num">{{ pod.overdue }}</td>
                <td class="num"></td>
                <td class="num">{{ pod.onHold }}</td>
                <td></td>
              </tr>
              @for (p of people(pod); track $index) {
                <tr class="wt__person" data-person>
                  <th scope="row">
                    <a class="wt__link" routerLink="/tasks" [queryParams]="params(p.query)">{{
                      personName(p)
                    }}</a>
                    @if (p.matters; as m) {
                      <button
                        type="button"
                        class="wt__toggle"
                        data-matters-toggle
                        [attr.aria-expanded]="isOpen(p)"
                        (click)="toggle(p)"
                      >
                        {{ isOpen(p) ? 'Hide matters' : 'Show matters' }}
                      </button>
                      @if (isOpen(p)) {
                        <ul class="wt__matters" data-matters>
                          @for (x of m.top; track x.matterId) {
                            <li>
                              <a routerLink="/tasks" [queryParams]="params(x.query)"
                                >{{ x.matterRef }} {{ x.matterName }}</a
                              ><span class="wt__muted"
                                >Open {{ x.open }}, overdue {{ x.overdue }}</span
                              >
                            </li>
                          }
                          @if (m.otherMatters > 0) {
                            <li class="wt__muted">
                              {{ m.otherMatters }} other matters, {{ m.otherOpen }} open
                            </li>
                          }
                        </ul>
                      }
                    }
                  </th>
                  <td class="num">
                    <span class="wt__bar">
                      <span class="wt__track" aria-hidden="true"
                        ><span class="wt__fill" [style.width.%]="share(p.open)"></span
                      ></span>
                      {{ p.open }}
                    </span>
                  </td>
                  <td class="num">{{ p.overdue }}</td>
                  <td class="num">{{ p.dueThisWeek }}</td>
                  <td class="num">{{ p.onHold }}</td>
                  <td>
                    @if (p.away; as away) {
                      <span class="wt__away" data-away>{{ awayWords(away) }}</span>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      }
      @if (pods().length > 0) {
        <p class="wt__note">
          Open work on your matters only. Bars share one scale. Away shows the next four weeks.
          People away who hold overdue tasks are listed first in their pod.
        </p>
      }
    </mf-mm-panel>
  `,
})
export class WorkloadTab {
  readonly filters = input.required<MmFilters>();

  private readonly api = inject(MyMattersClient);
  private readonly clock = inject(Clock);
  protected readonly phone = phoneCards();
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  protected readonly loader = panelLoader(
    () => this.filters(),
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersWorkload(
        'matters',
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  protected readonly pods = computed(() => this.loader.data()?.pods ?? []);
  /** The most open tasks any one person holds: the scale all bars share. */
  private readonly most = computed(() =>
    Math.max(1, ...this.pods().flatMap((p) => p.people.map((x) => x.open))),
  );

  protected podName(p: MyMattersWorkloadPod): string {
    return p.podName ?? 'No pod';
  }

  protected personName(p: MyMattersWorkloadPerson): string {
    return p.displayName ?? 'Not assigned to a person';
  }

  protected people(pod: MyMattersWorkloadPod): MyMattersWorkloadPerson[] {
    return podPeople(pod.people);
  }

  protected share(open: number): number {
    return Math.round((open / this.most()) * 100);
  }

  protected awayWords(away: MyMattersAwayWindow): string {
    return awayText(away, new Date(this.clock.now()).getFullYear());
  }

  protected params(query: string): Params {
    return queryToParams(query);
  }

  protected key(p: MyMattersWorkloadPerson): string {
    return String(p.userId ?? 'none') + ':' + p.query;
  }

  protected isOpen(p: MyMattersWorkloadPerson): boolean {
    return this.opened().has(this.key(p));
  }

  protected toggle(p: MyMattersWorkloadPerson): void {
    const next = new Set(this.opened());
    if (!next.delete(this.key(p))) next.add(this.key(p));
    this.opened.set(next);
  }
}
