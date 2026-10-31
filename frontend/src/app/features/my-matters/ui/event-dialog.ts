import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  effect,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { NotificationService } from '../../../core/notify/notification.service';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import { EVENT_TYPES, EventIcon } from '../../../shared/ui/event-type';
import { MmApi } from './mm-api';
import { MatterEvent, MatterTree } from './mm-models';

interface Errors {
  matter?: string;
  type?: string;
  title?: string;
  date?: string;
  time?: string;
  form?: string;
}

/**
 * The calendar item dialog (`mf-mm-event-dialog`, epic #953 UI-14 and UI-15): new, or edit and delete when `event` is given. Matter (prefilled from the page's choice, narrowed to
 * the client), one of the eight types (icon and word), title, date, an optional time (blank = all day) and a note. It says who can see the item (everyone who can see the matter; a
 * sensitive matter says so). Field messages sit under the field and are linked to it (`aria-describedby`); a failure from the server stays in the dialog. Saved, it closes and the
 * calendar and the side panel reload.
 */
@Component({
  selector: 'mf-mm-event-dialog',
  imports: [Button, Dialog, DialogFocus, EventIcon, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="event() ? 'Edit calendar item' : 'New calendar item'"
      [modal]="true"
      [closable]="true"
      closeAriaLabel="Close dialog"
      [mfDialogFocus]="visible()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [style]="{ width: '34rem', maxWidth: '95vw' }"
    >
      <form class="f" (ngSubmit)="save()" novalidate id="mm-event-form">
        <div class="fld">
          <label for="ev-matter">Matter</label>
          <select
            id="ev-matter"
            [ngModel]="matter()"
            name="matter"
            (ngModelChange)="matter.set($event)"
            [attr.aria-invalid]="errors().matter ? true : null"
            [attr.aria-describedby]="errors().matter ? 'ev-matter-e' : null"
            [disabled]="!!event()"
          >
            <option [ngValue]="null">Choose a matter</option>
            @for (m of matterList(); track m.id) {
              <option [ngValue]="m.id">{{ m.name }}{{ m.sens ? ' (sensitive)' : '' }}</option>
            }
          </select>
          @if (errors().matter) {
            <p class="err" id="ev-matter-e" role="alert">{{ errors().matter }}</p>
          }
        </div>

        <fieldset class="fld types">
          <legend>Type</legend>
          <div class="tg">
            @for (t of types; track t.code) {
              <label class="ty" [class.on]="type() === t.code">
                <input
                  type="radio"
                  name="etype"
                  [value]="t.code"
                  [checked]="type() === t.code"
                  (change)="type.set(t.code)"
                />
                <mf-event-icon [type]="t.code" /> <span>{{ t.name }}</span>
              </label>
            }
          </div>
          @if (errors().type) {
            <p class="err" role="alert">{{ errors().type }}</p>
          }
        </fieldset>

        <div class="fld">
          <label for="ev-title">Title</label>
          <input
            id="ev-title"
            name="title"
            type="text"
            maxlength="200"
            [ngModel]="title()"
            (ngModelChange)="title.set($event)"
            [attr.aria-invalid]="errors().title ? true : null"
            [attr.aria-describedby]="errors().title ? 'ev-title-e' : null"
          />
          @if (errors().title) {
            <p class="err" id="ev-title-e" role="alert">{{ errors().title }}</p>
          }
        </div>

        <div class="row">
          <div class="fld">
            <label for="ev-date">Date</label>
            <input
              id="ev-date"
              name="date"
              type="date"
              [ngModel]="date()"
              (ngModelChange)="date.set($event)"
              [attr.aria-invalid]="errors().date ? true : null"
              [attr.aria-describedby]="errors().date ? 'ev-date-e' : null"
            />
            @if (errors().date) {
              <p class="err" id="ev-date-e" role="alert">{{ errors().date }}</p>
            }
          </div>
          <div class="fld">
            <label for="ev-time">Time (optional)</label>
            <input
              id="ev-time"
              name="time"
              type="time"
              [ngModel]="time()"
              (ngModelChange)="time.set($event)"
              [attr.aria-invalid]="errors().time ? true : null"
              [attr.aria-describedby]="errors().time ? 'ev-time-e' : 'ev-time-h'"
            />
            <p class="hint" id="ev-time-h">Leave blank for an all-day item.</p>
            @if (errors().time) {
              <p class="err" id="ev-time-e" role="alert">{{ errors().time }}</p>
            }
          </div>
        </div>

        <div class="fld">
          <label for="ev-note">Note (optional)</label>
          <textarea
            id="ev-note"
            name="note"
            rows="3"
            maxlength="2000"
            [ngModel]="note()"
            (ngModelChange)="note.set($event)"
          ></textarea>
        </div>

        <p class="vis" id="ev-vis">
          @if (sensitive()) {
            <i class="pi pi-lock" aria-hidden="true"></i>
            <span
              ><b>Sensitive matter.</b> Only people with access to this matter will see this
              item.</span
            >
          } @else {
            <i class="pi pi-eye" aria-hidden="true"></i>
            <span>Visible to people who can see this matter.</span>
          }
        </p>
        @if (errors().form) {
          <p class="err" role="alert" data-event-error>{{ errors().form }}</p>
        }
      </form>
      <ng-template #footer>
        @if (event()) {
          <p-button label="Delete" severity="danger" [outlined]="true" (onClick)="remove()" />
        }
        <p-button label="Cancel" severity="secondary" (onClick)="visible.set(false)" />
        <p-button [label]="event() ? 'Save' : 'Add item'" (onClick)="save()" [disabled]="false" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .f {
      display: grid;
      gap: var(--mf-s4);
    }
    .fld {
      display: grid;
      gap: var(--mf-s1);
      border: 0;
      padding: 0;
      margin: 0;
      min-width: 0;
    }
    legend {
      margin-bottom: var(--mf-s2);
    }
    label,
    legend {
      font-weight: 600;
      font-size: var(--mf-fs-sm);
      padding: 0;
    }
    input[type='text'],
    input[type='date'],
    input[type='time'],
    select,
    textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 36px;
      padding: var(--mf-s1) var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    input[aria-invalid='true'],
    select[aria-invalid='true'] {
      border-color: var(--mf-danger);
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--mf-s3);
    }
    .tg {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s2);
    }
    .ty {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 40px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      font-weight: 500;
      cursor: pointer;
    }
    .ty.on {
      border-color: var(--mf-primary);
      background: var(--mf-selected-bg);
      font-weight: 700;
    }
    .ty:focus-within {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .ty input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .err {
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .hint {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .vis {
      display: flex;
      gap: var(--mf-s2);
      align-items: flex-start;
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    @media (max-width: 640px) {
      .row,
      .tg {
        grid-template-columns: 1fr;
      }
      .ty {
        min-height: 44px;
      }
    }
  `,
})
export class MmEventDialog {
  private readonly api = inject(MmApi);
  private readonly notify = inject(NotificationService);

  readonly visible = model(false);
  readonly tree = input<MatterTree | null>(null);
  readonly matterId = input<number | null>(null);
  readonly clientId = input<number | null>(null);
  /** An existing item to edit (and delete). */
  readonly event = input<MatterEvent | null>(null);
  /** A date to start the new item on (the "+" of a calendar day). */
  readonly startDate = input<string | null>(null);
  readonly saved = output<MatterEvent>();
  readonly deleted = output<void>();

  protected readonly types = EVENT_TYPES;
  protected readonly matter = signal<number | null>(null);
  protected readonly type = signal<string | null>(null);
  protected readonly title = signal('');
  protected readonly date = signal('');
  protected readonly time = signal('');
  protected readonly note = signal('');
  protected readonly errors = signal<Errors>({});
  private busy = false;

  protected readonly matterList = computed(() => {
    const cid = this.clientId();
    return (this.tree()?.clients ?? [])
      .filter(
        (c) => !cid || c.clientId === cid || c.matters.some((m) => m.matterId === this.matterId()),
      )
      .flatMap((c) =>
        c.matters.map((m) => ({ id: m.matterId, name: m.name, sens: m.isSensitive })),
      );
  });
  protected readonly sensitive = computed(
    () => this.matterList().find((m) => m.id === this.matter())?.sens ?? false,
  );

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        const e = this.event();
        this.errors.set({});
        this.matter.set(e?.matterId ?? this.matterId());
        this.type.set(e?.typeCode ?? null);
        this.title.set(e?.title ?? '');
        this.date.set(e?.date ?? this.startDate() ?? '');
        this.time.set(e?.time ?? '');
        this.note.set(e?.note ?? '');
      });
    });
  }

  private validate(): Errors {
    const e: Errors = {};
    if (!this.matter()) e.matter = 'Choose a matter.';
    if (!this.type()) e.type = 'Choose a type.';
    const t = this.title().trim();
    if (!t) e.title = 'Enter a title.';
    else if (t.length > 200) e.title = 'The title can be at most 200 characters.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.date())) e.date = 'Choose a date.';
    if (this.time() && !/^\d{2}:\d{2}$/.test(this.time())) e.time = 'Enter a time such as 09:30.';
    return e;
  }

  protected save(): void {
    if (this.busy) return;
    const errors = this.validate();
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) {
      queueMicrotask(() =>
        document
          .querySelector<HTMLElement>('#mm-event-form [aria-invalid="true"], #mm-event-form .err')
          ?.focus(),
      );
      return;
    }
    const body = {
      typeCode: this.type()!,
      title: this.title().trim(),
      date: this.date(),
      time: this.time() || null,
      note: this.note().trim() || null,
    };
    const e = this.event();
    this.busy = true;
    const call = e
      ? this.api.updateEvent(e.eventId, { ...body, rowVersion: e.rowVersion })
      : this.api.createEvent(this.matter()!, body);
    call.subscribe({
      next: (saved) => {
        this.busy = false;
        this.visible.set(false);
        this.notify.success(e ? 'Calendar item saved' : 'Calendar item added');
        this.saved.emit(saved);
      },
      error: (err: unknown) => {
        this.busy = false;
        this.errors.set({ form: this.problemText(err) });
      },
    });
  }

  protected remove(): void {
    const e = this.event();
    if (!e || this.busy) return;
    this.busy = true;
    this.api.deleteEvent(e.eventId, e.rowVersion).subscribe({
      next: () => {
        this.busy = false;
        this.visible.set(false);
        this.notify.success('Calendar item deleted');
        this.deleted.emit();
      },
      error: (err: unknown) => {
        this.busy = false;
        this.errors.set({ form: this.problemText(err) });
      },
    });
  }

  private problemText(err: unknown): string {
    const code = (err as { code?: string; status?: number } | null)?.code;
    const status = (err as { status?: number } | null)?.status;
    if (code === 'NOT_MATTER_MANAGER' || status === 403)
      return 'You cannot change calendar items on this matter. Only its Primary and Secondary PM and people who may edit matters can.';
    if (code === 'CONCURRENCY_CONFLICT' || status === 409)
      return 'Someone else changed this item. Close the dialog and open it again.';
    if (code === 'MATTER_INACTIVE') return 'This matter is inactive, so it cannot get new items.';
    if (status === 404) return 'This matter or item is no longer available.';
    return 'The item could not be saved. Try again.';
  }
}
