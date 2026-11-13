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
import { Button } from 'primeng/button';
import { DateInput } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import {
  PersonLookupItem,
  VendorContactResponse,
  VendorsClient,
} from '../../api/generated/api-client';
import { NotificationService } from '../../core/notify/notification.service';
import { serverFormErrors } from '../../shared/forms/api-errors';
import { NumericDatePipe } from '../../shared/ui/numeric-date';
import { PersonPicker } from '../../shared/ui/person-picker';
import { Segmented } from '../../shared/ui/segmented';
import { StateBlock } from '../../shared/ui/state-block';
import { TextField } from '../../shared/ui/text-field';
import { Tip } from '../../shared/ui/tip';
import { CONTACT_FLAGS, ContactFlag } from './vendor-badges';

type LoadState = 'loading' | 'ready' | 'error';

/** The words of the Contacts tab (D-20, section 4.3). */
export const CONTACT_MESSAGES = {
  date: 'Enter the date this was reported.',
  future: 'The date cannot be in the future.',
  note: 'Write the note.',
  failed: "Couldn't save the contact.",
  conflict: 'This contact was changed by someone else. The list was reloaded; try again.',
  choose: 'Choose a person from the list.',
  readers: 'Everyone who can view vendors can read this note.',
} as const;

/** Today as `yyyy-MM-dd` in the browser's calendar (the API refuses a date after tomorrow in UTC, so a local today is always accepted). */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The Contacts tab of the vendor pop-up (epic #1373, issue #1378; mockup `vendor-note`): the people at the vendor, each with a flag (No note, Recommended, Do Not Hire), the date it was reported, who
 * reported it and the note. Everything happens inside the tab, nothing opens another dialog (D-31): "Edit Note" or "Add Note" opens a form inside the contact's row (flag, Reported Date, Note,
 * Cancel and Save Note), "Add Contact" opens a panel at the top with the person combobox (`mf-person-picker`: a new person can be created there too), "Remove" asks inside the row. Reading needs
 * `Vendor.View`; adding, noting and removing need `Vendor.Manage` (`canManage`). The reporter is the person who saves a new or changed flag (the server sets it), so it is shown, not typed.
 */
