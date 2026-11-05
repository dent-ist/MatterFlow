import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { NumericDatePipe, readableDate } from '../../ui/numeric-date';
import { AbsenceDialog, AbsencePerson } from './absence-dialog';
import { ABSENCE_API } from './absence-api';
import {
  ABSENCE_TYPE_ICONS,
  ABSENCE_TYPE_HUES,
  ABSENCE_TYPE_LABELS,
  AbsenceEntry,
} from './absence-contract';
import { groupAbsences } from './absence-rules';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * The Out of office list of a person (epic #1074, CAL-05): several entries, grouped Now, Upcoming and Past, each with its type (glyph and word), the first and last day
 * (the last day is included) in the My Matters numeric style, the number of working days and the note (the server sends the note only to the owner and the managers who may
 * edit). Add and Edit open the pop-up dialog, Delete asks first, "I'm back" ends a current entry. Past entries are read-only. The same list serves the Profile (own entries) and,
 * for a manager with User.ManageAvailability, someone else's (`self` false).
 */
@Component({
  selector: 'mf-absence-list',
  imports: [AbsenceDialog, ConfirmDialog, NgTemplateOutlet, NumericDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="al mf-card" aria-labelledby="al-title" data-absence-list>
      <header class="al__head">
        <div>
          <h2 class="al__title mf-card__title" id="al-title">Out of Office</h2>
          <p class="al__desc">
            {{
              self()
                ? 'Days you will not be at work. Colleagues and managers see them on the Dashboard Calendar.'
                : 'Days ' + displayName() + ' will not be at work.'
            }}
          </p>
        </div>
        <button
          type="button"
          class="mf-btn mf-btn--primary"
          data-add-absence
          [disabled]="state() !== 'ready'"
          (click)="openAdd()"
        >
          <i class="pi pi-plus" aria-hidden="true"></i> Add Out of Office
        </button>
      </header>

      @switch (state()) {
        @case ('loading') {
          <div class="al__state" role="status" aria-busy="true" data-absence-loading>
            <span class="al__sk"></span><span class="al__sk al__sk--short"></span>
            <span class="mf-sr-only">Loading out of office entries</span>
          </div>
        }
        @case ('error') {
          <div class="al__state al__state--error" role="alert" data-absence-error>
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            <span>We could not load the out of office entries.</span>
            <button type="button" class="mf-btn" (click)="load()">Retry</button>
          </div>
        }
        @default {
          @if (entries().length === 0) {
            <div class="al__state" data-absence-empty>
              <i class="pi pi-calendar" aria-hidden="true"></i>
              <span>No out of office entries. Add one when you plan to be away.</span>
            </div>
          }
          @if (groups().now.length > 0) {
            <h3 class="al__group">Now</h3>
            <ul class="al__list" data-group="now">
              @for (e of groups().now; track e.absenceId) {
                <ng-container *ngTemplateOutlet="row; context: { $implicit: e }" />
              }
            </ul>
          }
          @if (groups().upcoming.length > 0) {
            <h3 class="al__group">Upcoming</h3>
            <ul class="al__list" data-group="upcoming">
              @for (e of groups().upcoming; track e.absenceId) {
                <ng-container *ngTemplateOutlet="row; context: { $implicit: e }" />
              }
            </ul>
          }
          @if (groups().past.length > 0) {
            <h3 class="al__group">
              <button
                type="button"
                class="al__toggle"
                data-toggle-past
                [attr.aria-expanded]="showPast()"
                aria-controls="al-past"
                (click)="showPast.set(!showPast())"
              >
                <i
                  class="pi"
                  [class]="showPast() ? 'pi-chevron-down' : 'pi-chevron-right'"
                  aria-hidden="true"
                ></i>
                Past ({{ groups().past.length }})
              </button>
            </h3>
            @if (showPast()) {
              <ul class="al__list al__list--past" id="al-past" data-group="past">
                @for (e of groups().past; track e.absenceId) {
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: e }" />
                }
              </ul>
            }
          }
        }
      }
    </section>

    <ng-template #row let-e>
      <li class="al__row" [attr.data-absence]="e.absenceId" [attr.data-state]="e.state">
        <span class="al__type" [class]="'al__type al__type--' + hue(e)">
          <i class="pi" [class]="icon(e)" aria-hidden="true"></i>{{ label(e) }}
        </span>
        <div class="al__main">
          <span class="al__dates">
            <span aria-hidden="true"
              >{{ e.startDate | mfNum }}
              @if (e.endDate) {
                to {{ e.endDate | mfNum }}
              } @else {
                onward
              }
            </span>
            <span class="mf-sr-only">{{ spoken(e) }}</span>
            @if (e.workingDays !== null) {
              <span class="al__days"
                >{{ e.workingDays }} working {{ e.workingDays === 1 ? 'day' : 'days' }}</span
              >
            } @else {
              <span class="al__days">Open-ended</span>
            }
            @if (e.state === 'NOW') {
              <span class="al__now"><i class="pi pi-clock" aria-hidden="true"></i> Now</span>
            }
          </span>
          @if (e.note) {
            <span class="al__note" data-absence-note>{{ e.note }}</span>
          }
        </div>
        @if (e.state !== 'PAST') {
          <div class="al__acts">
            @if (e.state === 'NOW') {
              <button
                type="button"
                class="mf-btn"
                data-absence-back
                [disabled]="busyId() === e.absenceId"
                (click)="back(e)"
              >
                I'm Back
              </button>
            }
            <button
              type="button"
              class="mf-btn mf-btn--text"
              data-absence-edit
              [attr.aria-label]="'Edit ' + label(e) + ', ' + spoken(e)"
              (click)="openEdit(e)"
            >
              Edit
            </button>
            <button
              type="button"
              class="mf-btn mf-btn--text mf-btn--danger"
              data-absence-delete
              [attr.aria-label]="'Delete ' + label(e) + ', ' + spoken(e)"
              (click)="askDelete(e)"
            >
              Delete
            </button>
          </div>
        }
      </li>
    </ng-template>

    @if (dialogOpen()) {
      <mf-absence-dialog
        [(visible)]="dialogOpen"
        [userId]="userId()"
        [displayName]="displayName()"
        [entry]="editing()"
        [canBackdate]="!self()"
        [people]="people()"
        (saved)="onSaved()"
      />
    }
    @if (deleting(); as d) {
      <mf-confirm-dialog
        title="Delete Out of Office"
        confirmLabel="Delete Out of Office"
        [danger]="true"
        [busy]="deleteBusy()"
        [error]="deleteError()"
        [visible]="true"
        (visibleChange)="$event || cancelDelete()"
        (confirmed)="confirmDelete(d)"
      >
        <p>
          {{ label(d) }}, {{ spoken(d) }}, is deleted and colleagues see you as available on those
          days again.
        </p>
      </mf-confirm-dialog>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .al__head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mf-s2) var(--mf-s4);
    }
    /* The card look and the 16 / 600 title are the global .mf-card (#1134); the description sits right under the title. */
    .al__title {
      margin: 0;
    }
    .al__desc {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .al__group {
      margin: var(--mf-s4) 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      text-transform: uppercase;
    }
    .al__toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 32px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-transform: inherit;
      cursor: pointer;
    }
    .al__list {
      display: grid;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .al__row {
      display: grid;
      grid-template-columns: 8.5rem minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      padding: var(--mf-s2) 0;
      border-top: 1px solid var(--mf-border-soft);
    }
    .al__row:first-child {
      border-top: 0;
    }
    .al__list--past .al__row {
      color: var(--mf-text-muted);
    }
    .al__type {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      justify-self: start;
      height: 24px;
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      background: var(--mf-sem-neutral-bg);
      color: var(--mf-sem-neutral-fg);
    }
    .al__type--info {
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
    }
    .al__type--critical {
      background: var(--mf-sem-critical-bg);
      color: var(--mf-sem-critical-fg);
    }
    .al__type--healthy {
      background: var(--mf-sem-healthy-bg);
      color: var(--mf-sem-healthy-fg);
    }
    .al__type--person {
      background: var(--mf-sem-person-bg);
      color: var(--mf-sem-person-fg);
    }
    .al__main {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .al__dates {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
      font-weight: 600;
    }
    .al__days {
      color: var(--mf-text-muted);
      font-weight: 400;
      font-size: var(--mf-fs-sm);
    }
    .al__now {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      color: var(--mf-sem-info-fg);
      font-size: var(--mf-fs-sm);
    }
    .al__note {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      overflow-wrap: anywhere;
    }
    .al__acts {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .al__state {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin-top: var(--mf-s3);
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      color: var(--mf-text-muted);
    }
    .al__state--error {
      border-style: solid;
      border-color: var(--mf-sem-overdue-line);
      background: var(--mf-sem-overdue-bg);
      color: var(--mf-sem-overdue-fg);
    }
    .al__sk {
      display: block;
      width: 60%;
      height: 14px;
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
    }
    .al__sk--short {
      width: 35%;
    }
    @media (max-width: 639.98px) {
      .al {
        padding: var(--mf-s3);
      }
      .al__row {
        grid-template-columns: minmax(0, 1fr);
      }
      .al__acts {
        flex-wrap: wrap;
      }
      .al__head .mf-btn {
        width: 100%;
        justify-content: center;
      }
    }
  `,
})
export class AbsenceList {
  /** The person whose entries these are. */
  readonly userId = input.required<number>();
  readonly displayName = input('');
  /** Own entries (the Profile): the note is the person's own; false for a manager looking at someone else's. */
  readonly self = input(true);
  /** People a manager may add entries for (a Person field in the dialog); empty on the Profile. */
  readonly people = input<readonly AbsencePerson[]>([]);
  /** Something was saved, deleted or ended: the header and the Calendar read again. */
  readonly changed = output<void>();

  private readonly api = inject(ABSENCE_API);
  private readonly notify = inject(NotificationService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly entries = signal<AbsenceEntry[]>([]);
  protected readonly groups = computed(() => groupAbsences(this.entries()));
  protected readonly showPast = signal(false);
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<AbsenceEntry | null>(null);
  protected readonly deleting = signal<AbsenceEntry | null>(null);
  protected readonly deleteBusy = signal(false);
  protected readonly deleteError = signal('');
  protected readonly busyId = signal<number | null>(null);

  constructor() {
    effect(() => {
      this.userId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.entries.set(await this.api.list(this.userId(), true));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  protected label(e: AbsenceEntry): string {
    return ABSENCE_TYPE_LABELS[e.type];
  }
  protected icon(e: AbsenceEntry): string {
    return ABSENCE_TYPE_ICONS[e.type];
  }
  protected hue(e: AbsenceEntry): string {
    return ABSENCE_TYPE_HUES[e.type];
  }

  /** The dates in words, for screen readers and button names (the numeric style is for the eye). */
  protected spoken(e: AbsenceEntry): string {
    return e.endDate
      ? `${readableDate(e.startDate)} to ${readableDate(e.endDate)}`
      : `from ${readableDate(e.startDate)}, no end date`;
  }

  /** Opens the Add dialog (the Profile's header button calls it). */
  openAdd(): void {
    this.editing.set(null);
    this.dialogOpen.set(true);
  }

  protected openEdit(e: AbsenceEntry): void {
    this.editing.set(e);
    this.dialogOpen.set(true);
  }

  protected async onSaved(): Promise<void> {
    await this.load();
    this.changed.emit();
  }

  protected askDelete(e: AbsenceEntry): void {
    this.deleteError.set('');
    this.deleting.set(e);
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected async confirmDelete(e: AbsenceEntry): Promise<void> {
    this.deleteBusy.set(true);
    try {
      await this.api.remove(e.userId, e.absenceId, e.rowVersion);
      this.deleting.set(null);
      this.notify.success('Out of office deleted', undefined, { key: 'absence' });
      await this.load();
      this.changed.emit();
    } catch (err) {
      this.deleteError.set(
        err instanceof ApiError && err.status === 409
          ? 'This entry was changed somewhere else. Close this window to see the latest list.'
          : "Couldn't delete the entry. Try again.",
      );
    } finally {
      this.deleteBusy.set(false);
    }
  }

  protected async back(e: AbsenceEntry): Promise<void> {
    this.busyId.set(e.absenceId);
    try {
      await this.api.back(e.userId, e.absenceId);
      this.notify.success(
        this.self() ? 'Welcome back' : 'Entry ended',
        this.self() ? 'You show as available again.' : undefined,
        { key: 'absence' },
      );
      await this.load();
      this.changed.emit();
    } catch (err) {
      this.notify.error(
        "Couldn't end the entry.",
        err instanceof ApiError ? err.message : 'Try again.',
      );
    } finally {
      this.busyId.set(null);
    }
  }
}
