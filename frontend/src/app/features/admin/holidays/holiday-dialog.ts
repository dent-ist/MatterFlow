import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DateInput } from 'form-engine';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { HOLIDAY_API } from './holiday-api';
import { Holiday, HolidayInput, HolidayRuleKind, WeekendRule } from './holiday-contract';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
type Shape = 'day' | 'range';
type Pattern = 'FIXED' | 'NTH_WEEKDAY' | 'EASTER_OFFSET';

/**
 * Add or edit one holiday (epic #1074, CAL-06) in the pop-up dialog standard. A holiday is a single day or a range, one-off or every year; a yearly single day follows a fixed date
 * (12/25), a weekday of a month (the 4th Thursday of November) or a number of days from Easter (Good Friday is 2 days before). A fixed date can move when it falls on a weekend (the US
 * rule, the UK rule). The server checks the values again; its messages sit under the form.
 */
@Component({
  selector: 'mf-holiday-dialog',
  imports: [FormDialog, DateInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-form-dialog
      [title]="holiday() ? 'Edit Holiday' : 'Add Holiday'"
      [subtitle]="calendarName()"
      [primaryLabel]="holiday() ? 'Save' : 'Add Holiday'"
      size="default"
      [dirty]="dirty()"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="visible"
      (submitted)="save()"
      data-holiday-dialog
    >
      <form class="hd" novalidate (submit)="$event.preventDefault(); save()">
        <div class="hd__f">
          <label class="hd__l" for="hd-name">Name</label>
          <input
            id="hd-name"
            class="mf-control mf-control--fill"
            maxlength="80"
            autocomplete="off"
            [attr.aria-invalid]="problem().name ? 'true' : null"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
          />
          @if (problem().name; as e) {
            <p class="hd__e" role="alert">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
            </p>
          }
        </div>
        <div class="hd__row">
          <fieldset class="hd__f hd__set">
            <legend class="hd__l">Length</legend>
            <label class="hd__r"
              ><input
                type="radio"
                name="hd-shape"
                [checked]="shape() === 'day'"
                (change)="shape.set('day')"
              />
              Single day</label
            >
            <label class="hd__r"
              ><input
                type="radio"
                name="hd-shape"
                [checked]="shape() === 'range'"
                (change)="shape.set('range')"
              />
              Range of days</label
            >
          </fieldset>
          <fieldset class="hd__f hd__set">
            <legend class="hd__l">Repeats</legend>
            <label class="hd__r"
              ><input type="radio" name="hd-rep" [checked]="yearly()" (change)="yearly.set(true)" />
              Every year</label
            >
            <label class="hd__r"
              ><input
                type="radio"
                name="hd-rep"
                [checked]="!yearly()"
                (change)="yearly.set(false)"
              />
              One time</label
            >
          </fieldset>
        </div>

        @if (yearly() && shape() === 'day') {
          <div class="hd__f">
            <label class="hd__l" for="hd-pattern">Date Rule</label>
            <select
              id="hd-pattern"
              class="mf-control mf-control--fill"
              [value]="pattern()"
              (change)="pattern.set($any($event.target).value)"
            >
              <option value="FIXED" [selected]="pattern() === 'FIXED'">A Fixed Date (12/25)</option>
              <option value="NTH_WEEKDAY" [selected]="pattern() === 'NTH_WEEKDAY'">
                A weekday of a month (4th Thursday of November)
              </option>
              <option value="EASTER_OFFSET" [selected]="pattern() === 'EASTER_OFFSET'">
                Days From Easter
              </option>
            </select>
          </div>
        }

        @if (yearly() && (shape() === 'range' || pattern() === 'FIXED')) {
          <div class="hd__row">
            <div class="hd__f">
              <label class="hd__l" for="hd-month">{{
                shape() === 'range' ? 'First day: month' : 'Month'
              }}</label>
              <select
                id="hd-month"
                class="mf-control mf-control--fill"
                [value]="month()"
                (change)="month.set(+$any($event.target).value)"
              >
                @for (m of months; track $index) {
                  <option [value]="$index + 1" [selected]="month() === $index + 1">{{ m }}</option>
                }
              </select>
            </div>
            <div class="hd__f">
              <label class="hd__l" for="hd-day">{{
                shape() === 'range' ? 'First day: day' : 'Day'
              }}</label>
              <input
                id="hd-day"
                class="mf-control mf-control--fill"
                type="number"
                min="1"
                max="31"
                inputmode="numeric"
                [value]="day()"
                (input)="day.set(+$any($event.target).value)"
              />
            </div>
          </div>
        }
        @if (yearly() && shape() === 'range') {
          <div class="hd__row">
            <div class="hd__f">
              <label class="hd__l" for="hd-emonth">Last Day: Month</label>
              <select
                id="hd-emonth"
                class="mf-control mf-control--fill"
                [value]="endMonth()"
                (change)="endMonth.set(+$any($event.target).value)"
              >
                @for (m of months; track $index) {
                  <option [value]="$index + 1" [selected]="endMonth() === $index + 1">
                    {{ m }}
                  </option>
                }
              </select>
            </div>
            <div class="hd__f">
              <label class="hd__l" for="hd-eday">Last Day: Day</label>
              <input
                id="hd-eday"
                class="mf-control mf-control--fill"
                type="number"
                min="1"
                max="31"
                inputmode="numeric"
                [value]="endDay()"
                (input)="endDay.set(+$any($event.target).value)"
              />
            </div>
          </div>
        }
        @if (yearly() && shape() === 'day' && pattern() === 'NTH_WEEKDAY') {
          <div class="hd__row hd__row--3">
            <div class="hd__f">
              <label class="hd__l" for="hd-nth">Which</label>
              <select
                id="hd-nth"
                class="mf-control mf-control--fill"
                [value]="nth()"
                (change)="nth.set(+$any($event.target).value)"
              >
                @for (o of nths; track o.v) {
                  <option [value]="o.v" [selected]="nth() === o.v">{{ o.t }}</option>
                }
              </select>
            </div>
            <div class="hd__f">
              <label class="hd__l" for="hd-wd">Weekday</label>
              <select
                id="hd-wd"
                class="mf-control mf-control--fill"
                [value]="weekday()"
                (change)="weekday.set(+$any($event.target).value)"
              >
                @for (w of weekdays; track $index) {
                  <option [value]="$index" [selected]="weekday() === $index">{{ w }}</option>
                }
              </select>
            </div>
            <div class="hd__f">
              <label class="hd__l" for="hd-nmonth">of</label>
              <select
                id="hd-nmonth"
                class="mf-control mf-control--fill"
                [value]="month()"
                (change)="month.set(+$any($event.target).value)"
              >
                @for (m of months; track $index) {
                  <option [value]="$index + 1" [selected]="month() === $index + 1">{{ m }}</option>
                }
              </select>
            </div>
          </div>
          <div class="hd__f">
            <label class="hd__l" for="hd-plus">Plus Days</label>
            <input
              id="hd-plus"
              class="mf-control"
              type="number"
              min="0"
              max="6"
              inputmode="numeric"
              aria-describedby="hd-plus-h"
              [value]="plus()"
              (input)="plus.set(+$any($event.target).value)"
            />
            <p class="hd__h" id="hd-plus-h">
              1 gives the day after: the Friday after the 4th Thursday of November.
            </p>
          </div>
        }
        @if (yearly() && shape() === 'day' && pattern() === 'EASTER_OFFSET') {
          <div class="hd__f">
            <label class="hd__l" for="hd-easter">Days From Easter Sunday</label>
            <input
              id="hd-easter"
              class="mf-control"
              type="number"
              min="-60"
              max="60"
              inputmode="numeric"
              aria-describedby="hd-easter-h"
              [value]="easter()"
              (input)="easter.set(+$any($event.target).value)"
            />
            <p class="hd__h" id="hd-easter-h">
              Negative is before: Good Friday is -2, Easter Monday is 1.
            </p>
          </div>
        }
        @if (!yearly()) {
          <div class="hd__row">
            <div class="hd__f">
              <label class="hd__l" for="hd-once">{{
                shape() === 'range' ? 'First day' : 'Date'
              }}</label>
              <mf-date-input
                inputId="hd-once"
                [showHint]="false"
                label="First Day"
                [isoValue]="once()"
                (isoChange)="once.set($event)"
                (textInvalid)="onceBad.set($event)"
              />
            </div>
            @if (shape() === 'range') {
              <div class="hd__f">
                <label class="hd__l" for="hd-onceend">Last Day</label>
                <mf-date-input
                  inputId="hd-onceend"
                  [showHint]="false"
                  label="Last Day"
                  [isoValue]="onceEnd()"
                  (isoChange)="onceEnd.set($event)"
                  (textInvalid)="onceEndBad.set($event)"
                />
              </div>
            }
          </div>
        }
        @if (problem().date; as e) {
          <p class="hd__e" role="alert" data-hd-date-error>
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
          </p>
        }

        @if (yearly() && shape() === 'day' && pattern() === 'FIXED') {
          <div class="hd__f">
            <label class="hd__l" for="hd-weekend">When It Falls on a Weekend</label>
            <select
              id="hd-weekend"
              class="mf-control mf-control--fill"
              [value]="weekendRule()"
              (change)="weekendRule.set($any($event.target).value)"
            >
              <option value="NONE" [selected]="weekendRule() === 'NONE'">Stays on That Day</option>
              <option value="US" [selected]="weekendRule() === 'US'">
                US rule: Saturday moves to Friday, Sunday to Monday
              </option>
              <option value="UK" [selected]="weekendRule() === 'UK'">
                UK rule: moves to the next Monday
              </option>
            </select>
          </div>
        }
        <div class="hd__f">
          <label class="hd__l" for="hd-note">Region Note</label>
          <input
            id="hd-note"
            class="mf-control mf-control--fill"
            maxlength="120"
            autocomplete="off"
            [value]="note()"
            (input)="note.set($any($event.target).value)"
          />
        </div>
      </form>
    </mf-form-dialog>
  `,
  styles: `
    .hd {
      display: grid;
      gap: var(--mf-s3);
      padding: var(--mf-s1);
    }
    .hd__f {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s1);
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .hd__row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s3);
    }
    .hd__row--3 {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    @media (max-width: 479.98px) {
      .hd__row,
      .hd__row--3 {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .hd__l {
      padding: 0;
      font-weight: 600;
    }
    .hd__r {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 28px;
    }
    .hd__h {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .hd__e {
      display: flex;
      gap: var(--mf-s1);
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class HolidayDialog {
  readonly visible = model(false);
  readonly calendarId = input.required<number>();
  readonly calendarName = input('');
  readonly holiday = input<Holiday | null>(null);
  readonly saved = output<Holiday>();

  private readonly api = inject(HOLIDAY_API);
  private readonly notify = inject(NotificationService);
  protected readonly months = MONTHS;
  protected readonly weekdays = WEEKDAYS;
  protected readonly nths = [
    { v: 1, t: '1st' },
    { v: 2, t: '2nd' },
    { v: 3, t: '3rd' },
    { v: 4, t: '4th' },
    { v: -1, t: 'Last' },
  ];

  protected readonly name = signal('');
  protected readonly shape = signal<Shape>('day');
  protected readonly yearly = signal(true);
  protected readonly pattern = signal<Pattern>('FIXED');
  protected readonly month = signal(1);
  protected readonly day = signal(1);
  protected readonly endMonth = signal(1);
  protected readonly endDay = signal(1);
  protected readonly nth = signal(1);
  protected readonly weekday = signal(1);
  protected readonly plus = signal(0);
  protected readonly easter = signal(0);
  protected readonly once = signal<string | null>(null);
  protected readonly onceEnd = signal<string | null>(null);
  protected readonly onceBad = signal(false);
  protected readonly onceEndBad = signal(false);
  protected readonly weekendRule = signal<WeekendRule>('NONE');
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly serverMessage = signal('');
  private readonly tried = signal(false);
  private baseline = '';

  protected readonly problem = computed<{ name?: string; date?: string }>(() => {
    const out: { name?: string; date?: string } = {};
    if (this.tried() && !this.name().trim()) out.name = 'Enter a name.';
    if (this.tried()) {
      if (this.onceBad() || this.onceEndBad()) out.date = 'Enter a valid date.';
      else if (!this.yearly() && !this.once()) out.date = 'Choose the date.';
      else if (
        !this.yearly() &&
        this.shape() === 'range' &&
        (!this.onceEnd() || this.onceEnd()! < this.once()!)
      ) {
        out.date = 'The last day must be on or after the first day.';
      } else if (
        this.yearly() &&
        (!this.validDay(this.month(), this.day()) ||
          (this.shape() === 'range' && !this.validDay(this.endMonth(), this.endDay())))
      ) {
        out.date = 'Enter a real day of the month.';
      }
    }
    if (this.serverMessage()) out.date = out.date ?? this.serverMessage();
    return out;
  });
  protected readonly dirty = computed(() => this.sig() !== this.baseline);

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => this.reset());
    });
  }

  private validDay(month: number, day: number): boolean {
    return (
      Number.isInteger(day) && day >= 1 && day <= new Date(Date.UTC(2024, month, 0)).getUTCDate()
    );
  }

  private sig(): string {
    return JSON.stringify([
      this.name().trim(),
      this.shape(),
      this.yearly(),
      this.pattern(),
      this.month(),
      this.day(),
      this.endMonth(),
      this.endDay(),
      this.nth(),
      this.weekday(),
      this.plus(),
      this.easter(),
      this.once(),
      this.onceEnd(),
      this.weekendRule(),
      this.note().trim(),
    ]);
  }

  private reset(): void {
    const h = this.holiday();
    this.name.set(h?.name ?? '');
    this.shape.set(h?.ruleKind === 'RANGE' ? 'range' : 'day');
    this.yearly.set(h ? h.yearly : true);
    this.pattern.set(
      h?.ruleKind === 'NTH_WEEKDAY'
        ? 'NTH_WEEKDAY'
        : h?.ruleKind === 'EASTER_OFFSET'
          ? 'EASTER_OFFSET'
          : 'FIXED',
    );
    this.month.set(h?.month ?? 1);
    this.day.set(h?.day ?? 1);
    this.endMonth.set(h?.endMonth ?? h?.month ?? 1);
    this.endDay.set(h?.endDay ?? h?.day ?? 1);
    this.nth.set(h?.nth ?? 1);
    this.weekday.set(h?.weekday ?? 1);
    this.plus.set(h?.plusDays ?? 0);
    this.easter.set(h?.easterOffset ?? 0);
    this.once.set(h?.onceDate ?? null);
    this.onceEnd.set(h?.onceEnd ?? null);
    this.onceBad.set(false);
    this.onceEndBad.set(false);
    this.weekendRule.set(h?.weekendRule ?? 'NONE');
    this.note.set(h?.regionNote ?? '');
    this.error.set('');
    this.serverMessage.set('');
    this.tried.set(false);
    this.busy.set(false);
    this.baseline = this.sig();
  }

  private input(): HolidayInput {
    const yearly = this.yearly();
    const range = this.shape() === 'range';
    const kind: HolidayRuleKind = range ? 'RANGE' : !yearly ? 'ONCE' : this.pattern();
    const blank: HolidayInput = {
      name: this.name().trim(),
      ruleKind: kind,
      month: null,
      day: null,
      nth: null,
      weekday: null,
      easterOffset: null,
      onceDate: null,
      endMonth: null,
      endDay: null,
      onceEnd: null,
      yearly,
      weekendRule: 'NONE',
      regionNote: this.note().trim() || null,
      plusDays: null,
      rowVersion: this.holiday()?.rowVersion,
    };
    switch (kind) {
      case 'FIXED':
        return { ...blank, month: this.month(), day: this.day(), weekendRule: this.weekendRule() };
      case 'NTH_WEEKDAY':
        return {
          ...blank,
          month: this.month(),
          nth: this.nth(),
          weekday: this.weekday(),
          plusDays: this.plus() || null,
        };
      case 'EASTER_OFFSET':
        return { ...blank, easterOffset: this.easter() };
      case 'ONCE':
        return { ...blank, onceDate: this.once() };
      case 'RANGE':
        return yearly
          ? {
              ...blank,
              month: this.month(),
              day: this.day(),
              endMonth: this.endMonth(),
              endDay: this.endDay(),
            }
          : { ...blank, onceDate: this.once(), onceEnd: this.onceEnd() };
    }
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.tried.set(true);
    this.serverMessage.set('');
    const p = this.problem();
    if (p.name || p.date) return;
    this.busy.set(true);
    try {
      const h = this.holiday();
      const saved = await this.api.saveHoliday(
        this.calendarId(),
        h?.holidayId ?? null,
        this.input(),
      );
      this.notify.success(h ? 'Holiday saved' : 'Holiday added', saved.name, { key: 'holiday' });
      this.saved.emit(saved);
      this.visible.set(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409)
        this.error.set(
          'This holiday was changed by someone else. Close this window and open it again.',
        );
      else
        this.error.set(
          err instanceof ApiError ? err.message : "Couldn't save the holiday. Try again.",
        );
    } finally {
      this.busy.set(false);
    }
  }
}
