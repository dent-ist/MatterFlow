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
import { NgTemplateOutlet } from '@angular/common';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { numericDate } from '../../../shared/ui/numeric-date';
import { ABSENCE_TYPE_LABELS } from '../../../shared/availability/absences/absence-contract';
import { CapacityState } from '../../../shared/availability/capacity-state';
import {
  UserStateIcon,
  UserStateKey,
  USER_STATE_WORDS,
} from '../../../shared/icons/user-state-icon';
import { Badge, BadgeTone } from '../../../shared/ui/badge';
import { CountChip } from '../../../shared/ui/count-chip';
import { FilterChip, FilterChips } from '../../../shared/ui/filter-chips';
import { DashboardPrefs } from '../dashboard-prefs';
import { DashState } from '../ui/dash-state';
import { CALENDAR_API } from './calendar-api';
import { CalQuery, CoverageLevel, DayPanel, DayPerson, RoleGroup } from './calendar-contract';
import { levelClass } from './calendar-month-grid';
import { DAY_COUNT_TIPS, LEVELS, isWeekend, longDay, offHoursCount } from './calendar-model';
import { Tip } from '../../../shared/ui/tip';
import { IntPipe } from '../../../shared/ui/number-format';
import { TagChip } from '../../../shared/ui/tag-chip';

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

/** The icon of a person by open tasks, by the capacity words of decision AS (0 Available, 1 Occupied, 2 Busy, 3 or more Overloaded) in the shapes of Dashboard > Users. */
const LOAD_KEYS: Readonly<Partial<Record<CapacityState, UserStateKey>>> = {
  AVAILABLE: 'idle',
  OCCUPIED: 'light',
  BUSY: 'normal',
  OVERLOADED: 'heavy',
};

export const countPeople = (groups: readonly RoleGroup[]): number =>
  groups.reduce((n, g) => n + g.people.length, 0);

/**
 * The day panel of the Dashboard Calendar (epic #1074, CAL-08), read-only: the date and its holidays by category, three count tiles (Available, Out of Office, Off Hours; a holiday person counts in Off Hours, #1234),
 * coverage by pod with the level as icon and word, then two searchable lists, AVAILABLE and UNAVAILABLE, each grouped by Role in the server's order and sorted by workload exactly as the
 * server returns them (Available: lightest load first, who can take work; Unavailable: heaviest first, whose work needs cover). A row has the name, the pod, the open-task count (a bare
 * number) and a state chip; an unavailable person also has the reason (Out of office, Holiday, Not working), the day they are back and, only when the server sent it (the viewer holds
 * Dashboard.ViewAbsenceReasons), the type of absence. No note, task title or matter appears here. Desktop: docked at the right; 768 to 1023 px a slide-over; a phone a bottom sheet.
 */
