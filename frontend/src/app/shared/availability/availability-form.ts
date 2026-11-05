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
import { firstValueFrom } from 'rxjs';
import {
  MyAvailabilityClient,
  SaveAvailabilityRequest,
  UserAvailabilityClient,
  UserAvailabilityDto,
} from '../../api/generated/api-client';
import { AvailabilityDisplay, availabilityDisplay } from '../../core/availability/availability';
import {
  DayHours,
  WEEK_DAYS,
  defaultWeek,
  hasUniformHours,
  isTime,
  timeZoneList,
  validateWeek,
  weekFromServer,
  workHoursForSave,
} from '../../core/availability/availability-edit';
import { MyAvailability, requestFrom } from '../../core/availability/my-availability';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { QuietRequests } from '../../core/http/interceptors';
import { NotificationService } from '../../core/notify/notification.service';
import { Clock, USER_TIME_ZONE, browserTimeZoneOrNull } from '../../core/time/clock';
import { Badge } from '../ui/badge';
import { TimeZoneSelect } from './time-zone-select';
import { WorkHoursCompact } from './work-hours-compact';

export type LoadState = 'loading' | 'ready' | 'error';
interface Problem {
  /** Id of the control to focus. */
  id: string;
  message: string;
}

/**
 * Work hours and time zone of one person (epic #68; the Out of office list moved to `absences/`, epic #1074 CAL-05): the weekly
 * work hours and the time zone. The same form is the "My profile" screen (own availability, `userId` unset) and the admin's "Edit
 * availability" dialog (`userId` set; needs User.Manage). Live validation, an error summary, a preview of the current status, rowVersion
 * conflict handling and a success toast; the host asks `dirty()` before leaving.
 */
