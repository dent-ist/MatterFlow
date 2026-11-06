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
import { NOTE_MAX } from '../../../core/availability/availability';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { Dropdown, DropdownItem } from '../../ui/dropdown';
import { FormDialog } from '../../ui/form-dialog';
import { numericDate } from '../../ui/numeric-date';
import { ABSENCE_API } from './absence-api';
import {
  ABSENCE_TYPES,
  ABSENCE_TYPE_LABELS,
  AbsenceCheck,
  AbsenceEntry,
  AbsenceOverlap,
  AbsenceType,
  isAbsenceType,
} from './absence-contract';
import { AbsenceProblems, overlapMessage, validateAbsence } from './absence-rules';

/** A person a manager can add an entry for (the Person field). */
export interface AbsencePerson {
  userId: number;
  name: string;
}

/** The overlapped entry of a 409, wherever the server put it (`overlapsWith` at the top of the body, or in `meta`). */
export function overlapOf(err: ApiError): AbsenceOverlap | null {
  const p = err.problem as unknown as Record<string, unknown> | undefined;
  const meta = (p?.['meta'] ?? {}) as Record<string, unknown>;
  const o = (p?.['overlapsWith'] ?? meta['overlapsWith']) as AbsenceOverlap | undefined;
  return o && typeof o === 'object' ? o : null;
}

/**
 * Add or edit one Out of office entry (epic #1074, CAL-05) in the app's pop-up dialog standard: Cancel on the left, the primary action on the right, "You have unsaved changes. Discard them?"
 * on a dirty close. Type, Start, End (the last day out, included; empty = open-ended), Note (200 characters, "no medical details") and, for people who may
 * manage availability, a Person field. The form checks what it can; the server decides again, and its messages (overlap names the other entry, a start in the past) sit
 * under the dates. The pod-below-minimum answer of `/check` is advice shown under the dates and never blocks the save.
 */
