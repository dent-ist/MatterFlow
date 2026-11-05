import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';
import {
  ABSENCE_TYPE_ICONS,
  ABSENCE_TYPE_LABELS,
} from '../../../shared/availability/absences/absence-contract';
import { STATE_META, CapacityState } from '../../../shared/availability/capacity-state';
import { CALENDAR_API } from './calendar-api';
import { CalQuery, CoverageLevel, DayPanel, DayPerson, RoleGroup } from './calendar-contract';
import { levelClass } from './calendar-month-grid';
import { LEVELS, longDay } from './calendar-model';
import { IntPipe } from '../../../shared/ui/number-format';

type LoadState = 'loading' | 'ready' | 'error';

/** The capacity word of a person by open tasks (decision AS: 0 Available, 1 Occupied, 2 Busy, 3 or more Overloaded). */
export function loadState(load: number): CapacityState {
  return load <= 0 ? 'AVAILABLE' : load === 1 ? 'OCCUPIED' : load === 2 ? 'BUSY' : 'OVERLOADED';
}

/** People whose name contains the text (case-insensitive); groups left without people are dropped, the server's group order is kept. */
export function filterGroups(groups: readonly RoleGroup[], text: string): RoleGroup[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return [...groups];
  return groups
    .map((g) => ({
      ...g,
      people: g.people.filter((p) => p.displayName.toLowerCase().includes(needle)),
    }))
    .filter((g) => g.people.length > 0);
}

export const countPeople = (groups: readonly RoleGroup[]): number =>
  groups.reduce((n, g) => n + g.people.length, 0);

/**
 * The day panel of the Dashboard Calendar (epic #1074, CAL-08), read-only: the date and its holidays by category, four counts (Available, Out of office, On holiday, Off hours),
 * coverage by pod with the level as icon and word, then two searchable lists, AVAILABLE and UNAVAILABLE, each grouped by Role in the server's order and sorted by workload exactly as the
 * server returns them (Available: lightest load first, who can take work; Unavailable: heaviest first, whose work needs cover). A row has the name, the pod, the open-task count (a bare
 * number) and a state chip; an unavailable person also has the reason (Out of office, Holiday, Not working), the day they are back and, only when the server sent it (the viewer holds
 * Dashboard.ViewAbsenceReasons), the type of absence. No note, task title or matter appears here. Desktop: docked at the right; 768 to 1023 px a slide-over; a phone a bottom sheet.
 */
