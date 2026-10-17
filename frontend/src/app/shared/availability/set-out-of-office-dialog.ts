import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { DateInput } from 'form-engine';
import { NOTE_MAX } from '../../core/availability/availability';
import { outOfOfficeSummary, validateRange } from '../../core/availability/availability-edit';
import { MyAvailability } from '../../core/availability/my-availability';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { calendarDayInZone } from '../../core/time/time';
import { DialogFocus } from '../ui/dialog-focus';

/**
 * "Set out of office..." from the header menu: an until date (optional) and a note (optional), out of office from now. Everything else
 * (work hours, time zone) stays as it is; the profile screen has the full form.
 */
@Component({
  selector: 'mf-set-out-of-office-dialog',
  imports: [Dialog, Button, DateInput, DialogFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      header="Set out of office"
      [modal]="true"
      [closable]="true"
      closeAriaLabel="Close dialog"
      [mfDialogFocus]="visible()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="onVisible($event)"
      [style]="{ width: '30rem', maxWidth: '95vw' }"
    >
      <form class="ooo" novalidate (submit)="$event.preventDefault(); save()" data-ooo-dialog>
        @if (error()) {
          <p class="ooo__error" role="alert">{{ error() }}</p>
        }
        <p class="ooo__help">
          You will show as out of office from now. Work can still be assigned to you.
        </p>
        <div class="ooo__field">
          <label class="ooo__label" for="ooo-until">Until (optional)</label>
          <mf-date-input
            inputId="ooo-until"
            label="Until date"
            [isoValue]="until()"
            [invalid]="!!untilError()"
            (isoChange)="until.set($event)"
            (textInvalid)="untilBad.set($event)"
          />
          @if (untilError(); as e) {
            <p class="ooo__error" role="alert" data-until-error>{{ e }}</p>
          }
        </div>
        <div class="ooo__field">
          <label class="ooo__label" for="ooo-note">Note (optional)</label>
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
      </form>
      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" (onClick)="visible.set(false)" />
        <p-button
          label="Set out of office"
          data-ooo-confirm
          [disabled]="busy() || !!untilError()"
          (onClick)="save()"
        />
      </ng-template>
    </p-dialog>
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
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly noteMax = NOTE_MAX;
  protected readonly until = signal<string | null>(null);
  protected readonly untilBad = signal(false);
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly untilError = computed(() => {
    if (this.untilBad()) return 'Enter a valid Until date, for example Oct 20, 2026.';
    const until = this.until();
    if (!until) return null;
    const today = calendarDayInZone(this.clock.now(), this.zone);
    const todayIso = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
    return validateRange(todayIso, until, this.note()).until?.replace('From', 'today') ?? null;
  });

  protected readonly sentence = computed(() =>
    outOfOfficeSummary(null, this.until(), {
      self: true,
      today: calendarDayInZone(this.clock.now(), this.zone),
    }),
  );

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
      this.untilBad.set(false);
      this.note.set('');
      this.error.set('');
    }
  }

  protected async save(): Promise<void> {
    if (this.busy() || this.untilError()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.store.setOutOfOffice(this.until(), this.note());
      this.notify.success(
        'You are out of office',
        'Use "I\'m back" in your name menu when you return.',
      );
      this.visible.set(false);
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : 'We could not save that. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
