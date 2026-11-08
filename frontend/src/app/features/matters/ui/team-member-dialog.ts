import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  MatterListItemView,
  MatterTeamClient,
  MatterTeamMemberResponse,
  TeamTitlesClient,
  UsersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { NotificationService } from '../../../core/notify/notification.service';
import { focusFirstInvalid } from '../../../shared/forms/focus-invalid';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { EntityPicker, PickerOption } from '../../../shared/ui/entity-picker';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { TextField } from '../../../shared/ui/text-field';

/** The messages of the dialog, as the UI spec words them (4.3). */
export const TEAM_MESSAGES = {
  name: 'Enter a name.',
  emailEmpty: 'Enter an email address.',
  emailInvalid: 'Enter a valid email address.',
  emailDuplicate: 'This email is already on the team.',
  title: 'Choose a title.',
} as const;

const NAME_MAX = 200;
const EMAIL_MAX = 254;
/** Text, an @, a domain with a dot, no spaces. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** The email error of a value, or null; `taken` are the addresses of the OTHER rows (letter case ignored). */
export function emailProblem(value: string, taken: readonly string[]): string | null {
  const email = value.trim();
  if (email === '') return TEAM_MESSAGES.emailEmpty;
  if (!EMAIL_SHAPE.test(email) || email.includes('..')) return TEAM_MESSAGES.emailInvalid;
  return taken.some((t) => t.trim().toLowerCase() === email.toLowerCase())
    ? TEAM_MESSAGES.emailDuplicate
    : null;
}

/** The choices of the Title dropdown: the active titles in the administrator's order; the member's own title stays, as "Name (inactive)", only while it is the selected entry. */
export function titleItems(
  list: readonly MatterListItemView[],
  current: { id: number; name: string; isActive: boolean } | null,
  selected: string,
): DropdownItem[] {
  const items = list
    .filter((t) => t.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => ({ value: String(t.id), label: t.name }));
  if (current && selected === String(current.id) && !items.some((i) => i.value === selected)) {
    items.unshift({
      value: selected,
      label: current.isActive ? current.name : `${current.name} (inactive)`,
    });
  }
  return items;
}

/**
 * Add / Edit Team Member (epic #1298, UI spec 4.3): a `mf-form-dialog` with the optional "Fill from a User" search (it fills Name and Email only and clears itself: nothing about
 * the user is stored with the member), Name, Email and Title. The team members are typed-in contacts, not accounts. The same email cannot be on one matter twice (checked here
 * against the loaded rows, and again by the API: 409 `DUPLICATE_TEAM_EMAIL`).
 */
