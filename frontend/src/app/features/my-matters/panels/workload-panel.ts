import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersClient } from '../../../api/generated/api-client';
import { AvailabilityChip } from '../../../shared/availability/availability-chip';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { PanelBox } from './panel-box';

type SortKey = 'name' | 'open' | 'overdue' | 'onHold';

interface Line {
  key: string;
  level: 'pod' | 'person';
  name: string;
  open: number;
  overdue: number;
  onHold: number;
  query: string;
  availability: unknown;
}

/** The API leaves a missing id out or sends null; both mean "none". */
const none = (v: unknown): boolean => v === undefined || v === null;

/** How many lines a phone shows before "Show all" (README 9). */
export const PHONE_LINES = 5;

/**
 * Workload and capacity (README 6.4): the open tasks on the viewer's matters by pod, then person, with an "out of office" chip while the
 * person is away (the assignee picker's words). Alphabetical until the viewer sorts; never ranked, no colours for a high load and no
 * "overloaded" label. A name opens the Task Queue for that person (or pod) on these matters, so the numbers equal that list. People with
 * no open work here are not listed. Below 640 px the lines are a list, the first five with "Show all".
 */
@Component({
  selector: 'mf-mm-workload',
  imports: [AvailabilityChip, PanelBox, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .wl__table {
      width: 100%;
      border-collapse: collapse;
    }
    .wl__table th,
    .wl__table td {
      padding: var(--mf-s1) var(--mf-s2);
      border-top: 1px solid var(--mf-border);
      text-align: left;
    }
    .wl__table thead th {
      border-top: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      white-space: nowrap;
    }
    .wl__table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .wl__pod th,
    .wl__pod td {
      font-weight: 700;
    }
    .wl__person th {
      padding-left: var(--mf-s5);
      font-weight: 400;
    }
    .wl__sort {
      display: inline-flex;
      gap: var(--mf-s1);
      align-items: center;
      min-height: 24px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .wl__sort:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .wl__sort .pi {
      font-size: 0.75rem;
    }
    .wl__table a,
    .wl__name {
      display: inline-block;
      min-height: 24px;
      line-height: 24px;
    }
    .wl__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .wl__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .wl__item {
      display: grid;
      gap: 2px;
      min-height: 44px;
      padding: var(--mf-s1) 0;
      border-top: 1px solid var(--mf-border);
    }
    .wl__item--person {
      padding-left: var(--mf-s4);
    }
    .wl__name {
      font-weight: 700;
    }
    .wl__item--person .wl__name {
      font-weight: 400;
    }
    .wl__nums {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .wl__more {
      min-height: 44px;
      margin-top: var(--mf-s1);
    }
    @media (max-width: 639.98px) {
      .wl__name {
        display: flex;
        align-items: center;
        min-height: 44px;
      }
    }
    .wl__note {
      margin: var(--mf-s2) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <mf-mm-panel
      name="workload"
      title="Workload and capacity"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      @if (lines().length === 0) {
        <p class="wl__empty" data-empty>No open tasks on these matters.</p>
      } @else if (asList()) {
        <ul class="wl__list" data-workload-list>
          @for (l of visible(); track l.key) {
            <li class="wl__item" [class.wl__item--person]="l.level === 'person'" data-workload-line>
              <a class="wl__name" [routerLink]="['/tasks']" [queryParams]="params(l.query)">{{
                l.name
              }}</a>
              <span class="wl__nums"
                >Open {{ l.open }} . Overdue {{ l.overdue }} . On hold {{ l.onHold }}</span
              >
              @if (l.availability) {
                <mf-availability-chip [availability]="$any(l.availability)" />
              }
            </li>
          }
        </ul>
        @if (lines().length > visible().length) {
          <button type="button" class="mf-btn wl__more" data-show-all (click)="expanded.set(true)">
            Show all {{ lines().length }}
          </button>
        }
      } @else {
        <table class="wl__table" data-workload-table>
          <caption class="mf-sr-only">
            Open tasks on your matters by pod and person, sorted by
            {{
              sortLabel()
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col" [attr.aria-sort]="ariaSort('name')">
                <button type="button" class="wl__sort" data-sort="name" (click)="sortBy('name')">
                  Pod / person
                  @if (sort() === 'name') {
                    <i
                      class="pi"
                      [class.pi-arrow-up]="dir() === 'asc'"
                      [class.pi-arrow-down]="dir() === 'desc'"
                      aria-hidden="true"
                    ></i>
                  }
                </button>
              </th>
              <th scope="col" class="num" [attr.aria-sort]="ariaSort('open')">
                <button type="button" class="wl__sort" data-sort="open" (click)="sortBy('open')">
                  Open
                  @if (sort() === 'open') {
                    <i
                      class="pi"
                      [class.pi-arrow-up]="dir() === 'asc'"
                      [class.pi-arrow-down]="dir() === 'desc'"
                      aria-hidden="true"
                    ></i>
                  }
                </button>
              </th>
              <th scope="col" class="num" [attr.aria-sort]="ariaSort('overdue')">
                <button
                  type="button"
                  class="wl__sort"
                  data-sort="overdue"
                  (click)="sortBy('overdue')"
                >
                  Overdue
                  @if (sort() === 'overdue') {
                    <i
                      class="pi"
                      [class.pi-arrow-up]="dir() === 'asc'"
                      [class.pi-arrow-down]="dir() === 'desc'"
                      aria-hidden="true"
                    ></i>
                  }
                </button>
              </th>
              <th scope="col" class="num" [attr.aria-sort]="ariaSort('onHold')">
                <button
                  type="button"
                  class="wl__sort"
                  data-sort="onHold"
                  (click)="sortBy('onHold')"
                >
                  On hold
                  @if (sort() === 'onHold') {
                    <i
                      class="pi"
                      [class.pi-arrow-up]="dir() === 'asc'"
                      [class.pi-arrow-down]="dir() === 'desc'"
                      aria-hidden="true"
                    ></i>
                  }
                </button>
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (l of lines(); track l.key) {
              <tr
                [class.wl__pod]="l.level === 'pod'"
                [class.wl__person]="l.level === 'person'"
                data-workload-line
              >
                <th scope="row">
                  <a [routerLink]="['/tasks']" [queryParams]="params(l.query)">{{ l.name }}</a>
                </th>
                <td class="num">{{ l.open }}</td>
                <td class="num">{{ l.overdue }}</td>
                <td class="num">{{ l.onHold }}</td>
                <td>
                  @if (l.availability) {
                    <mf-availability-chip [availability]="$any(l.availability)" />
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      <p class="wl__note">People with no open work on these matters are not listed.</p>
    </mf-mm-panel>
  `,
})
export class WorkloadPanel {
  readonly filters = input.required<MmFilters>();
  private readonly api = inject(MyMattersClient);
  protected readonly phone = phoneCards();
  /** The table needs the room of the wide layout (1100 px and up, where the panel is half the page); below that the lines are a list. */
  private readonly wide = viewportAtLeast(1100);
  protected readonly asList = computed(() => !this.wide());
  protected readonly expanded = signal(false);
  protected readonly sort = signal<SortKey>('name');
  protected readonly dir = signal<'asc' | 'desc'>('asc');
  protected readonly params = queryToParams;

  protected readonly loader = panelLoader(
    () => this.filters(),
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersWorkload(
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  /** Pod lines, each followed by its people ("Not assigned to a person" first), in the order the viewer chose (alphabetical by default). */
  protected readonly lines = computed<Line[]>(() => {
    const d = this.loader.data();
    if (!d) return [];
    const sign = this.dir() === 'asc' ? 1 : -1;
    const cmp = (
      a: { name: string; open: number; overdue: number; onHold: number },
      b: typeof a,
    ) => {
      const k = this.sort();
      const diff = k === 'name' ? a.name.localeCompare(b.name) : a[k] - b[k];
      return sign * (diff || a.name.localeCompare(b.name));
    };
    const podLines = d.pods.map((p) => ({
      name: p.podName ?? 'No pod',
      open: p.open,
      overdue: p.overdue,
      onHold: p.onHold,
      pod: p,
    }));
    const orderedPods = [...podLines].sort((a, b) => {
      // The group of tasks with no pod stays last, as the API lists it.
      if (none(a.pod.podId) && !none(b.pod.podId)) return 1;
      if (none(b.pod.podId) && !none(a.pod.podId)) return -1;
      return cmp(a, b);
    });
    const out: Line[] = [];
    for (const p of orderedPods) {
      out.push({
        key: 'pod-' + (p.pod.podId ?? 'none'),
        level: 'pod',
        name: p.name,
        open: p.open,
        overdue: p.overdue,
        onHold: p.onHold,
        query: p.pod.query,
        availability: null,
      });
      const people = p.pod.people.map((x) => ({
        raw: x,
        name: x.displayName ?? 'Not assigned to a person',
        open: x.open,
        overdue: x.overdue,
        onHold: x.onHold,
      }));
      people.sort((a, b) => {
        if (none(a.raw.userId) && !none(b.raw.userId)) return -1;
        if (none(b.raw.userId) && !none(a.raw.userId)) return 1;
        return cmp(a, b);
      });
      for (const x of people) {
        out.push({
          key: `person-${p.pod.podId ?? 'none'}-${x.raw.userId ?? 'none'}`,
          level: 'person',
          name: x.name,
          open: x.open,
          overdue: x.overdue,
          onHold: x.onHold,
          query: x.raw.query,
          availability: x.raw.availability ?? null,
        });
      }
    }
    return out;
  });

  protected readonly visible = computed(() =>
    this.expanded() || !this.phone() ? this.lines() : this.lines().slice(0, PHONE_LINES),
  );

  protected sortLabel(): string {
    return this.sort() === 'onHold' ? 'on hold' : this.sort();
  }

  protected ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sort() !== key) return 'none';
    return this.dir() === 'asc' ? 'ascending' : 'descending';
  }

  protected sortBy(key: SortKey): void {
    if (this.sort() === key) this.dir.set(this.dir() === 'asc' ? 'desc' : 'asc');
    else {
      this.sort.set(key);
      this.dir.set(key === 'name' ? 'asc' : 'desc');
    }
  }
}