@Component({
  selector: 'mf-cal-panel',
  imports: [
    IntPipe,
    NgTemplateOutlet,
    Tip,
    TagChip,
    Badge,
    CountChip,
    FilterChips,
    UserStateIcon,
    DashState,
  ],
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
          <h2 class="h2" [class.h2--off]="redDay()" data-panel-date>{{ longDay(date()) }}</h2>
          @if (isToday()) {
            <span class="tdy">Today</span>
          }
          @if (panel(); as p) {
            <p class="sub">{{ p.counts.total | mfInt }} people in view</p>
          }
        </div>
        <button
          type="button"
          class="mf-btn mf-btn--icon"
          data-panel-close
          aria-label="Close the day panel"
          mfTip="Close"
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
            <div data-panel-error>
              <mf-dash-state variant="error" message="Couldn't load this day." (retry)="load()" />
            </div>
          }
          @default {
            @if (panel(); as p) {
              @if (p.holidays.length > 0) {
                <ul class="hols" aria-label="Holidays" data-panel-holidays>
                  @for (h of p.holidays; track h.name + h.category) {
                    <li>
                      <mf-tag-chip [colour]="h.colourKey" icon="pi-flag"
                        >{{ h.category }}: {{ h.name }}</mf-tag-chip
                      >
                    </li>
                  }
                </ul>
              }
              <dl class="counts" data-panel-counts>
                <div class="ct" data-count="available" [mfTip]="tips.available">
                  <dt>
                    <i class="pi pi-check-circle" aria-hidden="true"></i> Available
                    <span class="sr-only">. {{ tips.available }}</span>
                  </dt>
                  <dd>{{ p.counts.available }}</dd>
                </div>
                <div class="ct" data-count="out" [mfTip]="tips.out">
                  <dt>
                    <i class="pi pi-user-minus" aria-hidden="true"></i> Out of Office
                    <span class="sr-only">. {{ tips.out }}</span>
                  </dt>
                  <dd>{{ p.counts.outOfOffice }}</dd>
                </div>
                <div class="ct" data-count="off" [mfTip]="tips.off">
                  <dt>
                    <i class="pi pi-moon" aria-hidden="true"></i> Off Hours
                    <span class="sr-only">. {{ tips.off }}</span>
                  </dt>
                  <dd>{{ offHours(p) }}</dd>
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
                      Coverage by Pod
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
                <label class="sr-only" for="cp-search">Search People</label>
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
                <div class="secrow">
                  <h3 class="h3" id="cp-av">
                    Available <mf-count-chip>{{ total(avail()) }}</mf-count-chip>
                  </h3>
                  @if (roleIds().length > 0) {
                    <button
                      type="button"
                      class="mf-btn mf-btn--text"
                      data-collapse-all
                      (click)="toggleAll()"
                    >
                      {{ allCollapsed() ? 'Expand All' : 'Collapse All' }}
                    </button>
                  }
                </div>
                <p class="note">By role. Lightest load first: who can take work.</p>
                @if (avail().length > 0) {
                  <mf-filter-chips
                    class="jump"
                    label="Jump to a role"
                    data-jump
                    [chips]="jumpChips()"
                    (valueChange)="jumpTo($event)"
                  />
                }
                <ng-container
                  *ngTemplateOutlet="list; context: { $implicit: avail(), kind: 'available' }"
                />
              </section>
              <section aria-labelledby="cp-un" data-list="unavailable">
                <h3 class="h3" id="cp-un">
                  Not Available <mf-count-chip>{{ total(unavail()) }}</mf-count-chip>
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
        <div
          class="grp"
          [class.grp--off]="kind === 'unavailable'"
          [attr.data-role-group]="kind + '-' + g.roleId"
        >
          <h4 class="role">
            <button
              type="button"
              class="gh"
              [attr.data-role]="g.roleId"
              [attr.aria-expanded]="!isCollapsed(g.roleId)"
              [attr.aria-controls]="listId(kind, g.roleId)"
              (click)="toggleRole(g.roleId)"
            >
              <span class="gh__n">{{ g.roleName }}</span>
              <mf-count-chip>{{ g.people.length }}</mf-count-chip>
              <i
                class="pi pi-chevron-down chev"
                [class.chev--closed]="isCollapsed(g.roleId)"
                aria-hidden="true"
              ></i>
            </button>
          </h4>
          <ul class="people" [id]="listId(kind, g.roleId)" [hidden]="isCollapsed(g.roleId)">
            @for (person of g.people; track person.userId) {
              <li
                class="person"
                [attr.data-user]="person.userId"
                [attr.data-state]="stateKey(person, kind)"
                [attr.aria-label]="rowName(person, kind)"
              >
                <span class="ic" data-state-circle [mfTip]="stateTip(person, kind)">
                  <mf-user-state-icon [state]="stateKey(person, kind)" />
                </span>
                <span class="who">
                  @if (canManage()) {
                    <button
                      type="button"
                      class="mf-btn mf-btn--text who__b"
                      data-add-for
                      (click)="addFor.emit({ userId: person.userId, name: person.displayName })"
                    >
                      {{ person.displayName }}
                    </button>
                  } @else {
                    <span class="who__n">{{ person.displayName }}</span>
                  }
                  <span class="who__p" data-pods [mfTip]="podsText(person)">{{
                    secondLine(person)
                  }}</span>
                </span>
                @if (kind === 'available') {
                  <span class="ld" data-load>
                    <b class="ld__n">{{ person.load }}</b>
                    <span class="dots" aria-hidden="true">
                      @for (on of pips(person.load); track $index) {
                        <i class="dot" [class.dot--on]="on"></i>
                      }
                    </span>
                  </span>
                } @else {
                  <span class="rs" data-reason>
                    <mf-badge [tone]="reasonTone(person)" [icon]="reasonIcon(person)">{{
                      reasonChip(person)
                    }}</mf-badge>
                  </span>
                }
              </li>
            }
          </ul>
        </div>
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
      border: 1px solid var(--mf-border-soft);
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
      font-size: var(--mf-fs-lg);
      font-weight: var(--mf-fw-semibold);
    }
    /* Saturday, Sunday and holiday dates are red, as in the grids (#1225). */
    .h2.h2--off {
      color: var(--mf-danger);
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
    .bd {
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
      padding: 0 var(--mf-s4) var(--mf-s4);
      display: grid;
      align-content: start;
      gap: var(--mf-s3);
    }
    /* No top padding: a sticky role band sticks at the very top of the body, so the space above the first block is its margin. */
    .bd > :first-child {
      margin-top: var(--mf-s3);
    }
    .hols {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    /* The three count tiles on one compact row (CAL-11, #1234): one height, the label at the top (it may wrap to two lines) and the number pinned to the bottom, so the numbers share a baseline. */
    .counts {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--mf-s1);
      margin: 0;
    }
    .ct {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
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
      font-size: var(--mf-fs-sm);
      line-height: 1.2;
    }
    /* A figure tile (D-10, #1162): the number 24 / 700, the label 13 muted. */
    .ct dd {
      margin: 0;
      font-size: var(--mf-fs-figure);
      font-weight: 700;
      line-height: 1.1;
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
    /* A section heading of the panel: 16 / 600 (D-11). */
    .h3 {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-lg);
      font-weight: var(--mf-fw-semibold);
    }
    .n {
      font-variant-numeric: tabular-nums;
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .secrow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
    }
    .secrow .h3 {
      margin: 0;
    }
    .jump {
      margin: 0 0 var(--mf-s2);
    }
    .note {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
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
    /* A role group (#1242): a header band that sticks to the top of the scrolling panel while its people scroll, then the compact rows. */
    .grp {
      margin-top: var(--mf-s2);
    }
    .role {
      position: sticky;
      top: 0;
      z-index: 1;
      margin: 0 calc(-1 * var(--mf-s4));
    }
    .gh {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      box-sizing: border-box;
      width: 100%;
      min-height: var(--mf-ctl-h);
      padding: 0 var(--mf-s4);
      border: 0;
      border-top: 1px solid var(--mf-border-soft);
      border-bottom: 1px solid var(--mf-border-soft);
      background: var(--mf-surface-alt);
      color: var(--mf-text);
      font: inherit;
      font-size: var(--mf-fs-md);
      font-weight: 700;
      text-align: left;
      cursor: pointer;
    }
    .gh:hover {
      background: var(--mf-row-hover);
    }
    .gh:focus-visible {
      outline: var(--mf-focus-width) solid var(--mf-focus);
      outline-offset: calc(-1 * var(--mf-focus-width));
    }
    .gh__n {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .grp--off .gh {
      color: var(--mf-text-muted);
    }
    .chev {
      margin-left: auto;
      color: var(--mf-text-muted);
      font-size: var(--mf-icon-sm);
      transition: transform 0.15s ease;
    }
    .chev--closed {
      transform: rotate(-90deg);
    }
    .people {
      display: grid;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .people[hidden] {
      display: none;
    }
    /* A compact row, 44 px: the state icon in a 28 px circle, the name and the pods, then the load (or the reason). A 3 px edge repeats the level; the icon shape and the number carry it too. */
    .person {
      --edge: var(--mf-border-strong);
      --ic-bg: var(--mf-surface-alt);
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--mf-s2);
      box-sizing: border-box;
      min-height: var(--mf-grid-row-h);
      margin: 0 calc(-1 * var(--mf-s4));
      padding: var(--mf-s1) var(--mf-s4) var(--mf-s1) calc(var(--mf-s4) - 3px);
      border-bottom: 1px solid var(--mf-border-soft);
      border-left: 3px solid var(--edge);
    }
    .person:hover {
      background: var(--mf-row-hover);
    }
    .person[data-state='idle'] {
      --edge: var(--mf-success);
      --ic-bg: var(--mf-success-bg);
      --dot: var(--mf-success);
    }
    .person[data-state='light'] {
      --edge: var(--mf-info);
      --ic-bg: var(--mf-info-bg);
      --dot: var(--mf-info);
    }
    .person[data-state='normal'] {
      --edge: var(--mf-text-muted);
      --dot: var(--mf-text-muted);
    }
    .person[data-state='heavy'] {
      --edge: var(--mf-danger);
      --ic-bg: var(--mf-danger-bg);
      --dot: var(--mf-danger);
    }
    .person[data-state='out'] {
      --edge: var(--mf-warning);
      --ic-bg: var(--mf-warning-bg);
    }
    .ic {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--ic-bg);
    }
    .who {
      display: grid;
      min-width: 0;
    }
    .who__n,
    .who__b {
      justify-self: start;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .who__b {
      min-height: 0;
      padding: 0;
      font-size: var(--mf-fs-md);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .who__p {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .ld {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .ld__n {
      min-width: 1ch;
      text-align: right;
      font-size: var(--mf-fs-md);
      font-variant-numeric: tabular-nums;
    }
    .dots {
      display: inline-flex;
      gap: 3px;
    }
    .dot {
      width: 0.625rem;
      height: 0.625rem;
      box-sizing: border-box;
      border: 1px solid var(--mf-border-strong);
      border-radius: 50%;
      background: var(--mf-surface-alt);
    }
    .dot--on {
      border-color: var(--dot, var(--mf-text-muted));
      background: var(--dot, var(--mf-text-muted));
    }
    .empty {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .sk {
      display: grid;
      gap: var(--mf-s2);
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
  private readonly injector = inject(Injector);
  private readonly prefs = inject(DashboardPrefs);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private seq = 0;

  protected readonly LEVELS = LEVELS;
  protected readonly longDay = longDay;
  protected readonly state = signal<LoadState>('loading');
  protected readonly panel = signal<DayPanel | null>(null);
  protected readonly search = signal('');
  /** Coverage by pod is folded by default (CAL-11): the lists of people are what the panel is for. */
  protected readonly podsOpen = signal(false);
  protected readonly isToday = computed(() => this.date() === this.today());
  protected readonly redDay = computed(
    () => isWeekend(this.date()) || (this.panel()?.holidays.length ?? 0) > 0,
  );
  protected readonly avail = computed(() =>
    filterGroups(this.panel()?.available ?? [], this.search()),
  );
  protected readonly unavail = computed(() =>
    filterGroups(this.panel()?.unavailable ?? [], this.search()),
  );
  protected readonly total = countPeople;

  /** The role groups the person collapsed (remembered per user, shared by Available and Not Available). */
  protected readonly collapsed = this.prefs.calendarCollapsed;
  /** The roles shown in either list, in the server's order, each once. */
  protected readonly roleIds = computed(() => [
    ...new Set([...this.avail(), ...this.unavail()].map((g) => g.roleId)),
  ]);
  protected readonly allCollapsed = computed(
    () => this.roleIds().length > 0 && this.roleIds().every((id) => this.collapsed().has(id)),
  );
  /** One jump chip per Available role, with its count, in the order of the groups. */
  protected readonly jumpChips = computed<FilterChip[]>(() =>
    this.avail().map((g) => ({
      key: String(g.roleId),
      label: g.roleName,
      count: g.people.length,
      hint: `Go to ${g.roleName}`,
    })),
  );

  constructor() {
    this.prefs.ensureLoaded();
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
  /** The tiles' tooltips and descriptions (#1234). */
  protected readonly tips = DAY_COUNT_TIPS;
  /** Off Hours with the holiday people added, so the three tiles add up to the people in view. */
  protected offHours = (p: DayPanel): number => offHoursCount(p.counts);
  protected pct = (p: DayPanel): number =>
    p.counts.expected > 0 ? Math.round((p.counts.available / p.counts.expected) * 100) : 0;
  protected levelText(p: DayPanel): string {
    return p.counts.expected > 0
      ? `${p.counts.available} of ${p.counts.expected} expected people are available (${this.pct(p)}%).`
      : `${LEVELS[p.level].hint}.`;
  }
  protected share = (n: number, of: number): number => (of > 0 ? Math.min(100, (n / of) * 100) : 0);
  protected isCollapsed = (roleId: number): boolean => this.collapsed().has(roleId);
  protected listId = (kind: string, roleId: number): string => `cp-${kind}-${roleId}`;

  protected toggleRole(roleId: number): void {
    const next = new Set(this.collapsed());
    if (!next.delete(roleId)) next.add(roleId);
    this.prefs.setCalendarCollapsed(next);
  }

  /** Collapse every role shown, or expand them all when all are collapsed (roles not in view keep their choice). */
  protected toggleAll(): void {
    const next = new Set(this.collapsed());
    const ids = this.roleIds();
    if (this.allCollapsed()) for (const id of ids) next.delete(id);
    else for (const id of ids) next.add(id);
    this.prefs.setCalendarCollapsed(next);
  }

  /** A jump chip: expand the role when it is collapsed, then bring its header band to the top of the panel and put the focus on it. */
  protected jumpTo(key: string): void {
    const id = Number(key);
    if (this.collapsed().has(id)) this.toggleRole(id);
    afterNextRender(
      () => {
        const band = this.host.nativeElement.querySelector<HTMLElement>(
          `[data-role-group="available-${id}"] .gh`,
        );
        band?.closest<HTMLElement>('.grp')?.scrollIntoView?.({ block: 'start' });
        band?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** The state of a person's icon: the load level for an available person (0 Idle, 1 Light, 2 Normal, 3 or more Heavy), Out of Office or Off Hours for the others. */
  protected stateKey(p: DayPerson, kind: string): UserStateKey {
    if (kind === 'unavailable') return p.reason === 'OUT_OF_OFFICE' ? 'out' : 'off';
    return LOAD_KEYS[loadState(p.load)] ?? 'normal';
  }
  protected stateTip(p: DayPerson, kind: string): string {
    if (kind === 'unavailable') return this.reasonLong(p);
    return `${USER_STATE_WORDS[this.stateKey(p, kind)]}: ${this.tasks(p.load)}. Available`;
  }
  protected rowName(p: DayPerson, kind: string): string {
    if (kind === 'unavailable') return `${p.displayName}, ${this.reasonLong(p)}`;
    return `${p.displayName}, ${this.tasks(p.load)}, ${USER_STATE_WORDS[this.stateKey(p, kind)]}, Available`;
  }
  private tasks = (n: number): string => `${n} open ${n === 1 ? 'task' : 'tasks'}`;
  /** Three capacity dots (the 3-slot rule of the Users cards): one filled per open task up to three. */
  protected pips = (load: number): boolean[] => Array.from({ length: 3 }, (_, i) => i < load);
  protected podsText = (p: DayPerson): string => p.podNames.join(', ');
  /** Line 2 of a row: the pods on one line; an absence type (only when the server sent it) goes in front. */
  protected secondLine(p: DayPerson): string {
    return p.absenceType
      ? `${ABSENCE_TYPE_LABELS[p.absenceType]} · ${this.podsText(p)}`
      : this.podsText(p);
  }
  private back(p: DayPerson): string | null {
    return p.backOn ? numericDate(p.backOn, this.clock.now(), this.zone) : null;
  }
  /** "Out of Office, back 11/23" / "Holiday" / "Off Hours": the whole reason for the tooltip and the row's accessible name. */
  private reasonLong(p: DayPerson): string {
    if (p.reason === 'HOLIDAY') return 'Holiday';
    if (p.reason === 'NOT_WORKING') return 'Off Hours';
    const back = this.back(p);
    const type = p.absenceType ? ` (${ABSENCE_TYPE_LABELS[p.absenceType]})` : '';
    return `Out of Office${type}, ${back ? `back ${back}` : 'no end date'}`;
  }
  /** The reason chip at the right of a Not Available row. */
  protected reasonChip(p: DayPerson): string {
    if (p.reason === 'HOLIDAY') return 'Holiday';
    if (p.reason === 'NOT_WORKING') return 'Off Hours';
    const back = this.back(p);
    return back ? `Back ${back}` : 'No end date';
  }
  protected reasonTone = (p: DayPerson): BadgeTone =>
    p.reason === 'OUT_OF_OFFICE' || p.reason === undefined ? 'warning' : 'neutral';
  protected reasonIcon(p: DayPerson): string {
    return p.reason === 'HOLIDAY'
      ? 'pi-flag'
      : p.reason === 'NOT_WORKING'
        ? 'pi-moon'
        : 'pi-calendar-minus';
  }
}
