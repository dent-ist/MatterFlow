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
  viewChild,
} from '@angular/core';
import { Button } from 'primeng/button';
import { DateInput } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import {
  MyAvailabilityClient,
  SaveAvailabilityRequest,
  UserAvailabilityClient,
  UserAvailabilityDto,
} from '../../api/generated/api-client';
import {
  AvailabilityDisplay,
  NOTE_MAX,
  availabilityDisplay,
} from '../../core/availability/availability';
import {
  DayHours,
  WEEK_DAYS,
  defaultWeek,
  outOfOfficeSummary,
  previewDisplay,
  timeZoneList,
  validateRange,
  validateWeek,
  weekFromServer,
  workHoursForSave,
} from '../../core/availability/availability-edit';
import { MyAvailability } from '../../core/availability/my-availability';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { Clock, USER_TIME_ZONE, browserTimeZoneOrNull } from '../../core/time/clock';
import { calendarDayInZone } from '../../core/time/time';
import { Badge } from '../ui/badge';

type LoadState = 'loading' | 'ready' | 'error';
type Status = 'AVAILABLE' | 'OUT_OF_OFFICE';

interface Problem {
  /** Id of the control to focus. */
  id: string;
  message: string;
}

/**
 * Availability and work hours of one person (epic #68): status (Available / Out of office) with optional dates and note, the weekly
 * work hours and the time zone. The same form is the "My profile" screen (own availability, `userId` unset) and the admin's "Edit
 * availability" dialog (`userId` set; needs User.Manage). Live validation, an error summary, a preview of the current status, rowVersion
 * conflict handling and a success toast; the host asks `dirty()` before leaving.
 */