@Component({
  selector: 'mf-availability-form',
  imports: [Button, Badge, WorkHoursCompact, TimeZoneSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './availability-form.scss',
  template: `
    @if (state() === 'loading') {
      @if (mode() === 'dialog') {
        <div class="av-state" role="status" aria-busy="true">Loading availability</div>
      }
    } @else if (state() === 'error') {
      @if (mode() === 'dialog') {
        <div class="av-alert" role="alert" data-load-error>
          Couldn't load the availability. Try again.
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
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
            label="Load Latest"
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

      <form
        class="av-form"
        [class.av-form--page]="mode() === 'page'"
        (focusin)="keepClearOfBar($event)"
        novalidate
        (submit)="$event.preventDefault(); save()"
      >
        @if (mode() === 'dialog') {
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
        }

        <section class="av-card" [class.mf-card]="mode() === 'page'" data-card="work-hours">
          <fieldset class="av-set" data-hours-set>
            <legend>
              @if (mode() === 'page') {
                <h2 class="av-card__title mf-card__title">Work Hours</h2>
              } @else {
                Work hours
              }
            </legend>
            <p class="av-help">
              Outside these hours {{ self() ? 'you show' : name() + ' shows' }} as off hours. That
              is informational only; work can still be assigned.
            </p>
            @if (!showGrid()) {
              <mf-work-hours-compact [(week)]="week" [problem]="hoursProblem()" />
            }
            @if (showGrid()) {
              <div
                class="av-grid"
                id="av-hours-grid"
                role="group"
                aria-label="Weekly work hours"
                data-hours-grid
              >
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
            }
            <div class="av-tools">
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-hours-disclosure
                [attr.aria-expanded]="showGrid()"
                [attr.aria-controls]="showGrid() ? 'av-hours-grid' : null"
                [attr.aria-disabled]="showGrid() && !uniform() ? 'true' : null"
                [attr.aria-describedby]="showGrid() && !uniform() ? 'av-hours-differ' : null"
                (click)="toggleGrid()"
              >
                {{ showGrid() ? 'Use the Same Hours on All Days' : 'Different Hours on Some Days' }}
              </button>
              @if (showGrid()) {
                <button
                  type="button"
                  class="mf-btn mf-btn--text"
                  data-copy-weekdays
                  (click)="copyToWeekdays()"
                >
                  Copy Monday to All Weekdays
                </button>
              }
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-reset-hours
                (click)="week.set(defaults())"
              >
                Reset to Mon-Fri 9:00 AM-5:00 PM
              </button>
            </div>
            @if (showGrid() && !uniform()) {
              <p class="av-help" id="av-hours-differ" data-hours-differ>
                Hours differ between days, so each day stays visible.
              </p>
            }

            <div class="av-field av-field--zone">
              <mf-time-zone-select
                [(value)]="tz"
                [zones]="zones()"
                [saved]="dto()?.timeZoneId ?? null"
                [invalid]="!!tzProblem()"
              />
              @if (tzProblem(); as e) {
                <p class="av-error" role="alert" data-tz-error>
                  <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
                </p>
              }
            </div>
          </fieldset>
        </section>

        <!-- In a dialog the dialog's own footer saves and cancels (mf-form-dialog); the page keeps this bar. -->
        @if (mode() === 'page') {
          <div class="av-actions mf-form-actions--sticky av-actions--page" data-actions>
            <span
              class="av-actions__state mf-form-actions__note"
              role="status"
              data-actions-state
              >{{ dirty() ? 'Unsaved changes' : 'No unsaved changes' }}</span
            >
            <p-button
              label="Cancel"
              severity="secondary"
              [disabled]="busy() || !dirty()"
              (onClick)="discard()"
            />
            <p-button
              type="submit"
              [label]="busy() ? 'Saving...' : 'Save Changes'"
              [disabled]="busy() || !dirty()"
              data-save
            />
          </div>
        }
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
  /**
   * The load state, for a host that draws it (My profile shows the skeleton and the shared record state, #532: in `page` mode the form
   * itself shows nothing until it is ready).
   */
  readonly loadState = output<LoadState>();

  private readonly quiet = inject(QuietRequests);
  private readonly mine = inject(MyAvailabilityClient);
  private readonly others = inject(UserAvailabilityClient);
  private readonly auth = inject(AuthStore);
  private readonly myStore = inject(MyAvailability);
  private readonly notify = inject(NotificationService);
  private readonly clock = inject(Clock);
  private readonly viewerZone = inject(USER_TIME_ZONE);
  private readonly summaryEl = viewChild<ElementRef<HTMLElement>>('summary');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly state = signal<LoadState>('loading');
  protected readonly dto = signal<UserAvailabilityDto | null>(null);
  protected readonly week = signal<DayHours[]>(defaultWeek());
  /** The per-day grid is open (#535): on request, and by itself for a week whose working days differ. */
  protected readonly showGrid = signal(false);
  /** The working days all share one pair of times (the compact control can show the week). */
  protected readonly uniform = computed(() => hasUniformHours(this.week()));
  protected readonly tz = signal('');
  /** A save is running (the dialog's footer reads it). */
  readonly busy = signal(false);
  protected readonly conflict = signal(false);
  /** The profile the header menu saved while this form had unsaved edits: kept aside until the person loads it (own availability only). */
  protected readonly stale = signal<UserAvailabilityDto | null>(null);
  /** Text for the polite live region ("Your availability was updated."). */
  protected readonly announcement = signal('');
  /** Show the error summary: after a failed save, and while the problems are being fixed. */
  protected readonly showSummary = signal(false);
  protected readonly server = signal<{
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

  private readonly weekProblems = computed(() => validateWeek(this.week()));
  /** The compact control has one pair of times, so it has one problem (the grid names the day). */
  protected readonly hoursProblem = computed<string | null>(() => {
    if (this.showGrid() || Object.keys(this.weekProblems()).length === 0) return null;
    const day = this.week().find((d) => d.working);
    return !day || !isTime(day.start) || !isTime(day.end)
      ? 'Work hours: enter a start and an end time.'
      : 'Work hours: the end time must be after the start time.';
  });

  protected readonly problems = computed<Problem[]>(() => {
    const list: Problem[] = [];
    if (this.showGrid()) {
      for (const [day, message] of Object.entries(this.weekProblems())) {
        list.push({ id: `av-day-${day}-start`, message });
      }
    } else if (this.hoursProblem()) {
      list.push({ id: 'av-hours-start', message: this.hoursProblem()! });
    }
    if (this.tzProblem()) list.push({ id: 'av-tz', message: this.tzProblem()! });
    const general = this.server().general;
    if (general)
      list.push({ id: this.showGrid() ? 'av-day-1' : 'av-hours-start', message: general });
    return list;
  });

  /** Unsaved edits (the dialog's footer reads it). */
  readonly dirty = computed(() => this.state() === 'ready' && this.signature() !== this.baseline());

  protected readonly preview = computed<AvailabilityDisplay | null>(() => {
    const d = this.dto();
    if (!d) return null;
    return availabilityDisplay(
      { state: d.current.state, outUntil: d.current.outUntilUtc, note: d.current.note },
      this.viewerZone,
      this.clock.now(),
    );
  });

  constructor() {
    effect(() => {
      const state = this.state();
      untracked(() => this.loadState.emit(state));
    });
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

  /** What identifies the edits: the time zone and the work hours. */
  private signature(): string {
    return JSON.stringify([this.tz(), workHoursForSave(this.week())]);
  }

  async load(): Promise<void> {
    this.state.set('loading');
    this.conflict.set(false);
    this.stale.set(null);
    try {
      const id = this.userId();
      // The failure is shown inline (the dialog's alert, or the page's record state), so the request is quiet: no toast as well.
      this.apply(
        await this.quiet.runInline(() =>
          firstValueFrom(
            id === null ? this.mine.getMyAvailability() : this.others.getUserAvailability(id),
          ),
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
    const week = d.usesDefaultWorkHours ? defaultWeek() : weekFromServer(d.workHours);
    this.week.set(week);
    // A week whose days differ is never collapsed: the grid opens by itself (#535).
    this.showGrid.set(!hasUniformHours(week));
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

  protected setDay(day: number, patch: Partial<DayHours>): void {
    this.week.update((w) => w.map((d) => (d.day === day ? { ...d, ...patch } : d)));
    this.server.update((s) => ({ ...s, general: undefined }));
  }

  /**
   * A field that takes focus is never left behind the sticky action bar (#531, BUG-5; WCAG 2.4.11): the browser does not scroll an element
   * that is "visible" under the bar, so the page scrolls it clear. Only the page's own bar does this (the dialog scrolls inside itself).
   */
  protected keepClearOfBar(event: FocusEvent): void {
    if (this.mode() !== 'page') return;
    const el = event.target as HTMLElement;
    const bar = this.host.nativeElement.querySelector<HTMLElement>('[data-actions]');
    if (!bar || bar.contains(el)) return;
    requestAnimationFrame(() => {
      const a = el.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      if (!(a.bottom > b.top && a.top < b.bottom)) return;
      const by = a.bottom - b.top + 16;
      // The page scrolls in the window or in an element (the shell's main area on small screens): move the nearest one that scrolls.
      let node: HTMLElement | null = el.parentElement;
      while (node) {
        const overflowY = getComputedStyle(node).overflowY;
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight
        ) {
          node.scrollBy({ top: by });
          return;
        }
        node = node.parentElement;
      }
      window.scrollBy({ top: by });
    });
  }

  /** "Different Hours on Some Days" / "Use the Same Hours on All Days". The second one waits while the days differ. */
  protected toggleGrid(): void {
    if (!this.showGrid()) this.showGrid.set(true);
    else if (this.uniform()) this.showGrid.set(false);
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
    const root = this.host.nativeElement;
    // The Time zone field is a select, or the search input behind "Other zones...".
    const target =
      (id === 'av-tz' ? root.querySelector<HTMLElement>('#av-tz-other') : null) ??
      root.querySelector<HTMLElement>(`#${id}`);
    target?.focus();
  }

  /** Saves the edits: the form's own button on a page, the dialog's footer button in a dialog. */
  async save(): Promise<void> {
    const d = this.dto();
    if (!d || this.busy() || !this.dirty()) return;
    this.showSummary.set(true);
    this.server.set({});
    this.conflict.set(false);
    if (this.problems().length > 0) {
      setTimeout(() => this.summaryEl()?.nativeElement.focus());
      return;
    }

    const onBehalfDefaultZone =
      !this.self() && d.timeZoneId == null && this.tz() === d.effectiveTimeZoneId;
    // The Out of office entries are saved from their own list (CAL-05); this PUT saves the time zone and the work hours only.
    const request: SaveAvailabilityRequest = requestFrom(d, {
      timeZoneId: onBehalfDefaultZone ? undefined : this.tz(),
      workHours: workHoursForSave(this.week()) ?? undefined,
    });

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
    const message =
      err instanceof ApiError ? err.message : "Couldn't save your availability. Try again.";
    switch (code) {
      case 'CONCURRENCY_CONFLICT':
        await this.load();
        this.conflict.set(true);
        return;
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
