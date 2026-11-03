import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ApiError } from '../../../core/http/api-error';
import type { HolidayApi, UserCalendar } from './holiday-api';
import type {
  CalendarInput,
  CalendarThresholds,
  Holiday,
  HolidayCalendar,
  HolidayDefaults,
  HolidayInput,
  ImportLine,
  ImportResult,
  PodRef,
  PreviewRow,
} from './holiday-contract';
import { expandYear } from './holiday-rules';

const fail = (status: number, code: string, detail: string): ApiError =>
  ApiError.from(new HttpErrorResponse({ status, error: { status, code, detail } }));

const blank = (over: Partial<Holiday>): Holiday => ({
  holidayId: 0,
  name: '',
  ruleKind: 'FIXED',
  month: null,
  day: null,
  nth: null,
  weekday: null,
  easterOffset: null,
  onceDate: null,
  endMonth: null,
  endDay: null,
  onceEnd: null,
  yearly: true,
  weekendRule: 'NONE',
  regionNote: null,
  plusDays: null,
  rowVersion: 'v1',
  ...over,
});

const PODS: PodRef[] = [
  { podId: 1, name: 'Review' },
  { podId: 2, name: 'Processing' },
  { podId: 3, name: 'Production' },
  { podId: 4, name: 'QC' },
  { podId: 5, name: 'Data Science' },
];

