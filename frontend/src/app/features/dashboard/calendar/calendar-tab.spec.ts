import { provideCalendarFixtures } from '../../../shared/testing/calendar-testing';
import { inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { DashboardClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { ddChoose } from '../../../testing/dropdown-testing.spec-util';
import { DashScope } from '../dash-scope';
import { aScopeChoices, scopesMock } from '../dash-scope-testing';
import { CALENDAR_API, CalendarApi } from './calendar-api';
import { FixtureCalendarApi } from './calendar-fixtures';
import { DashCalendarTab } from './calendar-tab';
import { DAY_COUNT_TIPS } from './calendar-model';
import { filterGroups, loadState } from './calendar-panel';
import { forecastWord, riskSentence, weekRangeText } from './calendar-insights';

const PERMS: Permission[] = [
  'Task.View',
  'Dashboard.View',
  'Dashboard.ViewCalendar',
  'Dashboard.ViewAbsenceReasons',
];

describe('DashCalendarTab', () => {
  let harness: RouterTestingHarness;
  let host: HTMLElement;

  async function open(
    url = '/dashboard',
    permissions: Permission[] = PERMS,
    override?: Partial<CalendarApi>,
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'dashboard', component: DashCalendarTab }]),
        provideFakeMe(new FakeMeApi({ ...withPermissions(...permissions), userId: 5 })),
        { provide: DashboardClient, useValue: { getDashboardScopes: scopesMock(aScopeChoices()) } },
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        // Tuesday 11/03/2026, as in the approved mockup.
        { provide: Clock, useValue: { now: () => new Date('2026-11-03T15:42:00Z') } },
        ...provideCalendarFixtures(),
        {
          provide: CALENDAR_API,
          useFactory: () => {
            const fixture = inject(FixtureCalendarApi);
            return override ? ({ ...bind(fixture), ...override } as CalendarApi) : fixture;
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    const scope = TestBed.inject(DashScope);
    scope.ensureLoaded();
    const named = new URL(url, 'http://localhost').searchParams;
    scope.applyAddress((k) => named.get(k));
    await harness.navigateByUrl(url, DashCalendarTab);
    await settle();
    host = harness.routeNativeElement as HTMLElement;
    document.body.appendChild(host);
  }

  const bind = (f: FixtureCalendarApi): CalendarApi => ({
    days: f.days.bind(f),
    day: f.day.bind(f),
    summary: f.summary.bind(f),
  });

  async function settle() {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
  }

  const q = <T extends HTMLElement>(s: string) => host.querySelector<T>(s)!;
  const qa = <T extends HTMLElement>(s: string) => Array.from(host.querySelectorAll<T>(s));
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const cell = (date: string) => q<HTMLButtonElement>(`[data-day="${date}"]`);
  const url = () => TestBed.inject(Router).url;

  afterEach(() => {
    host?.remove();
    TestBed.resetTestingModule();
  });

  it('shows November 2026 as a Sunday-first month with today filled and the legend', async () => {
    await open();
    expect(text(q('[data-cal-title]'))).toBe('November 2026');
    expect(qa('[data-day]').length).toBe(35);
    expect(qa('[data-day]')[0].dataset['day']).toBe('2026-11-01');
    expect(cell('2026-11-03').classList.contains('today')).toBe(true);
    expect(text(q('[data-cal-legend]'))).toContain('Good');
    expect(text(q('[data-cal-legend]'))).toContain('Critical');
    expect(text(q('[data-cal-legend]'))).toContain('Non-working');
  });

  it('Thanksgiving is a Good cell that says "6 of 6 expected" with the holiday chip, not 6 of 36', async () => {
    await open();
    const c = cell('2026-11-26');
    expect(c.dataset['level']).toBe('GOOD');
    expect(text(c)).toContain('6 of 6 expected');
    expect(text(c)).toContain('Thanksgiving');
    expect(c.getAttribute('aria-label')).toContain('6 of 6 expected');
    expect(c.getAttribute('aria-label')).toContain('coverage Good');
    expect(c.getAttribute('title')).toContain('36 in view');
  });

  it('a Good day is quiet: neutral, no label; only thin days are coloured and labelled', async () => {
    await open();
    const good = cell('2026-11-26');
    expect(good.classList.contains('cv-quiet')).toBe(true);
    expect(good.querySelector('.lv')).toBeNull();
    expect(good.querySelector('.cnt--quiet')).not.toBeNull();
    const thin = qa('[data-day]').filter((d) =>
      ['WATCH', 'LOW', 'CRITICAL'].includes(d.dataset['level']!),
    );
    expect(thin.length).toBeGreaterThan(0);
    for (const d of thin) expect(d.querySelector('.lv')).not.toBeNull();
  });

  it('the forecast is Free task slots with real dates, and the risk bar is slim', async () => {
    await open();
    expect(text(q('[data-forecast]'))).toContain('Free Task Slots, Next 4 Weeks');
    expect(text(q('[data-forecast]'))).not.toContain('Wk ');
    expect(text(q('[data-forecast] [data-week]'))).toMatch(/\d{2}\/\d{2} to \d{2}\/\d{2}/);
    expect(q('[data-risk-banner]')).not.toBeNull();
  });

  it('a thin day has its level as an icon and a word, and weekends are muted', async () => {
    await open();
    const risky = cell('2026-11-25');
    expect(['LOW', 'CRITICAL', 'WATCH']).toContain(risky.dataset['level']);
    expect(risky.querySelector('.lv i.pi')).not.toBeNull();
    expect(risky.querySelector('.lw')?.textContent?.trim().length).toBeGreaterThan(0);
    expect(cell('2026-11-28').dataset['level']).toBe('NON_WORKING');
    expect(cell('2026-11-28').classList.contains('muted')).toBe(true);
  });

  it('Month: Saturday, Sunday and holiday numbers are red; the weekday heading is its own row without capitals (#1225)', async () => {
    await open();
    const heads = qa('.dow span');
    expect(heads.map((h) => text(h))).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(heads.filter((h) => h.classList.contains('dow--off')).map((h) => text(h))).toEqual([
      'Sun',
      'Sat',
    ]);
    const num = (date: string) => cell(date).querySelector('.num')!;
    // Sunday, Saturday, Thanksgiving (a Thursday holiday): red. A plain Tuesday: not.
    for (const d of ['2026-11-01', '2026-11-07', '2026-11-26']) {
      expect(num(d).classList.contains('num--off')).toBe(true);
    }
    expect(num('2026-11-03').classList.contains('num--off')).toBe(false);
    expect(text(q('[data-cal-legend-red] .lg__red'))).toBe('12');
    expect(text(q('[data-cal-legend-red]'))).toContain('Red numbers = weekend or holiday');
  });

  it('Week: Saturday, Sunday and holiday headings are red and the header keeps one look (#1225)', async () => {
    await open('/dashboard?cal=week&week=2026-11-22');
    const head = (date: string) => q(`th.dh:has([data-day="${date}"])`);
    expect(head('2026-11-22').classList.contains('off')).toBe(true); // Sunday
    expect(head('2026-11-28').classList.contains('off')).toBe(true); // Saturday
    expect(head('2026-11-26').classList.contains('off')).toBe(true); // Thanksgiving
    expect(head('2026-11-24').classList.contains('off')).toBe(false);
    expect(text(head('2026-11-28').querySelector('.dn'))).toBe('Sat');
  });

  it('Previous, Next and Today move the month and keep the address short', async () => {
    await open();
    q<HTMLButtonElement>('[data-next]').click();
    await settle();
    expect(text(q('[data-cal-title]'))).toBe('December 2026');
    expect(url()).toContain('month=2026-12');
    q<HTMLButtonElement>('[data-prev]').click();
    await settle();
    q<HTMLButtonElement>('[data-prev]').click();
    await settle();
    expect(text(q('[data-cal-title]'))).toBe('October 2026');
    q<HTMLButtonElement>('[data-today]').click();
    await settle();
    expect(text(q('[data-cal-title]'))).toBe('November 2026');
    expect(url()).not.toContain('month=');
  });

  it('arrow keys move between days inside the grid (one tab stop)', async () => {
    await open();
    const stops = qa('[data-day][tabindex="0"]');
    expect(stops.length).toBe(1);
    const first = cell('2026-11-10');
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(document.activeElement).toBe(cell('2026-11-11'));
    cell('2026-11-11').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    await settle();
    expect(document.activeElement).toBe(cell('2026-11-18'));
  });

  it('Week shows pods by days with the all-pods row first', async () => {
    await open('/dashboard?cal=week');
    expect(text(q('[data-cal-title]'))).toBe('Week of 11/01 to 11/07');
    const rows = qa('tbody tr');
    expect(rows.length).toBe(6);
    expect(text(rows[0].querySelector('th'))).toContain('All pods in view');
    expect(text(rows[1].querySelector('th'))).toContain('Review');
    expect(q('[data-view-week]').getAttribute('aria-pressed')).toBe('true');
  });

  it('the banner and the forecast come from the summary', async () => {
    await open();
    expect(text(q('[data-risk-banner]'))).toMatch(/risk days? in the next 30 days/);
    expect(qa('[data-forecast] [data-week]').length).toBe(4);
  });

  it('clicking a day opens its panel: counts, pods, and the two lists sorted by workload', async () => {
    await open();
    cell('2026-11-25').click();
    await settle();
    expect(url()).toContain('day=2026-11-25');
    const panel = q('[data-cal-panel]');
    expect(text(panel.querySelector('[data-panel-date]'))).toBe('Wednesday, November 25, 2026');
    expect(qa('[data-count]').length).toBe(3);
    // Coverage by pod is folded by default and opens with its toggle; the pod level is an icon (the word is for assistive tools).
    expect(q('[data-panel-pods]').hidden).toBe(true);
    expect(text(q('[data-panel-level]'))).toMatch(/expected people are available \(\d+%\)/);
    q<HTMLButtonElement>('[data-pods-toggle]').click();
    await settle();
    expect(q('[data-panel-pods]').hidden).toBe(false);
    expect(qa('[data-pod]').length).toBe(5);
    const loads = (list: string) =>
      qa(`[data-list="${list}"] [data-role-group]`).map((group) =>
        Array.from(group.querySelectorAll('.ld__n')).map((n) => Number(n.textContent)),
      );
    for (const l of loads('available')) expect(l).toEqual([...l].sort((a, b) => a - b));
    // Not Available rows show the reason chip instead of the load (the server's order, heaviest first, is kept).
    expect(q('[data-list="unavailable"]').querySelector('.ld__n')).toBeNull();
    expect(q('[data-list="unavailable"]').querySelectorAll('[data-reason]').length).toBeGreaterThan(
      0,
    );
    expect(text(q('[data-list="unavailable"]'))).toMatch(/Vacation|Sick|Training|Conference/);
    expect(text(q('[data-list="unavailable"]'))).toContain('Back ');
  });

  it('the day panel has three count tiles (Available, Out of Office, Off Hours), no On Holiday tile, each with its one-sentence tooltip and description (#1234)', async () => {
    await open();
    cell('2026-11-26').click(); // Thanksgiving: the holiday people are counted in Off Hours
    await settle();
    expect(qa('[data-count]').map((e) => e.getAttribute('data-count'))).toEqual([
      'available',
      'out',
      'off',
    ]);
    expect(text(q('[data-panel-counts]'))).not.toContain('On Holiday');
    for (const [key, sentence] of Object.entries(DAY_COUNT_TIPS)) {
      expect(text(q(`[data-count="${key}"] dt .sr-only`))).toContain(sentence);
    }
    expect(text(q('[data-count="available"] dt'))).toContain('Available');
    expect(text(q('[data-count="out"] dt'))).toContain('Out of Office');
    expect(text(q('[data-count="off"] dt'))).toContain('Off Hours');
  });

  it('without the reasons permission no absence type exists in the DOM', async () => {
    await open(
      '/dashboard?day=2026-11-25',
      PERMS.filter((p) => p !== 'Dashboard.ViewAbsenceReasons'),
    );
    expect(host.querySelector('[data-cal-panel]')).not.toBeNull();
    for (const t of ['Vacation', 'Sick', 'Training', 'Conference'])
      expect(text(host)).not.toContain(t);
  });

  it('searching the panel filters both lists and says when nobody matches', async () => {
    await open('/dashboard?day=2026-11-25');
    const input = q<HTMLInputElement>('[data-panel-search]');
    input.value = 'Priya';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(qa('[data-user]').length).toBe(1);
    input.value = 'zzzz';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(qa('[data-list-empty]').length).toBe(2);
    expect(text(q('[data-list-empty]'))).toContain('No one matches "zzzz"');
  });

  describe('the day panel people lists (#1242)', () => {
    const bands = (list: string) => qa<HTMLButtonElement>(`[data-list="${list}"] .gh`);
    const rows = (list: string) => qa(`[data-list="${list}"] .person`);
    const stored = () => JSON.parse(localStorage.getItem('mf.dashboard.v2.5') ?? 'null');

    beforeEach(() => {
      try {
        localStorage.clear();
      } catch {
        /* storage blocked: the spec still runs */
      }
    });

    it('every role is a header band (a button with aria-expanded and aria-controls) that sticks to the top of the panel, and the groups start expanded', async () => {
      await open('/dashboard?day=2026-11-25');
      expect(bands('available').length).toBeGreaterThan(1);
      for (const band of bands('available')) {
        expect(band.getAttribute('aria-expanded')).toBe('true');
        const list = host.querySelector(`#${band.getAttribute('aria-controls')}`)!;
        expect(list.hasAttribute('hidden')).toBe(false);
        expect(band.closest('h4')!.classList.contains('role')).toBe(true);
        expect(getComputedStyle(band.closest('h4')!).position).toBe('sticky');
        expect(band.querySelector('mf-count-chip')).not.toBeNull();
      }
      expect(text(q('#cp-av'))).toContain('Available');
      expect(text(q('#cp-un'))).toBe(
        `Not Available ${qa('[data-list="unavailable"] .person').length}`,
      );
    });

    it('clicking a band collapses that role in both lists and the choice is remembered for the user', async () => {
      await open('/dashboard?day=2026-11-25');
      const first = bands('available')[0];
      const roleId = first.getAttribute('data-role')!;
      const before = rows('available').length;
      first.click();
      await settle();
      expect(first.getAttribute('aria-expanded')).toBe('false');
      expect(
        host.querySelector(`#${first.getAttribute('aria-controls')}`)!.hasAttribute('hidden'),
      ).toBe(true);
      // The same role in Not Available follows (one choice per role).
      for (const band of bands('unavailable').filter((b) => b.getAttribute('data-role') === roleId))
        expect(band.getAttribute('aria-expanded')).toBe('false');
      expect(stored().calendarCollapsed).toEqual([Number(roleId)]);
      expect(rows('available').length).toBe(before);
      // A new visit to the page keeps the role collapsed.
      host.remove();
      TestBed.resetTestingModule();
      await open('/dashboard?day=2026-11-25');
      expect(bands('available')[0].getAttribute('aria-expanded')).toBe('false');
      // Pressing again expands it and the stored list is empty again (the key is removed).
      bands('available')[0].click();
      await settle();
      expect(bands('available')[0].getAttribute('aria-expanded')).toBe('true');
      expect(stored().calendarCollapsed).toBeUndefined();
    });

    it('Collapse All and Expand All act on every role shown', async () => {
      await open('/dashboard?day=2026-11-25');
      const button = () => q<HTMLButtonElement>('[data-collapse-all]');
      expect(text(button())).toBe('Collapse All');
      button().click();
      await settle();
      expect(text(button())).toBe('Expand All');
      for (const band of [...bands('available'), ...bands('unavailable')])
        expect(band.getAttribute('aria-expanded')).toBe('false');
      button().click();
      await settle();
      expect(text(button())).toBe('Collapse All');
      for (const band of [...bands('available'), ...bands('unavailable')])
        expect(band.getAttribute('aria-expanded')).toBe('true');
    });

    it('one jump chip per Available role, in the order of the groups, with its count; a chip expands a collapsed role and moves the focus to its band', async () => {
      await open('/dashboard?day=2026-11-25');
      const chips = qa<HTMLButtonElement>('[data-jump] button.chip');
      const groups = qa('[data-list="available"] [data-role-group]');
      expect(chips.length).toBe(groups.length);
      chips.forEach((chip, i) => {
        const name = text(groups[i].querySelector('.gh__n'));
        const count = groups[i].querySelectorAll('.person').length;
        expect(text(chip)).toBe(`${name} ${count}`);
      });
      const roleId = bands('available')[1].getAttribute('data-role')!;
      bands('available')[1].click();
      await settle();
      expect(bands('available')[1].getAttribute('aria-expanded')).toBe('false');
      chips[1].click();
      await settle();
      expect(bands('available')[1].getAttribute('aria-expanded')).toBe('true');
      expect(stored()?.calendarCollapsed ?? []).not.toContain(Number(roleId));
      expect(document.activeElement).toBe(bands('available')[1]);
    });

    it('a row is compact: the state icon, the name, the pods on one line and the load with three dots; the state is in the accessible name, not in a chip', async () => {
      await open('/dashboard?day=2026-11-25');
      const row = rows('available')[0];
      expect(row.querySelector('mf-user-state-icon')).not.toBeNull();
      expect(row.querySelector('.who__p')).not.toBeNull();
      expect(row.querySelectorAll('.dot').length).toBe(3);
      expect(row.querySelector('mf-status-chip, .cs, .chips')).toBeNull();
      const name = row.getAttribute('aria-label')!;
      expect(name).toMatch(/^.+, \d+ open tasks?, (Idle|Light|Normal|Heavy), Available$/);
      // The icon shape follows the load: 0 Idle, 1 Light, 2 Normal, 3 or more Heavy.
      for (const r of rows('available')) {
        const load = Number(text(r.querySelector('.ld__n')));
        const state = ['idle', 'light', 'normal'][load] ?? 'heavy';
        expect(r.getAttribute('data-state')).toBe(state);
        expect(r.querySelectorAll('.dot--on').length).toBe(Math.min(load, 3));
      }
    });

    it('Not Available rows show the reason chip (Back MM/DD, Holiday, Off Hours) and the out-of-office or off-hours icon', async () => {
      await open('/dashboard?day=2026-11-25');
      const out = rows('unavailable').find((r) => r.getAttribute('data-state') === 'out')!;
      expect(text(out.querySelector('[data-reason]'))).toMatch(/^Back \d\d\/\d\d$/);
      expect(out.getAttribute('aria-label')).toMatch(/Out of Office/);
      host.remove();
      TestBed.resetTestingModule();
      await open('/dashboard?day=2026-11-26');
      expect(
        rows('unavailable').some((r) =>
          /Holiday|Off Hours/.test(text(r.querySelector('[data-reason]'))),
        ),
      ).toBe(true);
    });
  });

  it('the Close button closes the panel and the address forgets the day', async () => {
    await open('/dashboard?day=2026-11-25');
    q<HTMLButtonElement>('[data-panel-close]').click();
    await settle();
    expect(host.querySelector('[data-cal-panel]')).toBeNull();
    expect(url()).not.toContain('day=');
  });

  it('the Role filter narrows the month to that role and is kept in the address', async () => {
    await open();
    ddChoose(host, 'Filter by Role', 'Data Scientist');
    await settle();
    expect(url()).toContain('role=1');
    expect(cell('2026-11-03').getAttribute('title')).toContain('5 in view');
  });

  it('an error shows the retry state and Retry reads again', async () => {
    let fail = true;
    await open('/dashboard', PERMS, {
      days: (from, to, q) =>
        fail
          ? Promise.reject(new ApiError(500, undefined, 'x', undefined, {} as never))
          : TestBed.inject(FixtureCalendarApi).days(from, to, q),
    });
    expect(host.querySelector('[data-dash-state="error"]')).not.toBeNull();
    fail = false;
    q<HTMLButtonElement>('[data-dash-retry]').click();
    await settle();
    expect(host.querySelector('[data-dash-state="error"]')).toBeNull();
  });

  it('Add out of office is offered only with User.ManageAvailability', async () => {
    await open();
    expect(host.querySelector('[data-add-absence]')).toBeNull();
    host.remove();
    TestBed.resetTestingModule();
    await open('/dashboard', [...PERMS, 'User.ManageAvailability']);
    expect(host.querySelector('[data-add-absence]')).not.toBeNull();
  });
});

describe('forecast dates', () => {
  it('words a week as real dates', () => {
    expect(weekRangeText('2026-11-01')).toBe('11/01 to 11/07');
    expect(weekRangeText('2026-10-27')).toBe('10/27 to 11/02');
  });
});

describe('panel helpers', () => {
  const groups = [
    {
      roleId: 1,
      roleName: 'A',
      people: [
        { userId: 1, displayName: 'Ann Lee', podNames: ['P'], load: 0 },
        { userId: 2, displayName: 'Bob Ray', podNames: ['P'], load: 2 },
      ],
    },
    {
      roleId: 2,
      roleName: 'B',
      people: [{ userId: 3, displayName: 'Cy Tan', podNames: ['P'], load: 1 }],
    },
  ];
  it('filters by name and drops empty groups, keeping the server order', () => {
    expect(filterGroups(groups, 'ra').map((g) => g.people.map((p) => p.displayName))).toEqual([
      ['Bob Ray'],
    ]);
    expect(filterGroups(groups, '').length).toBe(2);
    expect(filterGroups(groups, 'zz')).toEqual([]);
  });
  it('names the load by the capacity words', () => {
    expect([0, 1, 2, 3, 7].map(loadState)).toEqual([
      'AVAILABLE',
      'OCCUPIED',
      'BUSY',
      'OVERLOADED',
      'OVERLOADED',
    ]);
  });
  it('words the forecast and the risk sentence', () => {
    expect(forecastWord(51).word).toBe('Healthy');
    expect(forecastWord(39).word).toBe('Limited');
    expect(forecastWord(10).word).toBe('Low');
    expect(forecastWord(null).word).toBe('Nobody in');
    expect(
      riskSentence({
        daysAtRisk: 0,
        firstRiskDate: null,
        firstRiskLevel: null,
        worstPod: null,
        windowDays: 30,
      }),
    ).toBe('No risk days in the next 30 days.');
    expect(
      riskSentence({
        daysAtRisk: 3,
        firstRiskDate: '2026-11-17',
        firstRiskLevel: 'WATCH',
        worstPod: { podId: 5, name: 'Data Science' },
        windowDays: 30,
      }),
    ).toBe(
      '3 risk days in the next 30 days. First: Tue 11/17 (Watch). Thinnest pod: Data Science.',
    );
  });
});