@Component({
  selector: 'mf-cal-panel',
  imports: [IntPipe, NumericDatePipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './calendar-coverage.scss',
  host: { '(keydown.escape)': 'closed.emit()' },
  template: `
    <div
      class="pn"
      role="dialog"
      aria-modal="false"
      [attr.aria-label]="longDay(date())"
      data-cal-panel
    >
      <header class="hd">
        <div class="hd__t">
          <h2 class="h2" data-panel-date>{{ longDay(date()) }}</h2>
          @if (isToday()) {
            <span class="tdy">Today</span>
          }
          @if (panel(); as p) {
            <p class="sub">{{ p.counts.total | mfInt }} people in view</p>
          }
        </div>
        <button
          type="button"
          class="x"
          data-panel-close
          aria-label="Close the day panel"
          (click)="closed.emit()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </header>

      <div class="bd">
        @switch (state()) {
          @case ('loading') {
            <div class="sk" role="status" aria-busy="true" data-panel-loading>
              <span class="sk__b"></span><span class="sk__b"></span
              ><span class="sk__b sk__b--tall"></span>
              <span class="sr-only">Loading the day</span>
            </div>
          }
          @case ('error') {
            <div class="err" role="alert" data-panel-error>
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              <span>Couldn't load this day.</span>
              <button type="button" class="mf-btn" (click)="load()">Retry</button>
            </div>
          }
          @default {
            @if (panel(); as p) {
              @if (p.holidays.length > 0) {
                <ul class="hols" aria-label="Holidays" data-panel-holidays>
                  @for (h of p.holidays; track h.name + h.category) {
                    <li>
                      <span class="hchip" [class]="'hchip hc-' + h.colourKey"
                        ><i class="pi pi-flag" aria-hidden="true"></i
                        ><span>{{ h.category }}: {{ h.name }}</span></span
                      >
                    </li>
                  }
                </ul>
              }
              <dl class="counts" data-panel-counts>
                <div class="ct" data-count="available">
                  <dt><i class="pi pi-check-circle" aria-hidden="true"></i> Available</dt>
                  <dd>{{ p.counts.available }}</dd>
                </div>
                <div class="ct" data-count="out">
                  <dt><i class="pi pi-user-minus" aria-hidden="true"></i> Out of office</dt>
                  <dd>{{ p.counts.outOfOffice }}</dd>
                </div>
                <div class="ct" data-count="holiday">
                  <dt><i class="pi pi-flag" aria-hidden="true"></i> On holiday</dt>
                  <dd>{{ p.counts.onHoliday }}</dd>
                </div>
                <div class="ct" data-count="off">
                  <dt><i class="pi pi-moon" aria-hidden="true"></i> Off hours</dt>
                  <dd>{{ p.counts.offHours }}</dd>
                </div>
              </dl>
              <p class="lvl" [class]="'lvl ' + cls(p.level)" data-panel-level>
                <i class="pi" [class]="LEVELS[p.level].icon" aria-hidden="true"></i>
                <span
                  ><b>Coverage {{ LEVELS[p.level].word }}:</b> {{ levelText(p) }}</span
                >
              </p>

              @if (p.pods.length > 0) {
                <section aria-labelledby="cp-pods">
                  <h3 class="h3 h3--fold" id="cp-pods">
                    <button
                      type="button"
                      class="fold"
                      data-pods-toggle
                      [attr.aria-expanded]="podsOpen()"
                      aria-controls="cp-pods-list"
                      (click)="podsOpen.set(!podsOpen())"
                    >
                      <i
                        class="pi"
                        [class]="podsOpen() ? 'pi-chevron-down' : 'pi-chevron-right'"
                        aria-hidden="true"
                      ></i>
                      Coverage by pod
                      <span class="n">{{ p.pods.length }}</span>
                    </button>
                  </h3>
                  <ul class="pods" id="cp-pods-list" data-panel-pods [hidden]="!podsOpen()">
                    @for (pod of p.pods; track pod.podId) {
                      <li [class]="'pod ' + cls(pod.level)" [attr.data-pod]="pod.podId">
                        <span class="pod__l">
                          <i
                            class="pi"
                            [class]="LEVELS[pod.level].icon"
                            [attr.title]="LEVELS[pod.level].word"
                            aria-hidden="true"
                          ></i>
                          <span class="pod__n" [attr.title]="pod.name">{{ pod.name }}</span>
                          <span class="sr-only">{{ LEVELS[pod.level].word }}</span>
                        </span>
                        <span class="pod__c"
                          >{{ pod.available }}/{{ pod.expected }}
                          <span class="pod__m">min {{ pod.minimum }}</span></span
                        >
                        <span class="bar" aria-hidden="true">
                          <span
                            class="bar__f"
                            [style.width.%]="share(pod.available, pod.expected)"
                          ></span>
                          <span
                            class="bar__m"
                            [style.left.%]="share(pod.minimum, pod.expected)"
                          ></span>
                        </span>
                      </li>
                    }
                  </ul>
                </section>
              }

              <div class="find">
                <label class="sr-only" for="cp-search">Search people</label>
                <i class="pi pi-search" aria-hidden="true"></i>
                <input
                  id="cp-search"
                  class="mf-control mf-control--fill find__in"
                  type="search"
                  placeholder="Search people"
                  autocomplete="off"
                  data-panel-search
                  [value]="search()"
                  (input)="search.set($any($event.target).value)"
                />
              </div>

              <section aria-labelledby="cp-av" data-list="available">
                <h3 class="h3" id="cp-av">
                  Available <span class="n">{{ total(avail()) }}</span>
                </h3>
                <p class="note">By role. Lightest load first: who can take work.</p>
                <ng-container
                  *ngTemplateOutlet="list; context: { $implicit: avail(), kind: 'available' }"
                />
              </section>
              <section aria-labelledby="cp-un" data-list="unavailable">
                <h3 class="h3" id="cp-un">
                  Unavailable <span class="n">{{ total(unavail()) }}</span>
                </h3>
                <p class="note">By role. Heaviest load first: whose work needs cover.</p>
                <ng-container
                  *ngTemplateOutlet="list; context: { $implicit: unavail(), kind: 'unavailable' }"
                />
              </section>
            }
          }
        }
      </div>
    </div>

    <ng-template #list let-groups let-kind="kind">
      @if (groups.length === 0) {
        <p class="empty" data-list-empty>
          @if (search().trim()) {
            No one matches "{{ search().trim() }}".
          } @else if (kind === 'available') {
            Nobody is available on this day.
          } @else {
            Everybody in view is available.
          }
        </p>
      }
      @for (g of groups; track g.roleId) {
        <h4 class="role" [attr.data-role]="g.roleId">
          {{ g.roleName }} <span class="n">{{ g.people.length }}</span>
        </h4>
        <ul class="people">
          @for (person of g.people; track person.userId) {
            <li class="person" [attr.data-user]="person.userId">
              <span class="who">
                @if (canManage()) {
                  <button
                    type="button"
                    class="who__b"
                    data-add-for
                    (click)="addFor.emit({ userId: person.userId, name: person.displayName })"
                  >
                    {{ person.displayName }}
                  </button>
                } @else {
                  <span class="who__n">{{ person.displayName }}</span>
                }
                <span class="who__p">{{ person.podNames.join(', ') }}</span>
              </span>
              <span class="ld" [attr.title]="person.load + ' open tasks'"
                ><span class="ld__n">{{ person.load }}</span
                ><span class="sr-only"> open {{ person.load === 1 ? 'task' : 'tasks' }}</span></span
              >
              <span class="chips">
                @if (kind === 'available') {
                  <span class="cs" [class]="'cs cs-' + cap(person).swatch"
                    ><i class="pi" [class]="cap(person).icon" aria-hidden="true"></i
                    >{{ cap(person).label }}</span
                  >
                } @else {
                  <span class="cs cs-off"
                    ><i class="pi" [class]="reasonIcon(person)" aria-hidden="true"></i
                    >{{ reasonText(person) }}</span
                  >
                  @if (person.absenceType; as t) {
                    <span class="cs cs-type" data-absence-type
                      ><i class="pi" [class]="typeIcon(t)" aria-hidden="true"></i
                      >{{ typeLabel(t) }}</span
                    >
                  }
                  @if (person.backOn) {
                    <span class="back">back {{ person.backOn | mfNum }}</span>
                  } @else if (person.reason === 'OUT_OF_OFFICE') {
                    <span class="back">no end date</span>
                  }
                }
              </span>
            </li>
          }
        </ul>
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      min-height: 0;
      height: 100%;
    }
    .pn {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
      overflow: hidden;
    }
    .hd {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mf-s2);
      flex: none;
      padding: var(--mf-s3) var(--mf-s4) var(--mf-s2);
      border-bottom: 1px solid var(--mf-border-soft);
    }
    .hd__t {
      min-width: 0;
    }
    .h2 {
      display: inline;
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .tdy {
      margin-left: var(--mf-s2);
      padding: 1px var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-primary);
      color: var(--mf-primary-contrast);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .sub {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .x {
      display: grid;
      place-items: center;
      flex: none;
      width: 32px;
      height: 32px;
      border: 1px solid var(--mf-border-mid);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      cursor: pointer;
    }
    .bd {
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
      padding: var(--mf-s3) var(--mf-s4) var(--mf-s4);
      display: grid;
      align-content: start;
      gap: var(--mf-s3);
    }
    .hols {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .hols .hchip {
      height: 22px;
      font-size: var(--mf-fs-sm);
    }
    /* The four counts on one compact row (CAL-11). */
    .counts {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--mf-s1);
      margin: 0;
    }
    .ct {
      padding: var(--mf-s1) var(--mf-s2);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
    }
    .ct dt .pi {
      display: none;
    }
    .ct dt {
      display: flex;
      align-items: center;
      gap: 3px;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      line-height: 1.2;
    }
    .ct dd {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
    }
    .lvl {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      border-radius: var(--mf-radius-lg);
      background: var(--cb);
      color: var(--cf);
      font-size: var(--mf-fs-sm);
    }
    .lvl .pi {
      margin-top: 2px;
    }
    .h3 {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .n {
      font-variant-numeric: tabular-nums;
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .note {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .h3--fold {
      margin: 0;
    }
    .fold {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      width: 100%;
      min-height: 28px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-weight: 700;
      text-align: left;
      cursor: pointer;
    }
    .fold:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .pods[hidden] {
      display: none;
    }
    .pods {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .pod {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .pod__l {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      min-width: 0;
      color: var(--cf);
    }
    .pod__n {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .pod__c {
      font-weight: 700;
      white-space: nowrap;
    }
    .pod__m {
      color: var(--mf-text-muted);
      font-weight: 400;
      font-size: var(--mf-fs-xs);
    }
    .bar {
      position: relative;
      grid-column: 1 / -1;
      height: 6px;
      border-radius: var(--mf-radius-pill);
      background: var(--mf-surface-alt);
    }
    .bar__f {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: var(--mf-radius-pill);
      background: var(--cs);
    }
    .bar__m {
      position: absolute;
      top: -2px;
      bottom: -2px;
      width: 2px;
      background: var(--mf-text);
    }
    .find {
      position: relative;
      display: flex;
      align-items: center;
    }
    .find .pi {
      position: absolute;
      left: var(--mf-s3);
      color: var(--mf-text-muted);
      pointer-events: none;
    }
    .find__in {
      padding-left: 2rem;
    }
    .role {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: var(--mf-s2) 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      text-transform: uppercase;
    }
    .people {
      display: grid;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .person {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 2px var(--mf-s2);
      padding: var(--mf-s1) 0;
      border-top: 1px solid var(--mf-border-soft);
    }
    .who {
      display: grid;
      min-width: 0;
    }
    .who__n,
    .who__b {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .who__b {
      justify-self: start;
      max-width: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .who__b:hover {
      text-decoration: underline;
    }
    .who__p {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .ld {
      min-width: 1.5rem;
      text-align: right;
      font-weight: 700;
    }
    .chips {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s2);
    }
    .cs {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      height: 20px;
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-sem-neutral-bg);
      color: var(--mf-sem-neutral-fg);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      white-space: nowrap;
    }
    .cs-cap-0 {
      background: var(--mf-cap-0);
      color: var(--mf-cap-0-fg);
    }
    .cs-cap-1 {
      background: var(--mf-cap-1);
      color: var(--mf-cap-1-fg);
    }
    .cs-cap-2 {
      background: var(--mf-cap-2);
      color: var(--mf-cap-2-fg);
    }
    .cs-cap-3 {
      background: var(--mf-cap-3);
      color: var(--mf-cap-3-fg);
    }
    .cs-type {
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
    }
    .back {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .empty {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .err,
    .sk {
      display: grid;
      gap: var(--mf-s2);
    }
    .err {
      grid-auto-flow: column;
      justify-content: start;
      align-items: center;
      color: var(--mf-sem-overdue-fg);
    }
    .sk__b {
      height: 40px;
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface-alt);
    }
    .sk__b--tall {
      height: 160px;
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
export class CalPanel {
  readonly date = input.required<string>();
  readonly query = input.required<CalQuery>();
  readonly today = input.required<string>();
  /** Counts up when the page reads again (Refresh, an entry saved). */
  readonly refreshKey = input(0);
  /** The viewer holds User.ManageAvailability: a name opens the Add dialog for that person. */
  readonly canManage = input(false);
  readonly closed = output<void>();
  readonly addFor = output<{ userId: number; name: string }>();

  private readonly api = inject(CALENDAR_API);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private seq = 0;

  protected readonly LEVELS = LEVELS;
  protected readonly longDay = longDay;
  protected readonly state = signal<LoadState>('loading');
  protected readonly panel = signal<DayPanel | null>(null);
  protected readonly search = signal('');
  /** Coverage by pod is folded by default (CAL-11): the lists of people are what the panel is for. */
  protected readonly podsOpen = signal(false);
  protected readonly isToday = computed(() => this.date() === this.today());
  protected readonly avail = computed(() =>
    filterGroups(this.panel()?.available ?? [], this.search()),
  );
  protected readonly unavail = computed(() =>
    filterGroups(this.panel()?.unavailable ?? [], this.search()),
  );
  protected readonly total = countPeople;

  constructor() {
    effect(() => {
      this.date();
      this.query();
      this.refreshKey();
      untracked(() => void this.load());
    });
  }

  /** Moves focus to the Close button (the page does this when the panel opens on a phone or as a slide-over). */
  focusClose(): void {
    this.host.nativeElement.querySelector<HTMLElement>('[data-panel-close]')?.focus();
  }

  async load(): Promise<void> {
    const id = ++this.seq;
    // The same day read again (Refresh) keeps what is on screen; another day shows the skeleton.
    if (this.panel()?.date !== this.date()) this.state.set('loading');
    try {
      const p = await this.api.day(this.date(), this.query());
      if (id !== this.seq) return;
      this.panel.set(p);
      this.state.set('ready');
    } catch {
      if (id !== this.seq) return;
      this.state.set('error');
    }
  }

  protected cls = (level: CoverageLevel): string => levelClass(level);
  protected pct = (p: DayPanel): number =>
    p.counts.expected > 0 ? Math.round((p.counts.available / p.counts.expected) * 100) : 0;
  protected levelText(p: DayPanel): string {
    return p.counts.expected > 0
      ? `${p.counts.available} of ${p.counts.expected} expected people are available (${this.pct(p)}%).`
      : `${LEVELS[p.level].hint}.`;
  }
  protected share = (n: number, of: number): number => (of > 0 ? Math.min(100, (n / of) * 100) : 0);
  protected cap = (p: DayPerson) => STATE_META[loadState(p.load)];
  protected reasonText(p: DayPerson): string {
    return p.reason === 'HOLIDAY'
      ? 'Holiday'
      : p.reason === 'NOT_WORKING'
        ? 'Not working'
        : 'Out of office';
  }
  protected reasonIcon(p: DayPerson): string {
    return p.reason === 'HOLIDAY' ? 'pi-flag' : p.reason === 'NOT_WORKING' ? 'pi-moon' : 'pi-ban';
  }
  protected typeLabel = (t: keyof typeof ABSENCE_TYPE_LABELS): string => ABSENCE_TYPE_LABELS[t];
  protected typeIcon = (t: keyof typeof ABSENCE_TYPE_ICONS): string => ABSENCE_TYPE_ICONS[t];
}
