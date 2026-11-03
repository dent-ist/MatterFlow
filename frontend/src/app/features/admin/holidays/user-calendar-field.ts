import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';
import { HOLIDAY_API, UserCalendar } from './holiday-api';
import { HolidayCalendar, PreviewRow } from './holiday-contract';

/**
 * The "Holiday calendar" field of a person (epic #1074, CAL-06; User.Manage), in the Availability section of the user drawer. A person has ONE calendar: their own choice, else their
 * pod's default, else the firm default; the first option says which one applies now. A choice is saved at once. Under it the next holidays of the calendar in force, so the effect is
 * visible. Without User.Manage the field is read-only text.
 */
@Component({
  selector: 'mf-user-calendar-field',
  imports: [NumericDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="uc" data-user-calendar>
      <label class="uc__l" for="uc-select">Holiday calendar</label>
      @if (state(); as s) {
        @if (canManage()) {
          <select
            id="uc-select"
            class="mf-control"
            data-user-calendar-select
            [disabled]="busy()"
            aria-describedby="uc-help"
            [value]="s.explicitCalendarId ?? ''"
            (change)="choose($any($event.target).value)"
          >
            <option value="" [selected]="s.explicitCalendarId === null">
              {{ defaultLabel() }}
            </option>
            @for (c of own(); track c.calendarId) {
              <option [value]="c.calendarId" [selected]="s.explicitCalendarId === c.calendarId">
                {{ c.name }}
              </option>
            }
          </select>
        } @else {
          <p class="uc__t" data-user-calendar-text>{{ current()?.name ?? 'None' }}</p>
        }
        <p class="uc__h" id="uc-help">
          One calendar per person: their own choice, else the pod's default, else the firm default.
          A calendar that applies to everyone (a firm closure) is added on top.
        </p>
        @if (error()) {
          <p class="uc__e" role="alert">{{ error() }}</p>
        }
        @if (next().length > 0) {
          <p class="uc__n">Next holidays</p>
          <ul class="uc__list" data-next-holidays>
            @for (h of next(); track h.date + h.name) {
              <li>
                <span class="uc__d">{{ h.date | mfNum }}</span> {{ h.name }}
              </li>
            }
          </ul>
        }
      }
    </div>
  `,
  styles: `
    .uc {
      display: grid;
      gap: var(--mf-s1);
      margin-top: var(--mf-s3);
    }
    .uc__l {
      font-weight: 600;
    }
    .uc__t,
    .uc__n {
      margin: 0;
      font-weight: 600;
    }
    .uc__h {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .uc__e {
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
    .uc__list {
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--mf-fs-sm);
    }
    .uc__d {
      display: inline-block;
      min-width: 3.5rem;
      font-weight: 600;
    }
  `,
})
export class UserCalendarField {
  readonly userId = input.required<number>();
  readonly canManage = input(false);

  private readonly api = inject(HOLIDAY_API);
  private readonly notify = inject(NotificationService);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  protected readonly state = signal<UserCalendar | null>(null);
  private readonly calendars = signal<HolidayCalendar[]>([]);
  protected readonly next = signal<PreviewRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly own = computed(() => this.calendars().filter((c) => !c.appliesToEveryone));
  protected readonly current = computed(
    () => this.calendars().find((c) => c.calendarId === this.state()?.effectiveCalendarId) ?? null,
  );
  protected readonly defaultLabel = computed(() => {
    const s = this.state();
    const name = this.own().find((c) => c.calendarId === s?.effectiveCalendarId)?.name;
    if (s?.explicitCalendarId != null) return 'Use the default';
    if (s?.effectiveSource === 'POD') {
      return s.podName
        ? `Pod default (${s.podName}: ${name ?? 'none'})`
        : `Pod default (${name ?? 'none'})`;
    }
    if (s?.effectiveSource === 'FIRM') return `Firm default (${name ?? 'none'})`;
    return 'No calendar';
  });

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: number): Promise<void> {
    try {
      const [s, calendars] = await Promise.all([this.api.userCalendar(id), this.api.calendars()]);
      this.calendars.set(calendars);
      this.state.set(s);
      await this.loadNext(s);
    } catch {
      this.state.set(null);
    }
  }

  private async loadNext(s: UserCalendar): Promise<void> {
    if (s.effectiveCalendarId === null) {
      this.next.set([]);
      return;
    }
    const d = calendarDayInZone(this.clock.now(), this.zone);
    const today = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    const rows = [
      ...(await this.api.preview(s.effectiveCalendarId, d.year)),
      ...(await this.api.preview(s.effectiveCalendarId, d.year + 1)),
    ];
    this.next.set(rows.filter((r) => r.date >= today).slice(0, 3));
  }

  protected async choose(value: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const s = await this.api.setUserCalendar(this.userId(), value === '' ? null : Number(value));
      this.state.set(s);
      await this.loadNext(s);
      this.notify.success('Holiday calendar saved', undefined, { key: 'user-calendar' });
    } catch (err) {
      this.error.set(
        err instanceof ApiError ? err.message : 'The calendar could not be saved. Try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
