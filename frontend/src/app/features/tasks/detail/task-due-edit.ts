import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DateInput } from 'form-engine';
import { TasksClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import {
  calendarDayInZone,
  dayIndex,
  describeDueCell,
  dueCellText,
  formatDateOnly,
  parseDateOnly,
  zoneAbbreviation,
  zonedLocalToUtc,
} from '../../../core/time/time';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { Dismissable } from '../../../shared/ui/dismissable';
import { DueCell } from '../../../shared/work-queue/due-cell';
import { isBlankHtml } from '../panels/rich-text';
import { clockText } from '../panels/when-summary';
import { TaskDetailStore } from './task-detail.store';

let nextId = 0;

const BAD_DATE = 'Enter a valid date, for example Oct 12, 2026 or 10/12/2026.';

/**
 * The Due tile of the Task page when the person may edit the task (#664): a button like the Status, Priority and Assignee chips that
 * opens a small popover with the shared Due date and Time inputs, Save, Cancel and "Clear due date (ASAP)". The rules are the Edit
 * dialog's: the same update call (`updateTask`, which replaces the details as sent, so the task's current details are sent back
 * unchanged next to the new due fields), the same validation messages, the same rowVersion conflict handling. Dismissal is the shared
 * popover rule (Esc returns focus to the tile, a press or focus outside closes). The popover is fixed-positioned from the tile, so the
 * strip's rounded overflow does not clip it; it follows the tile on scroll and resize (a phone keyboard resizes the window, so it
 * must not close then).
 */
@Component({
  selector: 'mf-due-edit',
  imports: [DueCell, DateInput, Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/form-field.scss',
  styles: `
    :host {
      display: inline-block;
      max-width: 100%;
    }
    .de-trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      max-width: 100%;
      min-height: 1.75rem;
      padding: 0 var(--mf-s1);
      border: 1px solid transparent;
      border-radius: var(--mf-radius);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .de-trigger:focus-visible,
    .de-trigger[aria-expanded='true'] {
      border-color: var(--mf-border-strong);
      background: var(--mf-surface-alt);
    }
    .de-trigger[aria-disabled='true'] {
      cursor: progress;
      opacity: 0.7;
    }
    .de-trigger .pi {
      flex: none;
      color: var(--mf-text-muted);
      font-size: 0.875rem;
    }
    mf-due-cell {
      min-width: 0;
      font-size: var(--mf-fs-md);
    }
    .de-pop {
      position: fixed;
      z-index: 1100;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s3);
      width: min(20rem, calc(100vw - 16px));
      max-height: calc(100dvh - 16px);
      overflow-y: auto;
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-1);
      font-weight: 400;
      white-space: normal;
    }
    .de-title {
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: 600;
    }
    .de-form {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s3);
      margin: 0;
    }
    .de-fields {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s3);
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .de-fields .mf-field {
      grid-template-columns: minmax(0, 1fr);
      min-width: 0;
    }
    .de-fields .mf-field__input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
    }
    .de-sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .de-warn {
      margin: 0;
      color: var(--mf-warning);
      font-size: var(--mf-fs-sm);
    }
    .de-alert {
      display: grid;
      gap: var(--mf-s1);
      margin: 0;
      padding: var(--mf-s2);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
    .de-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
    .de-clear {
      justify-self: start;
    }
    .de-link {
      justify-self: start;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mf-primary);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
  `,
  template: `
    @let t = store.task();
    <button
      #trigger
      type="button"
      class="de-trigger"
      data-due-trigger
      aria-haspopup="true"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? uid + '-pop' : null"
      [attr.aria-label]="triggerLabel()"
      [attr.aria-busy]="busy() ? 'true' : null"
      [attr.aria-disabled]="busy() ? 'true' : null"
      (click)="toggle($event)"
    >
      @if (t) {
        <mf-due-cell
          layout="inline"
          [due]="{ dueDate: t.dueDate, dueAtUtc: t.dueAtUtc }"
          [status]="t.status"
          [wasDue]="true"
        />
      }
      <i
        class="pi"
        [class]="busy() ? 'pi-spin pi-spinner' : 'pi-chevron-down'"
        aria-hidden="true"
      ></i>
    </button>
    @if (open()) {
      <div
        #pop
        class="de-pop"
        role="group"
        data-due-popover
        [id]="uid + '-pop'"
        aria-label="Change due date"
        [mfDismissable]="trigger"
        (dismissed)="close(false)"
        [style.top.px]="pos().top"
        [style.left.px]="pos().left"
        (click)="$event.stopPropagation()"
        (keydown)="$event.stopPropagation()"
      >
        <p class="de-title" aria-hidden="true">Due date</p>
        <form class="de-form" novalidate (submit)="save($event)">
          <fieldset class="de-fields">
            <legend class="de-sr">Due date and time</legend>
            <div class="mf-field">
              <label class="mf-field__label" [for]="uid + '-date'">Due date</label>
              <mf-date-input
                [inputId]="uid + '-date'"
                label="due date"
                [isoValue]="date() || null"
                [invalid]="!!dateError()"
                [showError]="false"
                (isoChange)="date.set($event ?? '')"
                (textInvalid)="dateBad.set($event)"
              />
              @if (dateError(); as e) {
                <p class="mf-field__error" role="alert" data-due-error="date">{{ e }}</p>
              }
            </div>
            <div class="mf-field">
              <label class="mf-field__label" [for]="uid + '-time'">Time ({{ zoneName() }})</label>
              <input
                [id]="uid + '-time'"
                class="mf-field__input"
                type="time"
                [value]="time()"
                [attr.aria-invalid]="timeError() ? 'true' : null"
                (input)="time.set($any($event.target).value)"
              />
              @if (timeError(); as e) {
                <p class="mf-field__error" role="alert" data-due-error="time">{{ e }}</p>
              }
            </div>
            <p class="mf-field__help">
              The time is optional and is in your time zone ({{ zone }}). Leave the date empty for
              ASAP.
            </p>
          </fieldset>
          @if (pastDue()) {
            <p class="de-warn" role="status" data-past-due>
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              This date has already passed. The task will be overdue. You can still save.
            </p>
          }
          @if (conflict()) {
            <p class="de-alert" role="alert" data-due-conflict>
              <span>
                This task was changed by someone else, so your change wasn't saved. Reload to see
                the latest version.
              </span>
              <button type="button" class="de-link" data-due-reload (click)="reload()">
                Reload
              </button>
            </p>
          } @else if (message(); as m) {
            <p class="de-alert" role="alert" data-due-message>{{ m }}</p>
          }
          <div class="de-actions">
            <button
              #saveBtn
              type="submit"
              class="mf-btn mf-btn--primary"
              data-due-save
              [attr.aria-disabled]="busy() ? 'true' : null"
            >
              Save
            </button>
            <button type="button" class="mf-btn" data-due-cancel (click)="close(true)">
              Cancel
            </button>
          </div>
          @if (hasDue()) {
            <button
              type="button"
              class="mf-btn mf-btn--text de-clear"
              data-due-clear
              [attr.aria-disabled]="busy() ? 'true' : null"
              (click)="clear()"
            >
              Clear due date (ASAP)
            </button>
          }
        </form>
      </div>
    }
  `,
})
export class DueEdit implements OnDestroy {
  protected readonly store = inject(TaskDetailStore);
  private readonly tasks = inject(TasksClient);
  private readonly clock = inject(Clock);
  protected readonly zone = inject(USER_TIME_ZONE);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** What to say politely after a save: "Due date set to Oct 24, 2026 5:00 PM" or "Due date cleared". */
  readonly announce = output<string>();

  protected readonly uid = `de-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly date = signal('');
  protected readonly time = signal('');
  protected readonly dateBad = signal(false);
  private readonly errors = signal<{ date?: string; time?: string }>({});
  protected readonly message = signal<string | null>(null);
  protected readonly conflict = signal(false);
  protected readonly pos = signal({ top: 0, left: 0 });

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly pop = viewChild<ElementRef<HTMLElement>>('pop');
  private readonly saveButton = viewChild<ElementRef<HTMLButtonElement>>('saveBtn');
  private original = { date: '', time: '' };

  protected readonly zoneName = computed(() => zoneAbbreviation(new Date(), this.zone));
  protected readonly dateError = computed(() => this.errors().date ?? null);
  protected readonly timeError = computed(() => this.errors().time ?? null);
  protected readonly hasDue = computed(() => !!this.store.task()?.dueDate);

  /** Starts with the visible text (WCAG 2.5.3), then says what it changes and for which task. */
  protected readonly triggerLabel = computed(() => {
    const t = this.store.task();
    if (!t) return 'Change due date';
    const cell = describeDueCell(
      { dueDate: t.dueDate, dueAtUtc: t.dueAtUtc },
      this.clock.now(),
      this.zone,
      t.status,
    );
    return `${dueCellText(cell)}, change due date of ${t.taskNumber}`;
  });

  /** Non-blocking, as in the Edit dialog: the chosen date or time is already in the past (only when the person changed it). */
  protected readonly pastDue = computed(() => {
    const day = parseDateOnly(this.date());
    if (!day) return false;
    if (this.date() === this.original.date && this.time() === this.original.time) return false;
    const now = this.clock.now();
    const m = /^(\d{2}):(\d{2})$/.exec(this.time());
    if (m) return zonedLocalToUtc({ ...day, hour: +m[1], minute: +m[2] }, this.zone) < now;
    return dayIndex(day) < dayIndex(calendarDayInZone(now, this.zone));
  });

  ngOnDestroy(): void {
    this.unwatch();
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
    if (this.busy()) return;
    if (this.open()) this.close(true);
    else this.show();
  }

  private show(): void {
    const t = this.store.task();
    if (!t) return;
    this.original = { date: t.dueDate ?? '', time: t.dueTime ?? '' };
    this.date.set(this.original.date);
    this.time.set(this.original.time);
    this.dateBad.set(false);
    this.errors.set({});
    this.message.set(null);
    this.conflict.set(false);
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    this.pos.set({ top: rect.bottom + 4, left: Math.max(8, rect.left) });
    this.open.set(true);
    window.addEventListener('resize', this.place);
    document.addEventListener('scroll', this.place, true);
    setTimeout(() => {
      this.place();
      this.host.nativeElement
        .querySelector<HTMLElement>(`#${this.uid}-date`)
        ?.focus({ preventScroll: true });
    });
  }

  close(returnFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    this.unwatch();
    if (returnFocus) this.trigger().nativeElement.focus({ preventScroll: true });
  }

  private unwatch(): void {
    window.removeEventListener('resize', this.place);
    document.removeEventListener('scroll', this.place, true);
  }

  /** Puts the popover under the tile (above it when there is no room below), inside the window. */
  private readonly place = (): void => {
    const pop = this.pop()?.nativeElement;
    if (!pop) return;
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const { width, height } = pop.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const below = rect.bottom + 4;
    let top = below;
    if (below + height > window.innerHeight - margin) {
      const above = rect.top - 4 - height;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
    }
    const now = this.pos();
    if (now.top !== top || now.left !== left) this.pos.set({ top, left });
  };

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    const date = this.date();
    const time = this.time();
    const errors: { date?: string; time?: string } = {};
    if (this.dateBad()) errors.date = BAD_DATE;
    else if (time && !date) errors.date = 'Choose a date for the due time.';
    this.errors.set(errors);
    if (errors.date) {
      this.host.nativeElement
        .querySelector<HTMLElement>(`#${this.uid}-date`)
        ?.focus({ preventScroll: true });
      return;
    }
    if (date === this.original.date && time === this.original.time) {
      this.close(true);
      return;
    }
    await this.submit(date, date ? time : '');
  }

  protected async clear(): Promise<void> {
    if (this.busy()) return;
    this.date.set('');
    this.time.set('');
    this.dateBad.set(false);
    this.errors.set({});
    await this.submit('', '');
  }

  /**
   * The update call replaces the details as sent (an omitted optional field is cleared), so everything the Edit dialog would send is sent
   * back as the task has it; only the due date and time change. The request form values are a patch, so none are sent.
   */
  private async submit(date: string, time: string): Promise<void> {
    this.message.set(null);
    this.conflict.set(false);
    this.busy.set(true);
    const result = await this.store.act((t) =>
      this.tasks.updateTask(t.taskId, {
        rowVersion: t.rowVersion,
        projectId: t.project?.projectId,
        title: t.title,
        description:
          t.descriptionFormat !== 'HTML' && t.description
            ? t.description
            : isBlankHtml(t.description)
              ? undefined
              : t.description,
        requestorName: t.requestorName,
        requestorEmail: t.requestorEmail || undefined,
        requestedAtUtc: t.requestedAtUtc,
        dueDate: date || undefined,
        dueTime: date && time ? time : undefined,
      }),
    );
    this.busy.set(false);
    if (result.ok) {
      this.close(false);
      this.trigger().nativeElement.focus({ preventScroll: true });
      const saved = result.task;
      const at = clockText(saved.dueTime ?? '');
      this.announce.emit(
        saved.dueDate
          ? `Due date set to ${formatDateOnly(saved.dueDate)}${at ? ' ' + at : ''}`
          : 'Due date cleared',
      );
      return;
    }
    const mapped = serverFormErrors(result.error);
    if (mapped.conflict) {
      this.conflict.set(true);
    } else {
      const { dueDate, dueTime, ...other } = mapped.fields;
      this.errors.set({ date: dueDate, time: dueTime });
      this.message.set(
        Object.values(other)[0] ?? (dueDate || dueTime ? null : this.errorText(result.error)),
      );
    }
    // The message is inside the popover; the cursor goes to Save so a retry (or Cancel) is one key away.
    setTimeout(() => this.saveButton()?.nativeElement.focus({ preventScroll: true }));
  }

  private errorText(error: unknown): string {
    // A failed connection has no message of its own worth showing (the HTTP layer toasts it).
    const text = error instanceof ApiError && error.status !== 0 ? error.message : '';
    return text || "We couldn't save the due date. Try again.";
  }

  protected reload(): void {
    this.close(false);
    this.trigger().nativeElement.focus({ preventScroll: true });
    void this.store.load();
  }
}