@Component({
  selector: 'mf-vendor-contacts-tab',
  imports: [
    Button,
    DateInput,
    PersonPicker,
    Segmented,
    StateBlock,
    TextField,
    Tip,
    ContactFlag,
    NumericDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .vc__head {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s3);
    }
    .vc__title {
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: var(--mf-fw-semibold);
    }
    .vc__spring {
      flex: 1 1 auto;
    }
    .vc__panel {
      display: grid;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface-alt);
    }
    .vc__panel-title {
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: var(--mf-fw-semibold);
    }
    .vc__actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--mf-s2);
    }
    .vc__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .vc__row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
      padding: var(--mf-s3) 0;
      border-bottom: 1px solid var(--mf-border-soft);
    }
    .vc__row:last-child {
      border-bottom: 0;
    }
    .vc__who {
      min-width: 0;
    }
    .vc__name {
      font-weight: var(--mf-fw-semibold);
      overflow-wrap: anywhere;
    }
    .vc__sub {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      overflow-wrap: anywhere;
    }
    .vc__side {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .vc__note {
      grid-column: 1 / -1;
      padding: var(--mf-s2) var(--mf-s3);
      border-left: 3px solid var(--mf-border-mid);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface-alt);
    }
    .vc__note--bad {
      border-left-color: var(--mf-danger);
    }
    .vc__note--ok {
      border-left-color: var(--mf-sem-success-solid);
    }
    .vc__note-head {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .vc__note-body {
      margin: var(--mf-s1) 0 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .vc__form {
      grid-column: 1 / -1;
      display: grid;
      gap: var(--mf-s3);
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface-alt);
    }
    .vc__fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s3);
    }
    .vc__wide {
      grid-column: 1 / -1;
    }
    .vc__seg {
      width: fit-content;
    }
    .vc__plain {
      margin: 0;
      min-height: var(--mf-ctl-h);
      display: flex;
      align-items: center;
    }
    .vc__ask {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-sem-risk-solid);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-sem-risk-bg);
      color: var(--mf-sem-risk-fg);
    }
    .vc__error {
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .vc__ro {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <div class="vc__head">
      <h3 class="vc__title">Contacts</h3>
      @if (state() === 'ready') {
        <span class="vc__count" data-contact-count>{{ contacts().length }}</span>
      }
      <span class="vc__spring"></span>
      @if (canManage() && !adding()) {
        <p-button
          label="Add Contact"
          icon="pi pi-user-plus"
          severity="secondary"
          data-add-contact
          (onClick)="startAdd()"
        />
      }
    </div>
    @if (!canManage()) {
      <p class="vc__ro" data-contacts-readonly>{{ readers }}</p>
    }

    @if (adding()) {
      <section class="vc__panel" data-add-contact-panel aria-label="Add Contact">
        <h4 class="vc__panel-title">Add Contact</h4>
        <mf-person-picker
          inputId="vendor-contact-person"
          label="Person"
          placeholder="Search People by name, email or company"
          help="Pick a person from People, or create a new one."
          [taken]="takenIds()"
          [error]="addError()"
          [(selected)]="picked"
          (draftChange)="addDraft.set($event)"
        />
        <div class="vc__actions">
          <p-button label="Cancel" severity="secondary" data-add-cancel (onClick)="stopAdd()" />
          <p-button
            label="Add Contact"
            data-add-confirm
            [attr.aria-disabled]="picked() ? null : 'true'"
            (onClick)="confirmAdd()"
          />
        </div>
      </section>
    }

    @switch (state()) {
      @case ('loading') {
        <p class="vc__sub" role="status" data-contacts-loading>Loading contacts...</p>
      }
      @case ('error') {
        <mf-state-block kind="error"
          >Couldn't load the contacts.
          <p-button mfStateAction label="Retry" severity="secondary" (onClick)="load()"
        /></mf-state-block>
      }
      @default {
        @if (contacts().length === 0) {
          <mf-state-block icon="pi-users" data-contacts-empty
            >No contacts yet.
            <span mfStateReason>{{
              canManage()
                ? 'Add the people at this vendor you deal with. Pick them from People, or add a new person on the way.'
                : 'Nobody is recorded as a contact of this vendor.'
            }}</span>
          </mf-state-block>
        } @else {
          <ul class="vc__list" aria-label="Contacts" data-contact-list>
            @for (c of contacts(); track c.contactId) {
              <li
                class="vc__row"
                [attr.data-contact]="c.contactId"
                [attr.data-person]="c.personName"
              >
                <div class="vc__who">
                  <div class="vc__name">
                    {{ c.personName }}
                    @if (!c.personIsActive) {
                      <span class="vc__sub">(inactive in People)</span>
                    }
                  </div>
                  <div class="vc__sub">{{ subline(c) }}</div>
                </div>
                <div class="vc__side">
                  <mf-contact-flag [flag]="c.flag" />
                  @if (canManage() && editingId() !== c.contactId) {
                    <button
                      type="button"
                      class="mf-btn mf-btn--text"
                      data-edit-note
                      [attr.aria-expanded]="false"
                      [attr.aria-label]="
                        (c.flag === 'NONE' ? 'Add Note for ' : 'Edit Note for ') + c.personName
                      "
                      (click)="startNote(c)"
                    >
                      {{ c.flag === 'NONE' ? 'Add Note' : 'Edit Note' }}
                    </button>
                    <button
                      type="button"
                      class="mf-btn mf-btn--text mf-btn--icon"
                      data-remove-contact
                      [attr.aria-label]="'Remove ' + c.personName"
                      [mfTip]="'Remove ' + c.personName"
                      (click)="removing.set(c.contactId)"
                    >
                      <i class="pi pi-trash" aria-hidden="true"></i>
                    </button>
                  }
                </div>
                @if (removing() === c.contactId) {
                  <div
                    class="vc__ask"
                    role="alertdialog"
                    [attr.aria-label]="'Remove ' + c.personName"
                    data-remove-ask
                  >
                    <span
                      >Remove {{ c.personName }} from this vendor? The person stays in People.</span
                    >
                    <span class="vc__actions">
                      <p-button
                        label="Keep Contact"
                        severity="secondary"
                        data-remove-keep
                        (onClick)="removing.set(null)"
                      />
                      <p-button
                        label="Remove Contact"
                        severity="danger"
                        data-remove-confirm
                        (onClick)="remove(c)"
                      />
                    </span>
                  </div>
                }
                @if (c.flag !== 'NONE' && editingId() !== c.contactId) {
                  <div
                    class="vc__note"
                    [class.vc__note--bad]="c.flag === 'DO_NOT_HIRE'"
                    [class.vc__note--ok]="c.flag === 'RECOMMENDED'"
                    data-contact-note
                  >
                    <div class="vc__note-head">
                      Reported {{ c.reportedOn | mfNum: 'date' }}
                      @if (c.reportedByName) {
                        by {{ c.reportedByName }}
                      }
                    </div>
                    @if (c.note) {
                      <p class="vc__note-body">{{ c.note }}</p>
                    }
                  </div>
                }
                @if (editingId() === c.contactId) {
                  <form
                    class="vc__form"
                    novalidate
                    (submit)="$event.preventDefault(); saveNote(c)"
                    data-note-form
                  >
                    <h4 class="vc__panel-title">
                      Contact Note <span class="vc__sub">{{ c.personName }}</span>
                    </h4>
                    <div class="vc__fields">
                      <div class="mf-field vc__wide">
                        <span class="mf-field__label" id="note-flag-label">Note Flag</span>
                        <div
                          mfSegmented
                          class="vc__seg"
                          role="group"
                          aria-labelledby="note-flag-label"
                          data-note-flag
                        >
                          @for (f of flags; track f.value) {
                            <button
                              type="button"
                              class="mf-btn"
                              [attr.data-flag]="f.value"
                              [attr.aria-pressed]="flag() === f.value"
                              (click)="flag.set(f.value)"
                            >
                              @if (f.icon) {
                                <i class="pi" [class]="f.icon" aria-hidden="true"></i>
                              }
                              {{ f.label }}
                            </button>
                          }
                        </div>
                      </div>
                      @if (flag() !== 'NONE') {
                        <div class="mf-field">
                          <label class="mf-field__label" for="note-date"
                            >Reported Date <span class="mf-field__req">(required)</span></label
                          >
                          <mf-date-input
                            inputId="note-date"
                            label="Reported Date"
                            [showHint]="false"
                            [isoValue]="date()"
                            [invalid]="!!dateError()"
                            (isoChange)="date.set($event ?? '')"
                          />
                          @if (dateError(); as e) {
                            <p class="mf-field__error" role="alert" data-note-date-error>{{ e }}</p>
                          }
                        </div>
                        <div class="mf-field">
                          <span class="mf-field__label">Reported by</span>
                          <p class="vc__plain" data-reported-by>{{ reporter(c) }}</p>
                        </div>
                        <div class="vc__wide">
                          <mf-text-field
                            inputId="note-text"
                            label="Note"
                            [required]="true"
                            [multiline]="true"
                            [maxLength]="2000"
                            [counter]="true"
                            help="Everyone who can view vendors can read this."
                            [error]="noteError()"
                            [(value)]="note"
                          />
                        </div>
                      }
                    </div>
                    @if (formError()) {
                      <p class="vc__error" role="alert" data-note-error>{{ formError() }}</p>
                    }
                    <div class="vc__actions">
                      <p-button
                        label="Cancel"
                        severity="secondary"
                        data-note-cancel
                        (onClick)="stopNote()"
                      />
                      <p-button
                        [label]="busy() ? 'Saving...' : 'Save Note'"
                        data-note-save
                        [attr.aria-disabled]="busy() ? 'true' : null"
                        (onClick)="saveNote(c)"
                      />
                    </div>
                  </form>
                }
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class VendorContactsTab {
  readonly vendorId = input.required<number>();
  readonly canManage = input(false);
  /** The number of contacts changed (loaded, added or removed): the dialog's tab shows it. */
  readonly countChange = output<number>();
  /** A contact was added, changed or removed: the Vendors list reloads its counts and Do Not Hire flags. */
  readonly changed = output<void>();

  private readonly api = inject(VendorsClient);
  private readonly notify = inject(NotificationService);

  protected readonly readers = CONTACT_MESSAGES.readers;
  protected readonly flags = CONTACT_FLAGS;
  protected readonly state = signal<LoadState>('loading');
  protected readonly contacts = signal<VendorContactResponse[]>([]);
  protected readonly takenIds = computed(() => this.contacts().map((c) => c.personId));

  // Add Contact
  protected readonly adding = signal(false);
  protected readonly picked = signal<PersonLookupItem | null>(null);
  protected readonly addDraft = signal('');
  protected readonly addError = signal<string | null>(null);

  // Note form (one contact at a time)
  protected readonly editingId = signal<number | null>(null);
  protected readonly flag = signal('NONE');
  protected readonly date = signal('');
  protected readonly note = signal('');
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly formError = signal('');
  protected readonly serverFields = signal<Record<string, string>>({});
  protected readonly removing = signal<number | null>(null);

  protected readonly dateError = computed(() => {
    if (this.flag() === 'NONE') return null;
    const server = this.serverFields()['reportedOn'];
    if (server) return server;
    if (!this.submitted()) return null;
    if (!this.date()) return CONTACT_MESSAGES.date;
    return this.date() > today() ? CONTACT_MESSAGES.future : null;
  });
  protected readonly noteError = computed(() => {
    if (this.flag() === 'NONE') return null;
    const server = this.serverFields()['note'];
    if (server) return server;
    return this.submitted() && this.note().trim() === '' ? CONTACT_MESSAGES.note : null;
  });

  constructor() {
    effect(() => {
      this.vendorId();
      untracked(() => void this.load());
    });
  }

  protected subline(c: VendorContactResponse): string {
    return [c.personTitle, c.personCompany, c.personEmail].filter(Boolean).join(' · ');
  }

  protected reporter(c: VendorContactResponse): string {
    return this.flag() === c.flag && c.reportedByName
      ? c.reportedByName
      : 'You (set when you save)';
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const rows = await firstValueFrom(this.api.listVendorContacts(this.vendorId()));
      this.contacts.set(rows);
      this.state.set('ready');
      this.countChange.emit(rows.length);
    } catch {
      this.state.set('error');
    }
  }

  // ---- Add Contact

  protected startAdd(): void {
    this.picked.set(null);
    this.addDraft.set('');
    this.addError.set(null);
    this.adding.set(true);
  }

  protected stopAdd(): void {
    this.adding.set(false);
    this.picked.set(null);
  }

  protected async confirmAdd(): Promise<void> {
    const person = this.picked();
    if (!person) {
      this.addError.set(CONTACT_MESSAGES.choose);
      return;
    }
    this.addError.set(null);
    try {
      await firstValueFrom(
        this.api.createVendorContact(this.vendorId(), { personId: person.personId }),
      );
      this.notify.success('Contact added', `${person.displayName} is a contact of this vendor.`);
      this.stopAdd();
      await this.load();
      this.changed.emit();
    } catch (err) {
      const f = serverFormErrors(err);
      this.addError.set(
        f.fields['personId'] ??
          `${CONTACT_MESSAGES.failed} ${(err as Error)?.message ?? ''}`.trim(),
      );
    }
  }

  // ---- the note form

  protected startNote(c: VendorContactResponse): void {
    this.editingId.set(c.contactId);
    this.flag.set(c.flag);
    this.date.set(c.reportedOn ?? today());
    this.note.set(c.note ?? '');
    this.submitted.set(false);
    this.formError.set('');
    this.serverFields.set({});
    this.removing.set(null);
  }

  protected stopNote(): void {
    this.editingId.set(null);
    this.formError.set('');
  }

  protected async saveNote(c: VendorContactResponse): Promise<void> {
    if (this.busy()) return;
    this.submitted.set(true);
    this.serverFields.set({});
    if (this.flag() !== 'NONE' && (this.dateError() || this.noteError())) return;
    this.busy.set(true);
    this.formError.set('');
    try {
      const flagged = this.flag() !== 'NONE';
      const saved = await firstValueFrom(
        this.api.updateVendorContact(this.vendorId(), c.contactId, {
          flag: this.flag(),
          reportedOn: flagged ? this.date() : undefined,
          note: flagged ? this.note().trim() || undefined : undefined,
          rowVersion: c.rowVersion,
        }),
      );
      this.contacts.update((l) => l.map((x) => (x.contactId === saved.contactId ? saved : x)));
      this.notify.success('Note saved', `${c.personName}.`);
      this.stopNote();
      this.changed.emit();
    } catch (err) {
      const f = serverFormErrors(err);
      this.serverFields.set(f.fields);
      if (f.conflict) {
        this.formError.set(CONTACT_MESSAGES.conflict);
        this.stopNote();
        await this.load();
      } else if (Object.keys(f.fields).length === 0) {
        this.formError.set(`${CONTACT_MESSAGES.failed} ${(err as Error)?.message ?? ''}`.trim());
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(c: VendorContactResponse): Promise<void> {
    try {
      await firstValueFrom(this.api.deleteVendorContact(this.vendorId(), c.contactId));
      this.removing.set(null);
      this.notify.success('Contact removed', `${c.personName} stays in People.`);
      await this.load();
      this.changed.emit();
    } catch (err) {
      this.removing.set(null);
      this.notify.error(`Couldn't remove ${c.personName}.`, (err as Error)?.message);
    }
  }
}