@Component({
  selector: 'mf-availability-form',
  imports: [Button, DateInput, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './availability-form.scss',
  template: `
    @if (state() === 'loading') {
      <div class="av-state" role="status" aria-busy="true">Loading...</div>
    } @else if (state() === 'error') {
      <div class="av-alert" role="alert" data-load-error>
        We couldn't load the availability. Try again.
        <p-button label="Retry" severity="secondary" (onClick)="load()" />
      </div>
    } @else {
      <p class="mf-sr-only" role="status" aria-live="polite" data-updated-note>
        {{ announcement() }}
      </p>
      @if (stale()) {
        <div class="av-alert av-alert--row" role="alert" data-stale>
          <span
            >Your availability was changed somewhere else, for example from your name menu. Your
            edits are kept. Load latest replaces them with the new values.</span
          >
          <p-button
            label="Load latest"
            severity="secondary"
            size="small"
            data-load-latest
            (onClick)="loadLatest()"
          />
        </div>
      }
      @if (conflict()) {
        <div class="av-alert" role="alert" data-conflict>
          {{ self() ? 'Your' : name() + "'s" }} availability was changed somewhere else, so your
          edits were not saved. The latest values are shown now; make your changes again.
        </div>
      }
      @if (showSummary() && problems().length > 0) {
        <div #summary class="av-summary" role="alert" tabindex="-1" data-summary>
          Fix the following to save:
          <ul>
            @for (p of problems(); track p.id) {
              <li>
                <a [href]="'#' + p.id" (click)="focusField($event, p.id)">{{ p.message }}</a>
              </li>
            }
          </ul>
        </div>
      }

      <form class="av-form" novalidate (submit)="$event.preventDefault(); save()">
        <p class="av-preview" data-preview>
          <span class="av-preview__label"
            >{{ self() ? 'Your' : name() + "'s" }} current status:</span
          >
          @if (preview(); as p) {
            <mf-badge [tone]="p.tone" [icon]="p.icon" data-preview-chip>{{ p.label }}</mf-badge>
          }
          <span class="av-preview__hint">{{
            dirty()
              ? 'Preview of your changes.'
              : 'Colleagues see this on assignee lists and the dashboard.'
          }}</span>
        </p>

        <fieldset class="av-set" data-status-set>
          <legend>Status</legend>
          <label class="av-radio">
            <input
              type="radio"
              name="av-status"
              value="AVAILABLE"
              data-status-available
              [checked]="status() === 'AVAILABLE'"
              (change)="setStatus('AVAILABLE')"
            />
            <span>
              Available
              <span class="av-help"
                >Shown as available during work hours, and as off hours outside them.</span
              >
            </span>
          </label>
          <label class="av-radio">
            <input
              type="radio"
              name="av-status"
              value="OUT_OF_OFFICE"
              data-status-ooo
              [checked]="status() === 'OUT_OF_OFFICE'"
              (change)="setStatus('OUT_OF_OFFICE')"
            />
            <span>
              Out of office
              <span class="av-help">Shown as out of office. Work can still be assigned.</span>
            </span>
          </label>

          @if (status() === 'OUT_OF_OFFICE') {
            <div class="av-ooo" data-ooo-fields>
              <div class="av-dates">
                <div class="av-field">
                  <label class="av-label" for="av-from">From (optional)</label>
                  <mf-date-input
                    inputId="av-from"
                    [showHint]="false"
                    describedBy="av-dates-help"
                    label="From date"
                    [isoValue]="from()"
                    [invalid]="!!fromError()"
                    (isoChange)="from.set($event)"
                    (textInvalid)="fromBad.set($event)"
                  />
                </div>
                <div class="av-field">
                  <label class="av-label" for="av-until">Until (optional)</label>
                  <mf-date-input
                    inputId="av-until"
                    [showHint]="false"
                    describedBy="av-dates-help"
                    label="Until date"
                    [isoValue]="until()"
                    [invalid]="!!untilError()"
                    (isoChange)="until.set($event)"
                    (textInvalid)="untilBad.set($event)"
                  />
                  @if (untilProblem(); as e) {
                    <p class="av-error" role="alert" data-until-error>
                      <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
                    </p>
                  }
                </div>
              </div>
              <p class="av-help" id="av-dates-help" data-dates-help>
                Type a date such as Oct 12, 2026 or 10/12/2026, or use the calendar. Leave From
                empty to start now. Leave Until empty to stay out of office until
                {{ self() ? 'you set yourself' : 'they are set' }} available again.
              </p>

              <div class="av-field">
                <label class="av-label" for="av-note">Note (optional)</label>
                <textarea
                  id="av-note"
                  class="mf-control av-note"
                  rows="2"
                  autocomplete="off"
                  [attr.maxlength]="noteMax"
                  [attr.aria-describedby]="'av-note-count av-note-help'"
                  [attr.aria-invalid]="noteProblem() ? 'true' : null"
                  [value]="note()"
                  (input)="note.set($any($event.target).value)"
                ></textarea>
                <p class="av-help" id="av-note-help">
                  Shown to colleagues next to the status, for example who covers for you.
                </p>
                <p class="av-count" id="av-note-count" data-note-count>
                  <span [class.av-count--full]="note().length >= noteMax">{{ note().length }}</span>
                  /
                  {{ noteMax }}
                </p>
                @if (noteProblem(); as e) {
                  <p class="av-error" role="alert">{{ e }}</p>
                }
              </div>

              <p class="av-sentence" role="status" data-ooo-summary>{{ sentence() }}</p>
            </div>
          }
        </fieldset>

        <fieldset class="av-set" data-hours-set>
          <legend>Work hours</legend>
          <p class="av-help">
            Outside these hours {{ self() ? 'you show' : name() + ' shows' }} as off hours. That is
            informational only; work can still be assigned.
          </p>
          <div class="av-grid" role="group" aria-label="Weekly work hours">
            @for (d of week(); track d.day) {
              <div class="av-row" [attr.data-day]="d.day">
                <label class="av-day" [for]="'av-day-' + d.day">
                  <input
                    type="checkbox"
                    [id]="'av-day-' + d.day"
                    [checked]="d.working"
                    (change)="setDay(d.day, { working: $any($event.target).checked })"
                  />
                  {{ dayName(d.day) }}
                </label>
                @if (d.working) {
                  <input
                    type="time"
                    class="mf-control av-time"
                    [id]="'av-day-' + d.day + '-start'"
                    [attr.aria-label]="dayName(d.day) + ' start time'"
                    [attr.aria-invalid]="dayProblem(d.day) ? 'true' : null"
                    [value]="d.start"
                    (input)="setDay(d.day, { start: $any($event.target).value })"
                  />
                  <span class="av-to" aria-hidden="true">to</span>
                  <input
                    type="time"
                    class="mf-control av-time"
                    [id]="'av-day-' + d.day + '-end'"
                    [attr.aria-label]="dayName(d.day) + ' end time'"
                    [attr.aria-invalid]="dayProblem(d.day) ? 'true' : null"
                    [value]="d.end"
                    (input)="setDay(d.day, { end: $any($event.target).value })"
                  />
                } @else {
                  <span class="av-off">Not working</span>
                }
                @if (dayProblem(d.day); as e) {
                  <p class="av-error av-row__error" role="alert" data-day-error>
                    <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
                  </p>
                }
              </div>
            }
          </div>
          <div class="av-tools">
            <p-button
              label="Copy Monday to all weekdays"
              icon="pi pi-copy"
              severity="secondary"
              size="small"
              [text]="true"
              data-copy-weekdays
              (onClick)="copyToWeekdays()"
            />
            <p-button
              label="Reset to Mon-Fri 9:00 AM-5:00 PM"
              severity="secondary"
              size="small"
              [text]="true"
              data-reset-hours
              (onClick)="week.set(defaults())"
            />
          </div>

          <div class="av-field av-field--zone">
            <label class="av-label" for="av-tz">Time zone</label>
            <input
              id="av-tz"
              class="mf-control"
              type="text"
              list="av-tz-list"
              autocomplete="off"
              spellcheck="false"
              placeholder="Start typing, for example New_York"
              [attr.aria-describedby]="'av-tz-help'"
              [attr.aria-invalid]="tzProblem() ? 'true' : null"
              [value]="tz()"
              (input)="tz.set($any($event.target).value.trim())"
            />
            <datalist id="av-tz-list">
              @for (z of zones(); track z) {
                <option [value]="z"></option>
              }
            </datalist>
            <p class="av-help" id="av-tz-help">
              Work hours and out-of-office days follow this time zone.
              @if (tzIsBrowser()) {
                It is your browser's time zone.
              }
            </p>
            @if (tzProblem(); as e) {
              <p class="av-error" role="alert" data-tz-error>
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
              </p>
            }
          </div>
        </fieldset>

        <div
          class="av-actions mf-form-actions--sticky"
          [class.av-actions--dialog]="mode() === 'dialog'"
          data-actions
        >
          <p-button
            type="submit"
            [label]="busy() ? 'Saving...' : 'Save changes'"
            [disabled]="busy() || !dirty()"
            data-save
          />
          @if (mode() === 'dialog') {
            <p-button label="Cancel" severity="secondary" (onClick)="closed.emit()" />
          } @else {
            <p-button
              label="Discard changes"
              severity="secondary"
              [disabled]="busy() || !dirty()"
              (onClick)="discard()"
            />
          }
        </div>
      </form>
    }
  `,
})
export class AvailabilityForm {
  /** The person to edit (needs User.Manage); unset = the signed-in person's own availability. */
  readonly userId = input<number | null>(null);
  /** Display name of that person, for the copy of an admin edit. */
  readonly displayName = input('');
  /** `dialog`: Cancel closes the host instead of discarding the edits. */
  readonly mode = input<'page' | 'dialog'>('page');

  /** The profile as the server returned it after a save. */
  readonly saved = output<UserAvailabilityDto>();
  readonly closed = output<void>();

  private readonly mine = inject(MyAvailabilityClient);
  private readonly others = inject(UserAvailabilityClient);
  private readonly auth = inject(AuthStore);
  private readonly myStore = inject(MyAvailability);
  private readonly notify = inject(NotificationService);
  private readonly clock = inject(Clock);
  private readonly viewerZone = inject(USER_TIME_ZONE);
  private readonly summaryEl = viewChild<ElementRef<HTMLElement>>('summary');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly noteMax = NOTE_MAX;
  protected readonly state = signal<LoadState>('loading');
  protected readonly dto = signal<UserAvailabilityDto | null>(null);
  protected readonly status = signal<Status>('AVAILABLE');
  protected readonly from = signal<string | null>(null);
  protected readonly until = signal<string | null>(null);
  protected readonly fromBad = signal(false);
  protected readonly untilBad = signal(false);
  protected readonly note = signal('');
  protected readonly week = signal<DayHours[]>(defaultWeek());
  protected readonly tz = signal('');
  protected readonly busy = signal(false);
  protected readonly conflict = signal(false);
  /** The profile the header menu saved while this form had unsaved edits: kept aside until the person loads it (own availability only). */
  protected readonly stale = signal<UserAvailabilityDto | null>(null);
  /** Text for the polite live region ("Your availability was updated."). */
  protected readonly announcement = signal('');
  /** Show the error summary: after a failed save, and while the problems are being fixed. */
  protected readonly showSummary = signal(false);
  protected readonly server = signal<{
    until?: string;
    note?: string;
    tz?: string;
    general?: string;
  }>({});
  /** The values as loaded or saved, to tell whether anything changed. */
  private readonly baseline = signal('');

  protected readonly self = computed(() => {
    const id = this.userId();
    return id === null || id === this.auth.profile()?.userId;
  });
  protected readonly name = computed(() => this.displayName() || 'This person');

  protected readonly zones = computed(() => {
    const d = this.dto();
    return timeZoneList(browserTimeZoneOrNull(), d?.effectiveTimeZoneId, d?.timeZoneId);
  });
  protected readonly tzIsBrowser = computed(
    () => this.tz() !== '' && this.tz() === browserTimeZoneOrNull(),
  );
  protected readonly tzProblem = computed(() => {
    const t = this.tz();
    if (t === '') return 'Choose a time zone from the list, for example America/New_York.';
    if (!this.zones().includes(t)) {
      return `"${t}" is not a time zone we know. Choose one from the list, for example America/New_York.`;
    }
    return this.server().tz ?? null;
  });

  private readonly range = computed(() =>
    this.status() === 'OUT_OF_OFFICE' ? validateRange(this.from(), this.until(), this.note()) : {},
  );
  protected readonly fromError = computed(
    () => this.range().from ?? (this.fromBad() ? 'bad' : null),
  );
  protected readonly untilProblem = computed(
    () => this.range().until ?? this.server().until ?? null,
  );
  protected readonly untilError = computed(
    () => this.untilProblem() ?? (this.untilBad() ? 'bad' : null),
  );
  protected readonly noteProblem = computed(() => this.range().note ?? this.server().note ?? null);
  private readonly weekProblems = computed(() => validateWeek(this.week()));

  protected readonly problems = computed<Problem[]>(() => {
    const list: Problem[] = [];
    if (this.status() === 'OUT_OF_OFFICE') {
      if (this.fromBad()) list.push({ id: 'av-from', message: 'Enter a valid From date.' });
      else if (this.range().from) list.push({ id: 'av-from', message: this.range().from! });
      if (this.untilBad()) list.push({ id: 'av-until', message: 'Enter a valid Until date.' });
      else if (this.untilProblem()) list.push({ id: 'av-until', message: this.untilProblem()! });
      if (this.noteProblem()) list.push({ id: 'av-note', message: this.noteProblem()! });
    }
    for (const [day, message] of Object.entries(this.weekProblems())) {
      list.push({ id: `av-day-${day}-start`, message });
    }
    if (this.tzProblem()) list.push({ id: 'av-tz', message: this.tzProblem()! });
    const general = this.server().general;
    if (general) list.push({ id: 'av-day-1', message: general });
    return list;
  });

  protected readonly sentence = computed(() => {
    const today = calendarDayInZone(this.clock.now(), this.zoneForDates());
    return outOfOfficeSummary(this.from(), this.until(), {
      self: this.self(),
      name: this.name(),
      today,
    });
  });

  protected readonly dirty = computed(
    () => this.state() === 'ready' && this.signature() !== this.baseline(),
  );

  protected readonly preview = computed<AvailabilityDisplay | null>(() => {
    const d = this.dto();
    if (!d) return null;
    const now = this.clock.now();
    if (!this.dirty()) {
      return availabilityDisplay(
        { state: d.current.state, outUntil: d.current.outUntilUtc, note: d.current.note },
        this.viewerZone,
        now,
      );
    }
    return previewDisplay(
      {
        status: this.status(),
        from: this.from(),
        until: this.until(),
        timeZone: this.zones().includes(this.tz()) ? this.tz() : d.effectiveTimeZoneId,
        week: this.week(),
      },
      now,
    );
  });

  constructor() {
    effect(() => {
      this.userId();
      untracked(() => void this.load());
    });
    // BUG-1: the page follows the header menu. Set out of office and I'm back write the shared store; a clean form takes the new
    // values, a form with edits keeps them and offers "Load latest".
    effect(() => {
      const latest = this.myStore.profile();
      this.dirty();
      untracked(() => this.follow(latest));
    });
  }

  private follow(latest: UserAvailabilityDto | null): void {
    const d = this.dto();
    if (this.userId() !== null || this.state() !== 'ready' || !latest || !d) return;
    if (latest.rowVersion === d.rowVersion) {
      this.stale.set(null);
      return;
    }
    if (this.dirty()) {
      this.stale.set(latest);
      return;
    }
    this.apply(latest);
    this.announcement.set('Your availability was updated.');
  }

  /** Drops the edits and shows what the menu saved. */
  protected loadLatest(): void {
    const latest = this.stale();
    if (!latest) return;
    this.apply(latest);
    this.announcement.set('Showing your latest availability.');
    // After the new values are drawn, so the radio that is checked by then is the one that gets focus.
    setTimeout(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>('input[name="av-status"]:checked')
        ?.focus(),
    );
  }

  /** True while there are edits that are not saved. */
  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  protected defaults = defaultWeek;

  protected dayName(day: number): string {
    return WEEK_DAYS[day - 1].name;
  }

  protected dayProblem(day: number): string | null {
    return this.weekProblems()[day] ?? null;
  }

  private zoneForDates(): string {
    return this.zones().includes(this.tz()) ? this.tz() : this.viewerZone;
  }

  /** What identifies the edits: the dates and the note only count while out of office (Available clears them). */
  private signature(): string {
    const ooo = this.status() === 'OUT_OF_OFFICE';
    return JSON.stringify([
      this.status(),
      ooo ? this.from() : null,
      ooo ? this.until() : null,
      ooo ? this.note().trim() : '',
      this.tz(),
      workHoursForSave(this.week()),
    ]);
  }

  async load(): Promise<void> {
    this.state.set('loading');
    this.conflict.set(false);
    this.stale.set(null);
    try {
      const id = this.userId();
      this.apply(
        await firstValueFrom(
          id === null ? this.mine.getMyAvailability() : this.others.getUserAvailability(id),
        ),
      );
      // The store always holds the newest copy the page has seen, so a stale header copy is never mistaken for a change.
      if (id === null && this.dto()) this.myStore.set(this.dto()!);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  /** Puts a profile from the server into the form. */
  private apply(d: UserAvailabilityDto): void {
    this.dto.set(d);
    this.status.set(d.status === 'OUT_OF_OFFICE' ? 'OUT_OF_OFFICE' : 'AVAILABLE');
    this.from.set(d.from ?? null);
    this.until.set(d.until ?? null);
    this.fromBad.set(false);
    this.untilBad.set(false);
    this.note.set(d.note ?? '');
    this.week.set(d.usesDefaultWorkHours ? defaultWeek() : weekFromServer(d.workHours));
    // A person who never chose a zone sees their browser's zone; an admin editing someone else keeps the firm zone shown.
    this.tz.set(
      d.timeZoneId ??
        (this.self() ? (browserTimeZoneOrNull() ?? d.effectiveTimeZoneId) : d.effectiveTimeZoneId),
    );
    this.server.set({});
    this.showSummary.set(false);
    this.baseline.set(this.signature());
    this.stale.set(null);
  }

  protected setStatus(value: Status): void {
    this.status.set(value);
    this.server.set({});
  }

  protected setDay(day: number, patch: Partial<DayHours>): void {
    this.week.update((w) => w.map((d) => (d.day === day ? { ...d, ...patch } : d)));
    this.server.update((s) => ({ ...s, general: undefined }));
  }

  /** Monday's hours (or day off) on Tuesday to Friday. */
  protected copyToWeekdays(): void {
    const monday = this.week()[0];
    this.week.update((w) =>
      w.map((d) =>
        d.day >= 2 && d.day <= 5
          ? { ...d, working: monday.working, start: monday.start, end: monday.end }
          : d,
      ),
    );
  }

  protected discard(): void {
    const d = this.dto();
    if (d) this.apply(d);
  }

  protected focusField(event: Event, id: string): void {
    event.preventDefault();
    this.host.nativeElement.querySelector<HTMLElement>(`#${id}`)?.focus();
  }

  protected async save(): Promise<void> {
    const d = this.dto();
    if (!d || this.busy() || !this.dirty()) return;
    this.showSummary.set(true);
    this.server.set({});
    this.conflict.set(false);
    if (this.problems().length > 0) {
      setTimeout(() => this.summaryEl()?.nativeElement.focus());
      return;
    }

    const ooo = this.status() === 'OUT_OF_OFFICE';
    const onBehalfDefaultZone =
      !this.self() && d.timeZoneId == null && this.tz() === d.effectiveTimeZoneId;
    const request: SaveAvailabilityRequest = {
      status: this.status(),
      from: ooo ? (this.from() ?? undefined) : undefined,
      until: ooo ? (this.until() ?? undefined) : undefined,
      note: ooo ? this.note().trim() || undefined : undefined,
      timeZoneId: onBehalfDefaultZone ? undefined : this.tz(),
      workHours: workHoursForSave(this.week()) ?? undefined,
      rowVersion: d.rowVersion,
    };

    this.busy.set(true);
    try {
      const id = this.userId();
      const saved = await firstValueFrom(
        id === null
          ? this.mine.saveMyAvailability(request)
          : this.others.saveUserAvailability(id, request),
      );
      this.apply(saved);
      if (this.self()) this.myStore.set(saved);
      this.notify.success(
        this.self() ? 'Availability saved' : `Availability saved for ${this.name()}`,
        saved.current.state === 'OUT_OF_OFFICE' ? 'Shown as out of office.' : undefined,
        { key: 'availability' },
      );
      this.saved.emit(saved);
    } catch (err) {
      await this.onSaveError(err);
    } finally {
      this.busy.set(false);
    }
  }

  private async onSaveError(err: unknown): Promise<void> {
    const code = err instanceof ApiError ? err.code : undefined;
    const message = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
    switch (code) {
      case 'CONCURRENCY_CONFLICT':
        await this.load();
        this.conflict.set(true);
        return;
      case 'OOO_RANGE_INVALID':
        this.server.set({ until: message });
        break;
      case 'NOTE_TOO_LONG':
        this.server.set({ note: message });
        break;
      case 'TIMEZONE_UNKNOWN':
        this.server.set({ tz: message });
        break;
      default:
        this.server.set({ general: message });
    }
    this.showSummary.set(true);
    setTimeout(() => this.summaryEl()?.nativeElement.focus());
  }
}
