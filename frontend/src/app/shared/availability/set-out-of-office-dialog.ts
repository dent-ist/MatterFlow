import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  model,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NOTE_MAX } from '../../core/availability/availability';
import {
  UNTIL_PRESETS,
  UntilPresetId,
  outOfOfficeSummary,
  presetUntil,
  validateRange,
} from '../../core/availability/availability-edit';
import { MyAvailability } from '../../core/availability/my-availability';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { calendarDayInZone } from '../../core/time/time';
import { Dropdown, DropdownItem } from '../ui/dropdown';
import { FilterChip, FilterChips } from '../ui/filter-chips';
import { FormDialog } from '../ui/form-dialog';
import {
  ABSENCE_TYPES,
  ABSENCE_TYPE_LABELS,
  AbsenceType,
  isAbsenceType,
} from './absences/absence-contract';

const PICK_KEY = 'pick';

/**
 * "Set out of office..." from the header menu: an until date and a note (both can be left empty, no mark), out of office from now. Everything else
 * (work hours, time zone) stays as it is; the profile screen has the full form.
 */
@Component({
  selector: 'mf-set-out-of-office-dialog',
  imports: [Dropdown, FormDialog, RouterLink, FilterChips],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-form-dialog
      title="Set Out of Office"
      primaryLabel="Set Out of Office"
      size="small"
      [canSubmit]="!untilError()"
      [busy]="busy()"
      [error]="error()"
      [visible]="visible()"
      (visibleChange)="onVisible($event)"
      (submitted)="save()"
    >
      <form class="ooo" novalidate (submit)="$event.preventDefault(); save()" data-ooo-dialog>
        <p class="ooo__help">
          You will show as out of office from today. Work can still be assigned to you.
        </p>
        <div class="ooo__field">
          <label class="ooo__label" for="ooo-type">Type</label>
          <mf-dropdown
            field
            buttonId="ooo-type"
            label="Type"
            data-ooo-type
            [items]="typeItems"
            [value]="type()"
            (valueChange)="setType($event)"
          />
        </div>
        <div class="ooo__field">
          <label class="ooo__label" for="ooo-until" id="ooo-until-label">Until</label>
          <mf-filter-chips
            label="Until"
            [chips]="presetChips"
            [value]="pressedPreset()"
            data-ooo-presets
            (valueChange)="onPresetChip($event)"
          />
          <input
            id="ooo-until"
            type="date"
            class="mf-control mf-control--fill"
            [value]="until() ?? ''"
            [attr.aria-invalid]="untilError() ? 'true' : null"
            (input)="onUntilTyped($any($event.target).value || null)"
          />
          @if (untilError(); as e) {
            <p class="ooo__error" role="alert" data-until-error>{{ e }}</p>
          }
        </div>
        <div class="ooo__field">
          <label class="ooo__label" for="ooo-note">Note</label>
          <textarea
            id="ooo-note"
            class="mf-control ooo__note"
            rows="2"
            autocomplete="off"
            aria-describedby="ooo-note-count"
            [attr.maxlength]="noteMax"
            [value]="note()"
            (input)="note.set($any($event.target).value)"
          ></textarea>
          <p class="ooo__count" id="ooo-note-count">{{ note().length }} / {{ noteMax }}</p>
        </div>
        <p class="ooo__sentence" role="status" data-ooo-summary>{{ sentence() }}</p>
        <p class="ooo__more">
          <a routerLink="/profile" data-ooo-more (click)="visible.set(false)"
            >More Options on My Profile</a
          >
        </p>
      </form>
    </mf-form-dialog>
  `,
  styles: `
    .ooo {
      display: grid;
      gap: var(--mf-s3);
    }
    .ooo__field {
      display: grid;
      gap: var(--mf-s1);
    }
    .ooo__label {
      font-weight: 600;
    }
    .ooo__more {
      margin: 0;
      font-size: var(--mf-fs-sm);
    }

    .ooo__help,
    .ooo__count {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ooo__count {
      text-align: right;
    }
    .ooo__note {
      min-height: 0;
      padding: var(--mf-s2) var(--mf-s3);
      resize: vertical;
    }
    .ooo__error {
      margin: 0;
      color: var(--mf-danger);
    }
    .ooo__sentence {
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      border-radius: var(--mf-radius);
      background: var(--mf-info-bg);
    }
  `,
})
export class SetOutOfOfficeDialog {
  readonly visible = model(false);

  private readonly store = inject(MyAvailability);
  private readonly notify = inject(NotificationService);
  private readonly clock = inject(Clock);
  private readonly viewerZone = inject(USER_TIME_ZONE);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Out-of-office days are evaluated in the profile's time zone (the viewer's zone until it is loaded). */
  private readonly zone = computed(
    () => this.store.profile()?.effectiveTimeZoneId ?? this.viewerZone,
  );
  private readonly today = computed(() => calendarDayInZone(this.clock.now(), this.zone()));

  private readonly todayIso = computed(() => {
    const t = this.today();
    return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  });
  protected readonly types = ABSENCE_TYPES;
  protected readonly typeItems: readonly DropdownItem[] = ABSENCE_TYPES.map((t) => ({
    value: t,
    label: ABSENCE_TYPE_LABELS[t],
  }));
  protected readonly type = signal<AbsenceType>('VACATION');
  protected setType(value: string): void {
    if (isAbsenceType(value)) this.type.set(value);
  }
  /** The quick choice that filled Until; cleared as soon as the date is typed or changed. */
  private readonly preset = signal<UntilPresetId | null>(null);
  protected readonly noteMax = NOTE_MAX;
  protected readonly until = signal<string | null>(null);
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly untilError = computed(() => {
    const until = this.until();
    if (!until) return null;
    const today = this.today();
    const todayIso = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
    return validateRange(todayIso, until, this.note()).until?.replace('From', 'today') ?? null;
  });

  protected readonly sentence = computed(() =>
    outOfOfficeSummary(null, this.until(), {
      self: true,
      today: this.today(),
    }),
  );

  /** The quick choices and "Pick a Date" as one single-choice row (`mf-filter-chips`, #1238). */
  protected readonly presetChips: FilterChip[] = [
    ...UNTIL_PRESETS.map((p) => ({ key: p.id, label: p.label })),
    { key: PICK_KEY, label: 'Pick a Date' },
  ];
  /** The chosen quick choice, or none (the Pick a Date chip is an action and is never chosen). */
  protected readonly pressedPreset = computed(
    () => UNTIL_PRESETS.find((p) => this.isPressed(p.id))?.id ?? null,
  );

  protected onPresetChip(key: string): void {
    if (key === PICK_KEY) this.pickDate();
    else this.choosePreset(key as UntilPresetId);
  }

  protected isPressed(id: UntilPresetId): boolean {
    return this.preset() === id && this.until() === presetUntil(id, this.today());
  }

  protected choosePreset(id: UntilPresetId): void {
    this.preset.set(id);
    this.until.set(presetUntil(id, this.today()));
  }

  protected onUntilTyped(iso: string | null): void {
    this.until.set(iso);
    const id = this.preset();
    if (id && iso !== presetUntil(id, this.today())) this.preset.set(null);
  }

  /** "Pick a date": the chips are for common answers, this one hands over to the date field. */
  protected pickDate(): void {
    this.host.nativeElement.ownerDocument.getElementById('ooo-until')?.focus();
  }

  /**
   * Opens the dialog with empty fields. The header calls this instead of `setInput('visible', true)`: the dialog closes itself (Esc, Cancel,
   * the X, Save) by writing its own `visible` model, and `ComponentRef.setInput` skips a value equal to the last one it set, so a second
   * "Set out of office..." did nothing until the page was reloaded (review round 5, UXR5-15).
   */
  open(): void {
    this.onVisible(true);
  }

  protected onVisible(value: boolean): void {
    this.visible.set(value);
    if (value) {
      this.until.set(null);
      this.type.set('VACATION');
      this.preset.set(null);
      void this.store.ensureLoaded();
      this.note.set('');
      this.error.set('');
    }
  }

  protected async save(): Promise<void> {
    if (this.busy() || this.untilError()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.store.setOutOfOffice(this.until(), this.note(), this.todayIso(), this.type());
      this.notify.success(
        'Out of office set',
        'Use "I\'m back" in your name menu when you return.',
        { key: 'availability' },
      );
      this.visible.set(false);
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : "Couldn't save that. Try again.");
    } finally {
      this.busy.set(false);
    }
  }
}
