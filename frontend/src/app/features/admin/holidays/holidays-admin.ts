import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';
import { CalendarDialog } from './calendar-dialog';
import { HOLIDAY_API } from './holiday-api';
import { Holiday, HolidayCalendar, HolidayDefaults, PodRef, PreviewRow } from './holiday-contract';
import { HolidayDialog } from './holiday-dialog';
import { ruleText } from './holiday-rules';
import { ImportDialog } from './import-dialog';

type LoadState = 'loading' | 'ready' | 'error';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Administration > Settings > Holidays (epic #1074, CAL-06; Settings.Manage): the holiday calendars by Category (US Holiday, UK Holiday, Firm closure ...), the named dates of the chosen
 * calendar for this year or a preview of next year, add and edit in pop-up dialogs, paste or import with a line-by-line check, and who uses which calendar: the firm default and a default
 * per pod (a person has ONE calendar: their own choice, else their pod's default, else the firm default; "applies to everyone" calendars such as a firm closure are added on top).
 */
@Component({
  selector: 'mf-holidays-admin',
  imports: [CalendarDialog, ConfirmDialog, HolidayDialog, ImportDialog, NumericDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../dashboard/calendar/calendar-coverage.scss',
  template: `
    <section class="ha" aria-label="Holidays" data-holidays-admin>
      @switch (state()) {
        @case ('loading') {
          <div class="ha__state" role="status" aria-busy="true" data-holidays-loading>
            <span class="ha__sk"></span><span class="ha__sk ha__sk--s"></span
            ><span class="mf-sr-only">Loading the holiday calendars</span>
          </div>
        }
        @case ('error') {
          <div class="ha__state ha__state--err" role="alert" data-holidays-error>
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> We could not load the
            holiday calendars.
            <button type="button" class="mf-btn" (click)="load()">Retry</button>
          </div>
        }
        @default {
          <div class="ha__grid">
            <div class="ha__side">
              <div class="ha__sh">
                <h2 class="ha__h">
                  Holiday calendars <span class="ha__n">{{ calendars().length }}</span>
                </h2>
                <button
                  type="button"
                  class="mf-btn mf-btn--primary"
                  data-new-calendar
                  (click)="newCalendar()"
                >
                  <i class="pi pi-plus" aria-hidden="true"></i> New
                </button>
              </div>
              @if (calendars().length === 0) {
                <p class="ha__empty" data-holidays-empty>
                  <i class="pi pi-calendar" aria-hidden="true"></i> No holiday calendars yet. Create
                  one for a country or a closure, then add its days.
                </p>
              }
              <ul class="ha__cals" aria-label="Holiday calendars">
                @for (c of calendars(); track c.calendarId) {
                  <li>
                    <button
                      type="button"
                      class="cal"
                      [class]="'cal hc-' + c.colourKey"
                      [class.cal--on]="c.calendarId === selectedId()"
                      [attr.aria-current]="c.calendarId === selectedId() ? 'true' : null"
                      [attr.data-calendar]="c.calendarId"
                      (click)="select(c.calendarId)"
                    >
                      <span class="cal__n"
                        ><i class="pi pi-flag cal__f" aria-hidden="true"></i>{{ c.name }}</span
                      >
                      <span class="cal__s">{{ summary(c) }}</span>
                    </button>
                  </li>
                }
              </ul>

              <section class="ha__def" aria-labelledby="ha-def-h" data-defaults>
                <h3 class="ha__h3" id="ha-def-h">Who uses which calendar</h3>
                <p class="ha__p">
                  A person has one calendar: their own choice (on the person), else their pod's
                  default, else the firm default. Calendars that apply to everyone, such as a firm
                  closure, are added on top.
                </p>
                @if (defaults(); as d) {
                  <div class="ha__f">
                    <label class="ha__l" for="ha-firm">Firm default</label>
                    <select
                      id="ha-firm"
                      class="mf-control mf-control--fill"
                      data-firm-default
                      [value]="firm() ?? ''"
                      (change)="setFirm($any($event.target).value)"
                    >
                      <option value="" [selected]="firm() === null">No default</option>
                      @for (c of ownCalendars(); track c.calendarId) {
                        <option [value]="c.calendarId" [selected]="firm() === c.calendarId">
                          {{ c.name }}
                        </option>
                      }
                    </select>
                  </div>
                  <fieldset class="ha__pods">
                    <legend class="ha__l">Pod defaults (optional)</legend>
                    @for (p of pods(); track p.podId) {
                      <div class="ha__pod">
                        <label [for]="'ha-pod-' + p.podId">{{ p.name }}</label>
                        <select
                          [id]="'ha-pod-' + p.podId"
                          class="mf-control"
                          [attr.data-pod-default]="p.podId"
                          [value]="podCal(p.podId) ?? ''"
                          (change)="setPod(p.podId, $any($event.target).value)"
                        >
                          <option value="" [selected]="podCal(p.podId) === null">
                            Firm default
                          </option>
                          @for (c of ownCalendars(); track c.calendarId) {
                            <option
                              [value]="c.calendarId"
                              [selected]="podCal(p.podId) === c.calendarId"
                            >
                              {{ c.name }}
                            </option>
                          }
                        </select>
                      </div>
                    }
                  </fieldset>
                  @if (defaultsError()) {
                    <p class="ha__err" role="alert" data-defaults-error>{{ defaultsError() }}</p>
                  }
                  <div class="ha__bar">
                    <button
                      type="button"
                      class="mf-btn mf-btn--primary"
                      data-save-defaults
                      [disabled]="!defaultsDirty() || defaultsBusy()"
                      (click)="saveDefaults()"
                    >
                      {{ defaultsBusy() ? 'Saving...' : 'Save defaults' }}
                    </button>
                  </div>
                  <p class="ha__p ha__p--s">
                    The people count of a calendar is updated when you save.
                  </p>
                  <span class="mf-sr-only" aria-hidden="true">{{ d.rowVersion }}</span>
                }
              </section>
            </div>

            <div class="ha__main">
              @if (selected(); as c) {
                <header class="ha__mh">
                  <div class="ha__mt">
                    <span class="hchip hchip--big" [class]="'hchip hchip--big hc-' + c.colourKey"
                      ><i class="pi pi-flag" aria-hidden="true"></i><span>{{ c.name }}</span></span
                    >
                    @if (c.appliesToEveryone) {
                      <span class="ha__tag">Applies to everyone</span>
                    }
                    @if (c.regionNote) {
                      <p class="ha__p" data-region-note>{{ c.regionNote }}</p>
                    }
                  </div>
                  <div class="ha__ma">
                    <button
                      type="button"
                      class="mf-btn"
                      data-edit-calendar
                      (click)="editCalendar(c)"
                    >
                      <i class="pi pi-pencil" aria-hidden="true"></i> Edit calendar
                    </button>
                    <button
                      type="button"
                      class="mf-btn mf-btn--danger"
                      data-delete-calendar
                      [attr.aria-label]="'Delete ' + c.name"
                      (click)="askDeleteCalendar(c)"
                    >
                      <i class="pi pi-trash" aria-hidden="true"></i>
                    </button>
                  </div>
                </header>
                <div class="ha__tb">
                  <div class="ha__s">
                    <i class="pi pi-search" aria-hidden="true"></i>
                    <label class="mf-sr-only" for="ha-q">Search holidays</label>
                    <input
                      id="ha-q"
                      class="mf-control mf-control--fill"
                      type="search"
                      placeholder="Search holidays"
                      autocomplete="off"
                      [value]="query()"
                      (input)="query.set($any($event.target).value)"
                    />
                  </div>
                  <div class="seg" role="group" aria-label="Year">
                    <button
                      type="button"
                      class="mf-btn seg__b"
                      data-year-this
                      [attr.aria-pressed]="year() === thisYear()"
                      (click)="setYear(thisYear())"
                    >
                      {{ thisYear() }}
                    </button>
                    <button
                      type="button"
                      class="mf-btn seg__b"
                      data-year-next
                      [attr.aria-pressed]="year() === thisYear() + 1"
                      (click)="setYear(thisYear() + 1)"
                    >
                      {{ thisYear() + 1 }} (preview)
                    </button>
                  </div>
                  <button type="button" class="mf-btn" data-import (click)="importOpen.set(true)">
                    <i class="pi pi-upload" aria-hidden="true"></i> Import / paste list
                  </button>
                  <button
                    type="button"
                    class="mf-btn mf-btn--primary"
                    data-add-holiday
                    (click)="addHoliday()"
                  >
                    <i class="pi pi-plus" aria-hidden="true"></i> Add holiday
                  </button>
                </div>
                @if (listState() === 'loading') {
                  <div class="ha__state" role="status" aria-busy="true">
                    <span class="ha__sk"></span><span class="mf-sr-only">Loading the holidays</span>
                  </div>
                } @else if (listState() === 'error') {
                  <div class="ha__state ha__state--err" role="alert">
                    <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> The holidays could
                    not be loaded.
                    <button type="button" class="mf-btn" (click)="loadHolidays()">Retry</button>
                  </div>
                } @else if (rows().length === 0) {
                  <p class="ha__empty" data-no-holidays>
                    @if (query().trim()) {
                      No holiday matches "{{ query().trim() }}".
                    } @else {
                      This calendar has no days yet. Add a holiday or paste a list.
                    }
                  </p>
                } @else {
                  <div
                    class="ha__tw"
                    role="region"
                    aria-label="Holidays of the calendar"
                    tabindex="0"
                  >
                    <table class="ha__t" data-holidays-table>
                      <thead>
                        <tr>
                          <th scope="col">Holiday</th>
                          <th scope="col">Date in {{ year() }}</th>
                          <th scope="col">Repeats</th>
                          <th scope="col">Region note</th>
                          <th scope="col">Counts as</th>
                          <th scope="col"><span class="mf-sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (r of rows(); track r.h.holidayId) {
                          <tr [attr.data-holiday]="r.h.holidayId">
                            <th scope="row" class="ha__name">{{ r.h.name }}</th>
                            <td>
                              @if (r.p; as p) {
                                <span class="ha__d"
                                  >{{ weekday(p.date) }} {{ p.date | mfNum }}
                                  @if (p.endDate) {
                                    to {{ weekday(p.endDate) }} {{ p.endDate | mfNum }}
                                  }
                                </span>
                                @if (p.observedFrom) {
                                  <span class="ha__o"
                                    >(observed; falls on {{ weekday(p.observedFrom) }}
                                    {{ p.observedFrom | mfNum }})</span
                                  >
                                }
                              } @else {
                                <span class="ha__o">Not in {{ year() }}</span>
                              }
                            </td>
                            <td>{{ rule(r.h) }}</td>
                            <td>{{ r.h.regionNote || '-' }}</td>
                            <td>
                              <span class="ha__chip"
                                ><i class="pi pi-moon" aria-hidden="true"></i> Non-working day</span
                              >
                            </td>
                            <td class="ha__acts">
                              <button
                                type="button"
                                class="mf-btn mf-btn--icon"
                                data-edit-holiday
                                [attr.aria-label]="'Edit ' + r.h.name"
                                (click)="editHoliday(r.h)"
                              >
                                <i class="pi pi-pencil" aria-hidden="true"></i>
                              </button>
                              <button
                                type="button"
                                class="mf-btn mf-btn--icon mf-btn--danger"
                                data-delete-holiday
                                [attr.aria-label]="'Delete ' + r.h.name"
                                (click)="askDeleteHoliday(r.h)"
                              >
                                <i class="pi pi-trash" aria-hidden="true"></i>
                              </button>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              } @else {
                <p class="ha__empty">Choose a calendar to see its days.</p>
              }
            </div>
          </div>
        }
      }
    </section>

    @if (calendarOpen()) {
      <mf-calendar-dialog
        [(visible)]="calendarOpen"
        [calendar]="editingCalendar()"
        (saved)="onCalendarSaved($event)"
      />
    }
    @if (holidayOpen() && selected(); as c) {
      <mf-holiday-dialog
        [(visible)]="holidayOpen"
        [calendarId]="c.calendarId"
        [calendarName]="c.name"
        [holiday]="editingHoliday()"
        (saved)="afterHolidayChange()"
      />
    }
    @if (importOpen() && selected(); as c) {
      <mf-import-dialog
        [(visible)]="importOpen"
        [calendarId]="c.calendarId"
        [calendarName]="c.name"
        [year]="year()"
        (saved)="afterHolidayChange()"
      />
    }
    @if (deleteCal(); as c) {
      <mf-confirm-dialog
        title="Delete this calendar?"
        confirmLabel="Delete"
        [danger]="true"
        [busy]="deleteBusy()"
        [error]="deleteError()"
        [visible]="true"
        (visibleChange)="$event || cancelDelete()"
        (confirmed)="confirmDeleteCalendar(c)"
      >
        <p>
          {{ c.name }} and its {{ c.holidayCount }} days will be deleted. People who used it fall
          back to their pod's or the firm's default.
        </p>
      </mf-confirm-dialog>
    }
    @if (deleteDay(); as h) {
      <mf-confirm-dialog
        title="Delete this holiday?"
        confirmLabel="Delete"
        [danger]="true"
        [busy]="deleteBusy()"
        [error]="deleteError()"
        [visible]="true"
        (visibleChange)="$event || cancelDelete()"
        (confirmed)="confirmDeleteHoliday(h)"
      >
        <p>{{ h.name }} will no longer count as a day off on the calendar.</p>
      </mf-confirm-dialog>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .ha__grid {
      display: grid;
      grid-template-columns: minmax(16rem, 20rem) minmax(0, 1fr);
      gap: var(--mf-s4);
      align-items: start;
    }
    @media (max-width: 899.98px) {
      .ha__grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .ha__side,
    .ha__main {
      display: grid;
      gap: var(--mf-s3);
      min-width: 0;
      align-content: start;
    }
    .ha__main {
      padding: var(--mf-s4);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
    }
    .ha__sh,
    .ha__mh {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
    }
    .ha__h,
    .ha__h3 {
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .ha__n {
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
    }
    .ha__cals {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .cal {
      display: grid;
      width: 100%;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .cal--on {
      border-color: var(--mf-primary);
      box-shadow: inset 0 0 0 1px var(--mf-primary);
      background: var(--mf-selected-bg);
    }
    .cal:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .cal__n {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      font-weight: 700;
    }
    .cal__f {
      padding: 3px;
      border-radius: var(--mf-radius-pill);
      background: var(--hb);
      color: var(--hf);
      font-size: 0.75rem;
    }
    .cal__s {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ha__def {
      display: grid;
      gap: var(--mf-s2);
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
    }
    .ha__p {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ha__p--s {
      font-size: var(--mf-fs-xs);
    }
    .ha__f {
      display: grid;
      gap: var(--mf-s1);
    }
    .ha__l {
      padding: 0;
      font-weight: 600;
    }
    .ha__pods {
      display: grid;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .ha__pod {
      display: grid;
      grid-template-columns: 6.5rem minmax(0, 1fr);
      align-items: center;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .ha__err {
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
    .ha__bar {
      display: flex;
      gap: var(--mf-s2);
    }
    .hchip--big {
      height: 24px;
      font-size: var(--mf-fs-sm);
    }
    .ha__tag {
      margin-left: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ha__ma {
      display: flex;
      gap: var(--mf-s2);
    }
    .ha__tb {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .ha__s {
      position: relative;
      flex: 1 1 12rem;
      max-width: 18rem;
    }
    .ha__s .pi {
      position: absolute;
      top: 50%;
      left: var(--mf-s3);
      transform: translateY(-50%);
      color: var(--mf-text-muted);
      pointer-events: none;
    }
    .ha__s input {
      padding-left: 2rem;
    }
    .seg {
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
    }
    .seg__b {
      border: 0;
      border-radius: 0;
    }
    .seg__b + .seg__b {
      border-left: 1px solid var(--mf-border-mid);
    }
    .seg__b[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      color: var(--mf-primary);
      box-shadow: inset 0 -2px 0 var(--mf-primary);
      font-weight: 700;
    }
    .ha__tb .mf-btn--primary {
      margin-left: auto;
    }
    .ha__tw {
      overflow: auto;
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
    }
    .ha__t {
      width: 100%;
      min-width: 40rem;
      border-collapse: collapse;
      font-size: var(--mf-fs-sm);
    }
    .ha__t th,
    .ha__t td {
      padding: var(--mf-s2) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border-soft);
      text-align: left;
      vertical-align: top;
    }
    .ha__t thead th {
      position: sticky;
      top: 0;
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      text-transform: uppercase;
    }
    .ha__name {
      font-weight: 700;
    }
    .ha__d {
      display: block;
      white-space: nowrap;
    }
    .ha__o {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .ha__chip {
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
    .ha__acts {
      white-space: nowrap;
      text-align: right !important;
    }
    .ha__state,
    .ha__empty {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      color: var(--mf-text-muted);
    }
    .ha__state--err {
      border-style: solid;
      border-color: var(--mf-sem-overdue-line);
      background: var(--mf-sem-overdue-bg);
      color: var(--mf-sem-overdue-fg);
    }
    .ha__sk {
      display: block;
      width: 60%;
      height: 14px;
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
    }
    .ha__sk--s {
      width: 35%;
    }
  `,
})
export class HolidaysAdmin implements OnInit {
  private readonly api = inject(HOLIDAY_API);
  private readonly notify = inject(NotificationService);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly state = signal<LoadState>('loading');
  protected readonly calendars = signal<HolidayCalendar[]>([]);
  protected readonly pods = signal<PodRef[]>([]);
  protected readonly defaults = signal<HolidayDefaults | null>(null);
  protected readonly firm = signal<number | null>(null);
  private readonly podChoice = signal<Record<number, number | null>>({});
  protected readonly defaultsBusy = signal(false);
  protected readonly defaultsError = signal('');
  protected readonly selectedId = signal<number | null>(null);
  protected readonly holidays = signal<Holiday[]>([]);
  protected readonly preview = signal<PreviewRow[]>([]);
  protected readonly listState = signal<LoadState>('loading');
  protected readonly query = signal('');
  protected readonly thisYear = computed(() => calendarDayInZone(this.clock.now(), this.zone).year);
  protected readonly year = signal(0);

  protected readonly calendarOpen = signal(false);
  protected readonly editingCalendar = signal<HolidayCalendar | null>(null);
  protected readonly holidayOpen = signal(false);
  protected readonly editingHoliday = signal<Holiday | null>(null);
  protected readonly importOpen = signal(false);
  protected readonly deleteCal = signal<HolidayCalendar | null>(null);
  protected readonly deleteDay = signal<Holiday | null>(null);
  protected readonly deleteBusy = signal(false);
  protected readonly deleteError = signal('');

  protected readonly selected = computed(
    () => this.calendars().find((c) => c.calendarId === this.selectedId()) ?? null,
  );
  protected readonly ownCalendars = computed(() =>
    this.calendars().filter((c) => !c.appliesToEveryone),
  );
  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const used = new Set<number>();
    const list = this.holidays().map((h) => {
      const i = this.preview().findIndex((p, idx) => p.name === h.name && !used.has(idx));
      if (i >= 0) used.add(i);
      return { h, p: i >= 0 ? this.preview()[i] : null };
    });
    return list
      .filter(
        (r) =>
          !q ||
          r.h.name.toLowerCase().includes(q) ||
          (r.h.regionNote ?? '').toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          (a.p?.date ?? '9999').localeCompare(b.p?.date ?? '9999') ||
          a.h.name.localeCompare(b.h.name),
      );
  });
  protected readonly defaultsDirty = computed(() => {
    const d = this.defaults();
    if (!d) return false;
    if (this.firm() !== d.firmCalendarId) return true;
    return d.podDefaults.some((p) => (this.podChoice()[p.podId] ?? null) !== p.calendarId);
  });

  ngOnInit(): void {
    this.year.set(this.thisYear());
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [calendars, pods, defaults] = await Promise.all([
        this.api.calendars(),
        this.api.pods(),
        this.api.defaults(),
      ]);
      this.calendars.set(calendars);
      this.pods.set(pods);
      this.applyDefaults(defaults);
      this.state.set('ready');
      if (
        this.selectedId() === null ||
        !calendars.some((c) => c.calendarId === this.selectedId())
      ) {
        this.selectedId.set(calendars[0]?.calendarId ?? null);
      }
      await this.loadHolidays();
    } catch {
      this.state.set('error');
    }
  }

  private applyDefaults(d: HolidayDefaults): void {
    this.defaults.set(d);
    this.firm.set(d.firmCalendarId);
    this.podChoice.set(Object.fromEntries(d.podDefaults.map((p) => [p.podId, p.calendarId])));
  }

  async loadHolidays(): Promise<void> {
    const id = this.selectedId();
    if (id === null) {
      this.holidays.set([]);
      this.preview.set([]);
      this.listState.set('ready');
      return;
    }
    this.listState.set('loading');
    try {
      const [h, p] = await Promise.all([this.api.holidays(id), this.api.preview(id, this.year())]);
      if (id !== this.selectedId()) return;
      this.holidays.set(h);
      this.preview.set(p);
      this.listState.set('ready');
    } catch {
      this.listState.set('error');
    }
  }

  protected summary(c: HolidayCalendar): string {
    const people = c.appliesToEveryone
      ? `${c.peopleCount} people (everyone)`
      : `${c.peopleCount} people`;
    const d = this.defaults();
    const isFirm = d?.firmCalendarId === c.calendarId ? ' · firm default' : '';
    return `${c.holidayCount} ${c.holidayCount === 1 ? 'holiday' : 'holidays'} · ${people}${isFirm}`;
  }

  protected select(id: number): void {
    if (id === this.selectedId()) return;
    this.selectedId.set(id);
    this.query.set('');
    void this.loadHolidays();
  }

  protected setYear(year: number): void {
    if (year === this.year()) return;
    this.year.set(year);
    void this.loadHolidays();
  }

  protected weekday(date: string): string {
    return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  }
  protected rule = ruleText;

  // ---- calendars

  protected newCalendar(): void {
    this.editingCalendar.set(null);
    this.calendarOpen.set(true);
  }
  protected editCalendar(c: HolidayCalendar): void {
    this.editingCalendar.set(c);
    this.calendarOpen.set(true);
  }
  protected async onCalendarSaved(c: HolidayCalendar): Promise<void> {
    this.selectedId.set(c.calendarId);
    this.calendars.set(await this.api.calendars());
    await this.loadHolidays();
  }
  protected askDeleteCalendar(c: HolidayCalendar): void {
    this.deleteError.set('');
    this.deleteCal.set(c);
  }
  protected async confirmDeleteCalendar(c: HolidayCalendar): Promise<void> {
    this.deleteBusy.set(true);
    try {
      await this.api.deleteCalendar(c.calendarId, c.rowVersion);
      this.deleteCal.set(null);
      this.notify.success('Calendar deleted', c.name, { key: 'holiday-calendar' });
      this.selectedId.set(null);
      await this.load();
    } catch (err) {
      this.deleteError.set(
        err instanceof ApiError ? err.message : 'The calendar could not be deleted. Try again.',
      );
    } finally {
      this.deleteBusy.set(false);
    }
  }

  // ---- holidays

  protected addHoliday(): void {
    this.editingHoliday.set(null);
    this.holidayOpen.set(true);
  }
  protected editHoliday(h: Holiday): void {
    this.editingHoliday.set(h);
    this.holidayOpen.set(true);
  }
  protected async afterHolidayChange(): Promise<void> {
    this.calendars.set(await this.api.calendars());
    await this.loadHolidays();
  }
  protected askDeleteHoliday(h: Holiday): void {
    this.deleteError.set('');
    this.deleteDay.set(h);
  }
  protected cancelDelete(): void {
    this.deleteCal.set(null);
    this.deleteDay.set(null);
  }
  protected async confirmDeleteHoliday(h: Holiday): Promise<void> {
    const id = this.selectedId();
    if (id === null) return;
    this.deleteBusy.set(true);
    try {
      await this.api.deleteHoliday(id, h.holidayId, h.rowVersion);
      this.deleteDay.set(null);
      this.notify.success('Holiday deleted', h.name, { key: 'holiday' });
      await this.afterHolidayChange();
    } catch (err) {
      this.deleteError.set(
        err instanceof ApiError ? err.message : 'The holiday could not be deleted. Try again.',
      );
    } finally {
      this.deleteBusy.set(false);
    }
  }

  // ---- defaults

  protected podCal(podId: number): number | null {
    return this.podChoice()[podId] ?? null;
  }
  protected setFirm(value: string): void {
    this.firm.set(value === '' ? null : Number(value));
  }
  protected setPod(podId: number, value: string): void {
    this.podChoice.update((m) => ({ ...m, [podId]: value === '' ? null : Number(value) }));
  }
  protected async saveDefaults(): Promise<void> {
    const d = this.defaults();
    if (!d || this.defaultsBusy()) return;
    this.defaultsBusy.set(true);
    this.defaultsError.set('');
    try {
      const saved = await this.api.saveDefaults({
        firmCalendarId: this.firm(),
        podDefaults: this.pods().map((p) => ({ podId: p.podId, calendarId: this.podCal(p.podId) })),
        rowVersion: d.rowVersion,
      });
      this.applyDefaults(saved);
      this.calendars.set(await this.api.calendars());
      this.notify.success('Calendar defaults saved', undefined, { key: 'holiday-defaults' });
    } catch (err) {
      this.defaultsError.set(
        err instanceof ApiError && err.status === 409
          ? 'The defaults were changed by someone else. The latest are shown; make your change again.'
          : err instanceof ApiError
            ? err.message
            : 'The defaults could not be saved. Try again.',
      );
      if (err instanceof ApiError && err.status === 409)
        this.applyDefaults(await this.api.defaults());
    } finally {
      this.defaultsBusy.set(false);
    }
  }
}
