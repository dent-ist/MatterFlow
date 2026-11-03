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
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { HOLIDAY_API } from './holiday-api';
import { CATEGORY_COLOURS, HolidayCalendar } from './holiday-contract';

const label = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

/**
 * New or edit holiday calendar (epic #1074, CAL-06) in the app's pop-up dialog standard: the category name people see on the Calendar, an optional region note, the colour (always
 * shown with the flag icon and the name) and "applies to everyone, on top of their own calendar" for firm closures.
 */
@Component({
  selector: 'mf-calendar-dialog',
  imports: [FormDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../dashboard/calendar/calendar-coverage.scss',
  template: `
    <mf-form-dialog
      [title]="calendar() ? 'Edit holiday calendar' : 'New holiday calendar'"
      subtitle="The category name people see on the calendar"
      [primaryLabel]="calendar() ? 'Save' : 'Create'"
      size="small"
      [dirty]="dirty()"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="visible"
      (submitted)="save()"
      data-calendar-dialog
    >
      <form class="cd" novalidate (submit)="$event.preventDefault(); save()">
        <div class="cd__f">
          <label class="cd__l" for="cd-name">Category name</label>
          <input
            id="cd-name"
            class="mf-control mf-control--fill"
            placeholder="For example Canada Holiday"
            maxlength="60"
            autocomplete="off"
            [attr.aria-invalid]="nameProblem() ? 'true' : null"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
          />
          @if (nameProblem(); as e) {
            <p class="cd__e" role="alert">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
            </p>
          }
        </div>
        <div class="cd__f">
          <label class="cd__l" for="cd-note">Region or country note (optional)</label>
          <input
            id="cd-note"
            class="mf-control mf-control--fill"
            maxlength="120"
            autocomplete="off"
            [value]="note()"
            (input)="note.set($any($event.target).value)"
          />
        </div>
        <fieldset class="cd__f cd__set">
          <legend class="cd__l">Colour (shown with the name and a flag icon, never alone)</legend>
          <div class="cd__colours" role="radiogroup" aria-label="Colour">
            @for (c of colours; track c) {
              <label class="cd__c" [class]="'cd__c hc-' + c" [class.cd__c--on]="colour() === c">
                <input
                  type="radio"
                  name="cd-colour"
                  class="sr-only"
                  [value]="c"
                  [checked]="colour() === c"
                  (change)="colour.set(c)"
                />
                <span class="hchip" [class]="'hchip hc-' + c"
                  ><i class="pi pi-flag" aria-hidden="true"></i><span>{{ labelOf(c) }}</span></span
                >
              </label>
            }
          </div>
        </fieldset>
        <label class="cd__chk">
          <input
            type="checkbox"
            [checked]="everyone()"
            (change)="everyone.set($any($event.target).checked)"
          />
          <span
            >Applies to everyone, on top of their own calendar
            <span class="cd__h">Use for firm closures.</span></span
          >
        </label>
      </form>
    </mf-form-dialog>
  `,
  styles: `
    .cd {
      display: grid;
      gap: var(--mf-s3);
      padding: var(--mf-s1);
    }
    .cd__f {
      display: grid;
      gap: var(--mf-s1);
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .cd__l {
      padding: 0;
      font-weight: 600;
    }
    .cd__e {
      display: flex;
      gap: var(--mf-s1);
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
    .cd__colours {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
    .cd__c {
      display: inline-flex;
      padding: 2px;
      border: 2px solid transparent;
      border-radius: var(--mf-radius-pill);
      cursor: pointer;
    }
    .cd__c--on {
      border-color: var(--mf-text);
    }
    .cd__c:focus-within {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .cd__c .hchip {
      height: 24px;
      font-size: var(--mf-fs-sm);
    }
    .cd__chk {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
    }
    .cd__h {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
})
export class CalendarDialog {
  readonly visible = model(false);
  readonly calendar = input<HolidayCalendar | null>(null);
  readonly saved = output<HolidayCalendar>();

  private readonly api = inject(HOLIDAY_API);
  private readonly notify = inject(NotificationService);
  protected readonly colours = CATEGORY_COLOURS;
  protected readonly labelOf = label;
  protected readonly name = signal('');
  protected readonly note = signal('');
  protected readonly colour = signal<string>('indigo');
  protected readonly everyone = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly serverName = signal('');
  private readonly touched = signal(false);
  private baseline = '';

  protected readonly nameProblem = computed(() => {
    if (this.serverName()) return this.serverName();
    return this.touched() && !this.name().trim() ? 'Enter a category name.' : null;
  });
  protected readonly dirty = computed(() => this.sig() !== this.baseline);

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        const c = this.calendar();
        this.name.set(c?.name ?? '');
        this.note.set(c?.regionNote ?? '');
        this.colour.set(c?.colourKey ?? 'indigo');
        this.everyone.set(c?.appliesToEveryone ?? false);
        this.touched.set(false);
        this.error.set('');
        this.serverName.set('');
        this.busy.set(false);
        this.baseline = this.sig();
      });
    });
  }

  private sig(): string {
    return JSON.stringify([this.name().trim(), this.note().trim(), this.colour(), this.everyone()]);
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.touched.set(true);
    this.serverName.set('');
    if (!this.name().trim()) return;
    this.busy.set(true);
    try {
      const c = this.calendar();
      const saved = await this.api.saveCalendar(c?.calendarId ?? null, {
        name: this.name().trim(),
        colourKey: this.colour(),
        regionNote: this.note().trim() || null,
        appliesToEveryone: this.everyone(),
        rowVersion: c?.rowVersion,
      });
      this.notify.success(c ? 'Calendar saved' : 'Calendar created', saved.name, {
        key: 'holiday-calendar',
      });
      this.saved.emit(saved);
      this.visible.set(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CALENDAR_NAME_TAKEN')
        this.serverName.set(err.message);
      else if (err instanceof ApiError && err.status === 409)
        this.error.set(
          'This calendar was changed by someone else. Close this window and open it again.',
        );
      else
        this.error.set(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