@Component({
  selector: 'mf-team-member-dialog',
  imports: [FormDialog, TextField, Dropdown, EntityPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .tmd__form {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
    }
    .tmd__note {
      margin: calc(-1 * var(--mf-s2)) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <mf-form-dialog
      [title]="member() ? 'Edit Team Member' : 'Add Team Member'"
      [subtitle]="matterRef()"
      [primaryLabel]="member() ? 'Save Changes' : 'Add Member'"
      [busy]="busy()"
      [error]="error()"
      [dirty]="dirty()"
      [canSubmit]="noTitles() === false"
      [(visible)]="visible"
      (submitted)="save()"
    >
      <form class="tmd__form" novalidate (submit)="$event.preventDefault(); save()">
        @if (canPick()) {
          <div>
            <mf-entity-picker
              inputId="member-pick"
              label="Fill from a User"
              placeholder="Search users by name"
              help="Optional. Fills Name and Email from a user. You can still change them."
              [search]="searchUsers"
              (selectedChange)="picked($event)"
            />
            @if (pickNote()) {
              <p class="tmd__note" data-pick-note role="status">{{ pickNote() }}</p>
            }
          </div>
        }
        <mf-text-field
          inputId="member-name"
          label="Name"
          [required]="true"
          [maxLength]="nameMax"
          [counter]="true"
          [error]="nameError()"
          (blurred)="nameTouched.set(true)"
          [(value)]="name"
        />
        <mf-text-field
          inputId="member-email"
          label="Email"
          type="email"
          [required]="true"
          [maxLength]="emailMax"
          [counter]="true"
          [error]="emailError()"
          (blurred)="emailTouched.set(true)"
          [(value)]="email"
        />
        <div class="mf-field">
          <label class="mf-field__label" for="member-title"
            >Title <span class="mf-field__req">(required)</span></label
          >
          <mf-dropdown
            field
            buttonId="member-title"
            label="Title"
            placeholder="Choose a title"
            data-member-title
            [items]="titles()"
            [search]="titles().length > 10"
            [disabled]="noTitles()"
            [invalid]="!!titleError()"
            [value]="titleId()"
            (valueChange)="titleId.set($any($event)); titleTouched.set(true)"
          />
          @if (noTitles()) {
            <span class="mf-field__help" data-no-titles
              >No team titles yet. An administrator adds them under Administration > Matter
              Lists.</span
            >
          }
          @if (titleError(); as e) {
            <p class="mf-field__error" role="alert" id="member-title-error">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
            </p>
          }
        </div>
      </form>
    </mf-form-dialog>
  `,
})
export class TeamMemberDialog {
  readonly matterId = input.required<number>();
  /** The CM Number, the dialog's subtitle (as Edit Matter does). */
  readonly matterRef = input('');
  /** The member to edit; null adds a new one. */
  readonly member = input<MatterTeamMemberResponse | null>(null);
  /** The emails of the OTHER rows (not the member being edited), for the duplicate message: the rows on screen; the API checks the whole team. */
  readonly takenEmails = input<readonly string[]>([]);
  readonly visible = model(false);
  /** The member was saved: the page reloads its rows and its count. */
  readonly saved = output<MatterTeamMemberResponse>();

  private readonly team = inject(MatterTeamClient);
  private readonly titlesApi = inject(TeamTitlesClient);
  private readonly usersApi = inject(UsersClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly quiet = inject(QuietRequests);
  private readonly injector = inject(Injector);
  private readonly picker = viewChild(EntityPicker);

  protected readonly nameMax = NAME_MAX;
  protected readonly emailMax = EMAIL_MAX;
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly titleId = signal('');
  protected readonly nameTouched = signal(false);
  protected readonly emailTouched = signal(false);
  protected readonly titleTouched = signal(false);
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly pickNote = signal('');
  private readonly serverEmail = signal('');
  private readonly titleList = signal<readonly MatterListItemView[] | null>(null);

  /**
   * The Fill from a User search needs a lookup that returns the email: that is the Users list (`User.View`). The shorter user lookups answer a name only, so people without
   * `User.View` get the plain form (UI spec 4.3: "otherwise it is not rendered").
   */
  protected readonly canPick = computed(() => this.auth.has('User.View'));
  protected readonly titles = computed(() =>
    titleItems(this.titleList() ?? [], this.member()?.title ?? null, this.titleId()),
  );
  /** No title can be chosen: the list is empty or all inactive (and the member being edited has none to keep). */
  protected readonly noTitles = computed(
    () => this.titleList() !== null && this.titles().length === 0,
  );
  protected readonly nameError = computed(() =>
    (this.nameTouched() || this.submitted()) && this.name().trim() === ''
      ? TEAM_MESSAGES.name
      : null,
  );
  protected readonly emailError = computed(
    () =>
      this.serverEmail() ||
      (this.emailTouched() || this.submitted()
        ? emailProblem(this.email(), this.takenEmails())
        : null),
  );
  protected readonly titleError = computed(() =>
    (this.titleTouched() || this.submitted()) && this.titleId() === '' && !this.noTitles()
      ? TEAM_MESSAGES.title
      : null,
  );
  protected readonly dirty = computed(() => {
    const m = this.member();
    return m
      ? this.name().trim() !== m.name ||
          this.email().trim() !== m.email ||
          this.titleId() !== String(m.title.id)
      : this.name().trim() !== '' || this.email().trim() !== '' || this.titleId() !== '';
  });

  protected readonly searchUsers = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.quiet.run(() =>
        this.usersApi.listUsers(
          'active',
          query,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          1,
          8,
          'name',
          undefined,
        ),
      ),
    );
    this.found = new Map(page.items.map((u) => [u.userId, u.email ?? '']));
    return page.items.map((u) => ({ id: u.userId, label: u.displayName }));
  };
  private found = new Map<number, string>();

  constructor() {
    // Each opening starts from the member (or empty); the titles are read again (an administrator may have changed them).
    effect(() => {
      if (!this.visible()) return;
      const m = this.member();
      untracked(() => {
        this.name.set(m?.name ?? '');
        this.email.set(m?.email ?? '');
        this.titleId.set(m ? String(m.title.id) : '');
        this.nameTouched.set(false);
        this.emailTouched.set(false);
        this.titleTouched.set(false);
        this.submitted.set(false);
        this.serverEmail.set('');
        this.error.set('');
        this.pickNote.set('');
        void this.loadTitles();
      });
    });
    // A typed change of the email drops the server's duplicate answer.
    effect(() => {
      this.email();
      untracked(() => this.serverEmail.set(''));
    });
  }

  private async loadTitles(): Promise<void> {
    try {
      this.titleList.set(
        await firstValueFrom(this.quiet.run(() => this.titlesApi.listTeamTitles())),
      );
    } catch {
      this.titleList.set([]);
    }
  }

  /** A user was chosen: Name (the display name) and Email are filled, then the picker clears so it never looks like a link. */
  protected picked(option: PickerOption | null): void {
    if (!option) return;
    const email = this.found.get(option.id) ?? '';
    this.name.set(option.label);
    this.email.set(email);
    this.nameTouched.set(false);
    this.emailTouched.set(false);
    this.pickNote.set(
      email ? `Filled from ${option.label}.` : `${option.label} has no email on file. Enter one.`,
    );
    this.picker()?.selected.set(null);
  }

  protected async save(): Promise<void> {
    if (this.busy() || this.noTitles()) return;
    this.submitted.set(true);
    if (this.nameError() || this.emailError() || this.titleError()) {
      focusFirstInvalid(this.injector);
      return;
    }
    const body = {
      name: this.name().trim(),
      email: this.email().trim(),
      teamTitleId: Number(this.titleId()),
    };
    const current = this.member();
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = current
        ? await firstValueFrom(
            this.team.updateMatterTeamMember(this.matterId(), current.id, {
              ...body,
              rowVersion: current.rowVersion,
            }),
          )
        : await firstValueFrom(this.team.addMatterTeamMember(this.matterId(), body));
      this.notify.success(
        current ? 'Team member updated' : 'Team member added',
        current ? `${saved.name}.` : `${saved.name} is on the team.`,
      );
      this.visible.set(false);
      this.saved.emit(saved);
    } catch (err) {
      this.showFailure(err);
    } finally {
      this.busy.set(false);
    }
  }

  private showFailure(err: unknown): void {
    if (err instanceof ApiError) {
      if (err.code === 'DUPLICATE_TEAM_EMAIL') {
        this.serverEmail.set(TEAM_MESSAGES.emailDuplicate);
        focusFirstInvalid(this.injector);
        return;
      }
      if (err.code === 'INVALID_EMAIL') {
        this.serverEmail.set(TEAM_MESSAGES.emailInvalid);
        focusFirstInvalid(this.injector);
        return;
      }
      const reason =
        err.code === 'CONCURRENCY_CONFLICT'
          ? 'This team member was changed by someone else. Close the dialog and reopen it.'
          : err.message;
      this.error.set(`Couldn't save the team member. ${reason}`.trim());
      return;
    }
    this.error.set("Couldn't save the team member.");
  }
}