/** "MM/DD/YYYY" to `yyyy-MM-dd`, or null when it is not a real date. */
function parseDate(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * TEMPORARY: the holiday administration API in memory, from the mockup's three calendars (US Holiday, UK Holiday, Firm closure), for the Settings > Holidays screens, the person's
 * calendar field and the threshold form until the generated client is pushed. The preview uses the rule maths of `holiday-rules.ts`.
 */
@Injectable({ providedIn: 'root' })
export class FixtureHolidayApi implements HolidayApi {
  private nextId = 1000;
  private calendarList: HolidayCalendar[] = [
    {
      calendarId: 1,
      name: 'US Holiday',
      colourKey: 'indigo',
      regionNote: 'United States federal holidays the firm observes',
      appliesToEveryone: false,
      isActive: true,
      holidayCount: 0,
      peopleCount: 30,
      rowVersion: 'c1',
    },
    {
      calendarId: 2,
      name: 'UK Holiday',
      colourKey: 'rose',
      regionNote: 'Bank holidays of England and Wales (London office)',
      appliesToEveryone: false,
      isActive: true,
      holidayCount: 0,
      peopleCount: 6,
      rowVersion: 'c2',
    },
    {
      calendarId: 3,
      name: 'Firm closure',
      colourKey: 'green',
      regionNote: 'Applies to everyone, whatever their own calendar',
      appliesToEveryone: true,
      isActive: true,
      holidayCount: 0,
      peopleCount: 36,
      rowVersion: 'c3',
    },
  ];
  private holidayMap = new Map<number, Holiday[]>([
    [
      1,
      [
        blank({ holidayId: 1, name: "New Year's Day", month: 1, day: 1, weekendRule: 'US' }),
        blank({
          holidayId: 2,
          name: 'Martin Luther King Jr. Day',
          ruleKind: 'NTH_WEEKDAY',
          month: 1,
          nth: 3,
          weekday: 1,
        }),
        blank({
          holidayId: 3,
          name: "Presidents' Day",
          ruleKind: 'NTH_WEEKDAY',
          month: 2,
          nth: 3,
          weekday: 1,
        }),
        blank({
          holidayId: 4,
          name: 'Memorial Day',
          ruleKind: 'NTH_WEEKDAY',
          month: 5,
          nth: -1,
          weekday: 1,
        }),
        blank({ holidayId: 5, name: 'Juneteenth', month: 6, day: 19, weekendRule: 'US' }),
        blank({ holidayId: 6, name: 'Independence Day', month: 7, day: 4, weekendRule: 'US' }),
        blank({
          holidayId: 7,
          name: 'Labor Day',
          ruleKind: 'NTH_WEEKDAY',
          month: 9,
          nth: 1,
          weekday: 1,
        }),
        blank({
          holidayId: 8,
          name: 'Thanksgiving',
          ruleKind: 'NTH_WEEKDAY',
          month: 11,
          nth: 4,
          weekday: 4,
        }),
        blank({
          holidayId: 9,
          name: 'Day after Thanksgiving',
          ruleKind: 'NTH_WEEKDAY',
          month: 11,
          nth: 4,
          weekday: 4,
          plusDays: 1,
        }),
        blank({ holidayId: 10, name: 'Christmas Day', month: 12, day: 25, weekendRule: 'US' }),
        blank({
          holidayId: 11,
          name: 'Office move day',
          ruleKind: 'ONCE',
          onceDate: '2027-02-12',
          yearly: false,
          regionNote: 'Chicago office',
        }),
      ],
    ],
    [
      2,
      [
        blank({ holidayId: 21, name: "New Year's Day", month: 1, day: 1, weekendRule: 'UK' }),
        blank({ holidayId: 22, name: 'Good Friday', ruleKind: 'EASTER_OFFSET', easterOffset: -2 }),
        blank({ holidayId: 23, name: 'Easter Monday', ruleKind: 'EASTER_OFFSET', easterOffset: 1 }),
        blank({
          holidayId: 24,
          name: 'Early May bank holiday',
          ruleKind: 'NTH_WEEKDAY',
          month: 5,
          nth: 1,
          weekday: 1,
        }),
        blank({
          holidayId: 25,
          name: 'Spring bank holiday',
          ruleKind: 'NTH_WEEKDAY',
          month: 5,
          nth: -1,
          weekday: 1,
        }),
        blank({
          holidayId: 26,
          name: 'Summer bank holiday',
          ruleKind: 'NTH_WEEKDAY',
          month: 8,
          nth: -1,
          weekday: 1,
        }),
        blank({ holidayId: 27, name: 'Christmas Day', month: 12, day: 25, weekendRule: 'UK' }),
        blank({ holidayId: 28, name: 'Boxing Day', month: 12, day: 26, weekendRule: 'UK' }),
      ],
    ],
    [
      3,
      [
        blank({
          holidayId: 31,
          name: 'Year-end closure',
          ruleKind: 'RANGE',
          month: 12,
          day: 28,
          endMonth: 12,
          endDay: 31,
        }),
      ],
    ],
  ]);
  private defaultValue: HolidayDefaults = {
    firmCalendarId: 1,
    podDefaults: [
      { podId: 1, calendarId: null },
      { podId: 2, calendarId: null },
      { podId: 3, calendarId: null },
      { podId: 4, calendarId: null },
      { podId: 5, calendarId: 2 },
    ],
    rowVersion: 'd1',
  };
  private userChoice = new Map<number, number | null>();
  private limits: CalendarThresholds = {
    minCoveragePercent: 75,
    podMinimumPercent: 60,
    podMinimums: [
      { podId: 1, people: 6 },
      { podId: 2, people: 5 },
      { podId: 3, people: 4 },
      { podId: 4, people: 4 },
      { podId: 5, people: 3 },
    ],
    defaults: { minCoveragePercent: 75, podMinimumPercent: 60 },
    isCustom: false,
    rowVersion: 't1',
  };

  private withCounts(c: HolidayCalendar): HolidayCalendar {
    return { ...c, holidayCount: (this.holidayMap.get(c.calendarId) ?? []).length };
  }

  calendars(): Promise<HolidayCalendar[]> {
    return Promise.resolve(this.calendarList.map((c) => this.withCounts(c)));
  }

  saveCalendar(calendarId: number | null, input: CalendarInput): Promise<HolidayCalendar> {
    const name = input.name.trim();
    if (!name) return Promise.reject(fail(400, 'VALIDATION', 'Enter a category name.'));
    if (
      this.calendarList.some(
        (c) => c.calendarId !== calendarId && c.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      return Promise.reject(
        fail(400, 'CALENDAR_NAME_TAKEN', `A calendar named "${name}" exists already.`),
      );
    }
    if (calendarId === null) {
      const c: HolidayCalendar = {
        calendarId: ++this.nextId,
        name,
        colourKey: input.colourKey,
        regionNote: input.regionNote,
        appliesToEveryone: input.appliesToEveryone,
        isActive: true,
        holidayCount: 0,
        peopleCount: 0,
        rowVersion: `c${this.nextId}`,
      };
      this.calendarList.push(c);
      this.holidayMap.set(c.calendarId, []);
      return Promise.resolve(c);
    }
    const i = this.calendarList.findIndex((c) => c.calendarId === calendarId);
    if (i < 0) return Promise.reject(fail(404, 'NOT_FOUND', 'This calendar no longer exists.'));
    if (input.rowVersion !== this.calendarList[i].rowVersion) {
      return Promise.reject(
        fail(409, 'CONCURRENCY_CONFLICT', 'This calendar was changed by someone else.'),
      );
    }
    this.calendarList[i] = {
      ...this.calendarList[i],
      ...input,
      name,
      rowVersion: `c${calendarId}-${++this.nextId}`,
    };
    return Promise.resolve(this.withCounts(this.calendarList[i]));
  }

  deleteCalendar(calendarId: number): Promise<void> {
    if (this.defaultValue.firmCalendarId === calendarId) {
      return Promise.reject(
        fail(
          409,
          'CALENDAR_IN_USE',
          'This is the firm default. Choose another firm default first.',
        ),
      );
    }
    this.calendarList = this.calendarList.filter((c) => c.calendarId !== calendarId);
    this.holidayMap.delete(calendarId);
    return Promise.resolve();
  }

  holidays(calendarId: number): Promise<Holiday[]> {
    return Promise.resolve([...(this.holidayMap.get(calendarId) ?? [])]);
  }

  saveHoliday(calendarId: number, holidayId: number | null, input: HolidayInput): Promise<Holiday> {
    const list = this.holidayMap.get(calendarId) ?? [];
    if (!input.name.trim()) return Promise.reject(fail(400, 'VALIDATION', 'Enter a name.'));
    if (holidayId === null) {
      const h: Holiday = {
        ...input,
        name: input.name.trim(),
        holidayId: ++this.nextId,
        rowVersion: `h${this.nextId}`,
      };
      list.push(h);
      this.holidayMap.set(calendarId, list);
      return Promise.resolve(h);
    }
    const i = list.findIndex((h) => h.holidayId === holidayId);
    if (i < 0) return Promise.reject(fail(404, 'NOT_FOUND', 'This holiday no longer exists.'));
    if (input.rowVersion !== list[i].rowVersion) {
      return Promise.reject(
        fail(409, 'CONCURRENCY_CONFLICT', 'This holiday was changed by someone else.'),
      );
    }
    list[i] = {
      ...input,
      name: input.name.trim(),
      holidayId,
      rowVersion: `h${holidayId}-${++this.nextId}`,
    };
    return Promise.resolve(list[i]);
  }

  deleteHoliday(calendarId: number, holidayId: number): Promise<void> {
    this.holidayMap.set(
      calendarId,
      (this.holidayMap.get(calendarId) ?? []).filter((h) => h.holidayId !== holidayId),
    );
    return Promise.resolve();
  }

  preview(calendarId: number, year: number): Promise<PreviewRow[]> {
    return Promise.resolve(expandYear(this.holidayMap.get(calendarId) ?? [], year));
  }

  importLines(
    calendarId: number,
    text: string,
    year: number,
    dryRun: boolean,
  ): Promise<ImportResult> {
    const yearly = false;
    void year;
    const lines: ImportLine[] = [];
    text.split(/\r?\n/).forEach((raw, i) => {
      if (!raw.trim()) return;
      const [datePart, ...rest] = raw.includes('\t') ? raw.split('\t') : raw.split(/,(.*)/s);
      const name = rest.join(',').trim();
      const range = (datePart ?? '').split(/\s+-\s+/);
      const date = parseDate(range[0] ?? '');
      const end = range.length > 1 ? parseDate(range[1]) : null;
      const problem =
        !date || (range.length > 1 && !end)
          ? 'Use MM/DD/YYYY, Name or MM/DD/YYYY - MM/DD/YYYY, Name.'
          : !name
            ? 'The name is missing.'
            : end && end < date
              ? 'The last day is before the first day.'
              : '';
      lines.push(
        problem
          ? { line: i + 1, ok: false, message: problem }
          : {
              line: i + 1,
              ok: true,
              message: 'Ready',
              parsed: { date: date!, endDate: end, name },
            },
      );
    });
    const okLines = lines.filter((l) => l.ok);
    if (!dryRun && okLines.length > 0) {
      const list = this.holidayMap.get(calendarId) ?? [];
      for (const l of okLines) {
        const p = l.parsed!;
        list.push(
          blank({
            holidayId: ++this.nextId,
            name: p.name,
            ruleKind: p.endDate ? 'RANGE' : yearly ? 'FIXED' : 'ONCE',
            month: yearly ? Number(p.date.slice(5, 7)) : null,
            day: yearly ? Number(p.date.slice(8, 10)) : null,
            endMonth: yearly && p.endDate ? Number(p.endDate.slice(5, 7)) : null,
            endDay: yearly && p.endDate ? Number(p.endDate.slice(8, 10)) : null,
            onceDate: yearly ? null : p.date,
            onceEnd: yearly ? null : p.endDate,
            yearly,
          }),
        );
      }
      this.holidayMap.set(calendarId, list);
    }
    return Promise.resolve({
      lines,
      okCount: okLines.length,
      errorCount: lines.length - okLines.length,
    });
  }

  pods(): Promise<PodRef[]> {
    return Promise.resolve(PODS);
  }

  defaults(): Promise<HolidayDefaults> {
    return Promise.resolve(structuredClone(this.defaultValue));
  }

  saveDefaults(value: HolidayDefaults): Promise<HolidayDefaults> {
    if (value.rowVersion !== this.defaultValue.rowVersion) {
      return Promise.reject(
        fail(409, 'CONCURRENCY_CONFLICT', 'The defaults were changed by someone else.'),
      );
    }
    this.defaultValue = { ...structuredClone(value), rowVersion: `d${++this.nextId}` };
    return this.defaults();
  }

  private effective(userId: number): UserCalendar {
    const explicit = this.userChoice.get(userId) ?? null;
    if (explicit !== null)
      return {
        explicitCalendarId: explicit,
        effectiveCalendarId: explicit,
        effectiveSource: 'USER',
        podName: null,
      };
    const podId = userId % 5 === 0 ? 5 : ((userId - 1) % 5) + 1;
    const pod = this.defaultValue.podDefaults.find((p) => p.podId === podId);
    if (pod?.calendarId != null) {
      return {
        explicitCalendarId: null,
        effectiveCalendarId: pod.calendarId,
        effectiveSource: 'POD',
        podName: PODS.find((p) => p.podId === podId)?.name ?? null,
      };
    }
    return {
      explicitCalendarId: null,
      effectiveCalendarId: this.defaultValue.firmCalendarId,
      effectiveSource: this.defaultValue.firmCalendarId ? 'FIRM' : null,
      podName: null,
    };
  }

  userCalendar(userId: number): Promise<UserCalendar> {
    return Promise.resolve(this.effective(userId));
  }

  setUserCalendar(userId: number, calendarId: number | null): Promise<UserCalendar> {
    this.userChoice.set(userId, calendarId);
    return Promise.resolve(this.effective(userId));
  }

  thresholds(): Promise<CalendarThresholds> {
    return Promise.resolve(structuredClone(this.limits));
  }

  saveThresholds(
    value: Pick<
      CalendarThresholds,
      'minCoveragePercent' | 'podMinimumPercent' | 'podMinimums' | 'rowVersion'
    >,
  ): Promise<CalendarThresholds> {
    if (value.rowVersion !== this.limits.rowVersion) {
      return Promise.reject(
        fail(409, 'CONCURRENCY_CONFLICT', 'The thresholds were changed by someone else.'),
      );
    }
    if (value.podMinimumPercent > value.minCoveragePercent) {
      return Promise.reject(
        fail(400, 'THRESHOLD_ORDER', 'The pod minimum cannot be higher than the firm minimum.'),
      );
    }
    this.limits = {
      ...this.limits,
      ...structuredClone(value),
      isCustom: value.minCoveragePercent !== 75 || value.podMinimumPercent !== 60,
      rowVersion: `t${++this.nextId}`,
    };
    return this.thresholds();
  }
}