@Component({
  selector: 'mf-absence-dialog',
  imports: [Dropdown, FormDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-form-dialog
      [title]="entry() ? 'Edit Out of Office' : 'Add Out of Office'"
      [subtitle]="subtitle()"
      [primaryLabel]="entry() ? 'Save Changes' : 'Add Out of Office'"
      size="default"
      [dirty]="dirty()"
      [busy]="busy()"
      [error]="generalError()"
      [(visible)]="visible"
      (submitted)="save()"
      data-absence-dialog
    >
      <form class="ad" novalidate (submit)="$event.preventDefault(); save()">
        @if (people().length > 0 && !entry()) {
          <div class="ad__field">
            <label class="ad__label" for="ad-person">Person</label>
            <mf-dropdown
              buttonId="ad-person"
              label="Person"
              data-ad-person
              [items]="personItems()"
              [value]="'' + personId()"
              (valueChange)="personId.set(+$event)"
            />
          </div>
        }
        <div class="ad__field">
          <label class="ad__label" for="ad-type">Type</label>
          <mf-dropdown
            buttonId="ad-type"
            label="Type"
            data-ad-type
            [items]="typeItems"
            [value]="type()"
            (valueChange)="setType($event)"
          />
        </div>
        <div class="ad__dates">
          <div class="ad__field">
            <label class="ad__label" for="ad-start">First Day Out</label>
            <input
              id="ad-start"
              type="date"
              lang="en-US"
              class="mf-control mf-control--fill"
              aria-describedby="ad-dates-help"
              [value]="start() ?? ''"
              [attr.aria-invalid]="problems().startDate ? 'true' : null"
              (input)="start.set($any($event.target).value || null); clearServer()"
            />
            @if (problems().startDate; as e) {
              <p class="ad__error" role="alert" data-ad-start-error>
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
              </p>
            }
          </div>
          <div class="ad__field">
            <label class="ad__label" for="ad-end">Last Day Out</label>
            <input
              id="ad-end"
              type="date"
              lang="en-US"
              class="mf-control mf-control--fill"
              aria-describedby="ad-dates-help"
              [value]="end() ?? ''"
              [attr.aria-invalid]="problems().endDate ? 'true' : null"
              (input)="end.set($any($event.target).value || null); clearServer()"
            />
            @if (problems().endDate; as e) {
              <p class="ad__error" role="alert" data-ad-end-error>
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
              </p>
            }
          </div>
        </div>
        <p class="ad__help" id="ad-dates-help">
          The last day is included. Leave it empty only for an entry that starts today; "I'm back"
          ends it.
        </p>
        @if (serverDates(); as e) {
          <p class="pg-banner pg-banner--danger" role="alert" data-ad-overlap>
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
            <span>{{ e }}</span>
          </p>
        }
        @if (advice(); as a) {
          <p class="pg-banner" role="status" data-ad-advice>
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            <span>{{ a }} You can still save.</span>
          </p>
        }
        <div class="ad__field">
          <label class="ad__label" for="ad-note">Note</label>
          <textarea
            id="ad-note"
            class="mf-control mf-control--fill ad__note"
            rows="2"
            autocomplete="off"
            aria-describedby="ad-note-help ad-note-count"
            [attr.maxlength]="noteMax"
            [attr.aria-invalid]="problems().note ? 'true' : null"
            [value]="note()"
            (input)="note.set($any($event.target).value)"
          ></textarea>
          <p class="ad__help" id="ad-note-help">
            Who covers for you, for example. Please do not enter medical details. Only you and your
            managers see the note.
          </p>
          <p class="ad__count" id="ad-note-count">{{ note().length }} / {{ noteMax }}</p>
          @if (problems().note; as e) {
            <p class="ad__error" role="alert">{{ e }}</p>
          }
        </div>
      </form>
    </mf-form-dialog>
  `,
  styles: `
    .ad {
      display: grid;
      gap: var(--mf-s3);
      padding: var(--mf-s1);
    }
    .ad__field {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s1);
      min-width: 0;
    }
    .ad__dates {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s3);
    }
    @media (max-width: 479.98px) {
      .ad__dates {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .ad__label {
      font-weight: 600;
    }
    .ad__help,
    .ad__count {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ad__count {
      text-align: right;
    }
    .ad__note {
      min-height: 0;
      padding: var(--mf-s2) var(--mf-s3);
      resize: vertical;
    }
    .ad__error {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s1);
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class AbsenceDialog {
  readonly visible = model(false);
  /** The person the entry is for (the signed-in person unless a manager adds one for someone else). */
  readonly userId = input.required<number>();
  readonly displayName = input('');
  /** The entry being edited, or null for a new one. */
  readonly entry = input<AbsenceEntry | null>(null);
  /** A manager (User.ManageAvailability) acting for someone else: may start in the past. */
  readonly canBackdate = input(false);
  /** The first day proposed for a new entry (a day picked on the Calendar). */
  readonly initialStart = input<string | null>(null);
  /** People to choose from (managers only); empty hides the Person field. */
  readonly people = input<readonly AbsencePerson[]>([]);
  /** The type proposed for a new entry (the header menu's quick action). */
  readonly initialType = input<AbsenceType>('VACATION');

  readonly saved = output<AbsenceEntry>();

  private readonly api = inject(ABSENCE_API);
  private readonly notify = inject(NotificationService);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly typeItems: readonly DropdownItem[] = ABSENCE_TYPES.map((t) => ({
    value: t,
    label: ABSENCE_TYPE_LABELS[t],
  }));
  protected readonly noteMax = NOTE_MAX;

  protected readonly personId = signal(0);
  protected readonly personItems = computed<DropdownItem[]>(() =>
    this.people().map((p) => ({ value: String(p.userId), label: p.name })),
  );
  protected readonly type = signal<AbsenceType>('VACATION');
  protected readonly start = signal<string | null>(null);
  protected readonly end = signal<string | null>(null);
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly generalError = signal('');
  protected readonly server = signal<{
    dates?: string;
    start?: string;
    end?: string;
    note?: string;
  }>({});
  protected readonly check = signal<AbsenceCheck | null>(null);
  private baseline = '';
  private checkSeq = 0;
  private showProblems = signal(false);

  protected readonly subtitle = computed(() => {
    const name = this.targetName();
    return name ? `For ${name}` : '';
  });
  private readonly targetName = computed(() => {
    const id = this.personId();
    const p = this.people().find((x) => x.userId === id);
    return p?.name ?? (this.people().length > 0 || this.displayName() ? this.displayName() : '');
  });
  private readonly today = computed(() => {
    const d = calendarDayInZone(this.clock.now(), this.zone);
    return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  });

  protected readonly problems = computed<AbsenceProblems>(() => {
    if (!this.showProblems() && !this.dirty()) return {};
    const found = validateAbsence(
      {
        type: this.type(),
        startDate: this.start() ?? '',
        endDate: this.end(),
        note: this.note(),
      },
      { today: this.today(), canBackdate: this.canBackdate() },
      !!this.entry(),
    );
    return {
      ...found,
      startDate: found.startDate ?? this.server().start,
      endDate: found.endDate ?? this.server().end,
      note: found.note ?? this.server().note,
    };
  });
  protected readonly serverDates = computed(() => this.server().dates ?? null);
  protected readonly dirty = computed(() => this.signature() !== this.baseline);

  /** The advisory line from the check: the pods that would be below their minimum, with the first days. */
  protected readonly advice = computed(() => {
    const pods = this.check()?.podsBelowMinimum ?? [];
    if (pods.length === 0) return null;
    return pods
      .map((p) => {
        const first = p.days
          .slice(0, 3)
          .map((d) => numericDate(d, this.clock.now(), this.zone))
          .join(', ');
        const more = p.days.length > 3 ? ` and ${p.days.length - 3} more` : '';
        return `${p.name} would be below its minimum on ${first}${more}.`;
      })
      .join(' ');
  });

  constructor() {
    // Opening the dialog (re)fills the form from the entry being edited or from the proposals.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => this.reset());
    });
    // The advisory check follows the dates (valid ones only); a later answer replaces an earlier one, an old one is dropped.
    effect(() => {
      const start = this.start();
      const end = this.end();
      const id = this.personId();
      if (!this.visible()) return;
      untracked(() => void this.runCheck(id, start, end));
    });
  }

  private signature(): string {
    return JSON.stringify([
      this.personId(),
      this.type(),
      this.start(),
      this.end(),
      this.note().trim(),
    ]);
  }

  private reset(): void {
    const e = this.entry();
    this.personId.set(e?.userId ?? this.userId());
    this.type.set(e?.type ?? this.initialType());
    this.start.set(e?.startDate ?? this.initialStart() ?? this.today());
    this.end.set(e?.endDate ?? null);
    this.note.set(e?.note ?? '');
    this.server.set({});
    this.generalError.set('');
    this.check.set(null);
    this.showProblems.set(false);
    this.busy.set(false);
    this.baseline = this.signature();
  }

  protected setType(value: string): void {
    if (isAbsenceType(value)) this.type.set(value);
    this.clearServer();
  }

  protected clearServer(): void {
    this.server.set({});
    this.generalError.set('');
  }

  private async runCheck(id: number, start: string | null, end: string | null): Promise<void> {
    const seq = ++this.checkSeq;
    if (!start || (end && end < start)) {
      this.check.set(null);
      return;
    }
    try {
      const answer = await this.api.check(id, start, end);
      if (seq === this.checkSeq) this.check.set(answer);
    } catch {
      if (seq === this.checkSeq) this.check.set(null); // advice only: a failed check never blocks
    }
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.showProblems.set(true);
    const found = this.problems();
    if (found.startDate || found.endDate || found.note) return;
    const input = {
      type: this.type(),
      startDate: this.start()!,
      endDate: this.end(),
      note: this.note().trim() || null,
      rowVersion: this.entry()?.rowVersion,
    };
    this.busy.set(true);
    this.generalError.set('');
    try {
      const e = this.entry();
      const saved = e
        ? await this.api.update(e.userId, e.absenceId, input)
        : await this.api.create(this.personId(), input);
      this.notify.success(e ? 'Out of office saved' : 'Out of office added', undefined, {
        key: 'absence',
      });
      this.saved.emit(saved);
      this.visible.set(false);
    } catch (err) {
      this.onError(err);
    } finally {
      this.busy.set(false);
    }
  }

  private onError(err: unknown): void {
    if (!(err instanceof ApiError)) {
      this.generalError.set("Couldn't save the out of office entry. Try again.");
      return;
    }
    const other = err.status === 409 ? overlapOf(err) : null;
    if (other) {
      const range = other.endDate
        ? `${numericDate(other.startDate, this.clock.now(), this.zone)} to ${numericDate(other.endDate, this.clock.now(), this.zone)}`
        : `from ${numericDate(other.startDate, this.clock.now(), this.zone)}`;
      this.server.set({
        dates: overlapMessage(ABSENCE_TYPE_LABELS[other.type] ?? 'Out of Office', range),
      });
      return;
    }
    switch (err.code) {
      case 'CONCURRENCY_CONFLICT':
        this.generalError.set(
          'This entry was changed somewhere else. Close this window and open it again to see the latest.',
        );
        break;
      case 'ABSENCE_IN_PAST':
        this.server.set({ start: err.message });
        break;
      case 'ABSENCE_RANGE_INVALID':
      case 'ABSENCE_OPEN_ENDED_NOT_TODAY':
        this.server.set({ end: err.message });
        break;
      case 'NOTE_TOO_LONG':
        this.server.set({ note: err.message });
        break;
      case 'ABSENCE_READ_ONLY':
        this.generalError.set('A past entry cannot be changed.');
        break;
      default:
        this.generalError.set(err.message || "Couldn't save the out of office entry. Try again.");
    }
  }
}
