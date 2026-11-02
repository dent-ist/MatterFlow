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
import { firstValueFrom } from 'rxjs';
import { MatterEventsClient } from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { EVENT_TYPES, EventIcon } from '../../../shared/ui/event-type';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { TextField } from '../../../shared/ui/text-field';

/**
 * Add an event to the matter in the shared form dialog (MD-08, #1009; a pop-up since MD-22): one of the eight types, a title, a date, an optional time (blank = all day) and a note.
 * It replaces the dialog of My Matters on this page only (My Matters keeps its dialog until it is converted). Saved, the dialog closes and `saved` fires.
 */
@Component({
  selector: 'mf-matter-event-panel',
  imports: [FormDialog, TextField, EventIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-form-dialog
      title="Add event"
      [subtitle]="matterLabel()"
      primaryLabel="Add event"
      [busy]="busy()"
      [error]="error()"
      [dirty]="dirty()"
      [(visible)]="visible"
      (submitted)="save()"
    >
      <form class="mev__form" novalidate (submit)="$event.preventDefault(); save()">
        <fieldset class="mev__types">
          <legend>Type</legend>
          @for (t of types; track t.code) {
            <label class="mev__type" [class.mev__type--on]="type() === t.code">
              <input
                type="radio"
                name="event-type"
                [value]="t.code"
                [checked]="type() === t.code"
                (change)="type.set(t.code)"
              />
              <mf-event-icon [type]="t.code" /> <span>{{ t.name }}</span>
            </label>
          }
          @if (typeError()) {
            <p class="mev__err" role="alert">{{ typeError() }}</p>
          }
        </fieldset>
        <mf-text-field
          inputId="event-title"
          label="Title"
          [required]="true"
          [maxLength]="200"
          [error]="titleError()"
          [(value)]="title"
        />
        <div class="pg-field">
          <label class="mf-label" for="event-date">Date</label>
          <input
            id="event-date"
            class="mf-control"
            type="date"
            [value]="date()"
            [attr.aria-invalid]="dateError() ? 'true' : null"
            (input)="date.set($any($event.target).value)"
          />
          @if (dateError()) {
            <p class="mev__err" role="alert">{{ dateError() }}</p>
          }
        </div>
        <div class="pg-field">
          <label class="mf-label" for="event-time">Time (optional, blank = all day)</label>
          <input
            id="event-time"
            class="mf-control"
            type="time"
            [value]="time()"
            (input)="time.set($any($event.target).value)"
          />
        </div>
        <mf-text-field
          inputId="event-note"
          label="Note"
          [multiline]="true"
          [maxLength]="1000"
          [(value)]="note"
        />
      </form>
    </mf-form-dialog>
  `,
  styles: `
    .mev__form {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
    }
    .mev__types {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .mev__types legend {
      grid-column: 1 / -1;
      padding: 0;
      margin-bottom: var(--mf-s1);
      font-weight: 600;
    }
    .mev__type {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-ctl-h);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      cursor: pointer;
    }
    .mev__type--on {
      border-color: var(--mf-sem-info-solid);
      background: var(--mf-sem-info-bg);
    }
    .mev__err {
      margin: var(--mf-s1) 0 0;
      color: var(--mf-sem-overdue-fg);
      grid-column: 1 / -1;
    }
  `,
})
export class MatterEventPanel {
  readonly matterId = input.required<number>();
  readonly matterLabel = input('');
  readonly visible = model(false);
  readonly saved = output<void>();

  private readonly api = inject(MatterEventsClient);
  private readonly notify = inject(NotificationService);

  protected readonly types = EVENT_TYPES;
  protected readonly type = signal('');
  protected readonly title = signal('');
  protected readonly date = signal('');
  protected readonly time = signal('');
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly submitted = signal(false);

  protected readonly typeError = computed(() =>
    this.submitted() && !this.type() ? 'Choose a type.' : null,
  );
  protected readonly titleError = computed(() =>
    this.submitted() && !this.title().trim() ? 'Enter a title.' : null,
  );
  protected readonly dateError = computed(() =>
    this.submitted() && !this.date() ? 'Choose a date.' : null,
  );
  protected readonly dirty = computed(
    () =>
      !!(this.type() || this.title().trim() || this.date() || this.time() || this.note().trim()),
  );

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.type.set('');
        this.title.set('');
        this.date.set('');
        this.time.set('');
        this.note.set('');
        this.error.set('');
        this.submitted.set(false);
      });
    });
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    this.error.set('');
    if (!this.type() || !this.title().trim() || !this.date()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.api.createMatterEvent(this.matterId(), {
          typeCode: this.type(),
          title: this.title().trim(),
          date: this.date(),
          time: this.time() || undefined,
          note: this.note().trim() || undefined,
        }),
      );
      this.notify.success('Event added');
      this.visible.set(false);
      this.saved.emit();
    } catch (err) {
      const e = serverFormErrors(err);
      this.error.set(e.summary[0] ?? "The event couldn't be saved.");
    } finally {
      this.busy.set(false);
    }
  }
}
