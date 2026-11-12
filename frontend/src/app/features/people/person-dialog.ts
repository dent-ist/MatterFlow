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
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PeopleClient, PersonDto } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { NotificationService } from '../../core/notify/notification.service';
import { focusFirstInvalid } from '../../shared/forms/focus-invalid';
import { serverFormErrors } from '../../shared/forms/api-errors';
import { FormDialog } from '../../shared/ui/form-dialog';
import { PersonTypeBadge } from '../../shared/ui/person-type';
import { shortAccountName } from '../../shared/ui/person-name';
import { Segmented } from '../../shared/ui/segmented';
import { TextField } from '../../shared/ui/text-field';

/** The messages of the dialog (D-35, section 4.3 of the guidelines). */
export const PERSON_MESSAGES = {
  first: 'Enter a first name.',
  last: 'Enter a last name.',
  email: 'Enter a valid email address like name@example.com.',
  conflict: 'This person was changed by someone else. Close the dialog and open it again.',
  systemReadOnly: 'This person is a system user. Name, email and type come from the user account.',
  failed: "Couldn't save the person.",
} as const;

/** Text, an @, a domain with a dot, no spaces (the shape the API checks). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * New Person / Edit Person (epic #1373, issue #1375; mockup screen `person-new`, `person-user`): a 768 px (large, two-column) `mf-form-dialog` with First Name, Last Name, Internal or External,
 * Title or Role, Email, Company Name (External only) and Comments. A system user opens with the account's name, email and type as plain text (they follow the user; the API refuses
 * a change) and a banner that points to Administration > Users; Title or Role and Comments stay editable. Without `People.Manage` the same dialog is a read-only view
 * with one Close button.
 */
@Component({
  selector: 'mf-person-dialog',
  imports: [FormDialog, TextField, Segmented, PersonTypeBadge, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* A large dialog (768 px) is the standard two-column form (D-32, D-35): First and Last Name, Title and Email side by side. */
    .pd__form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s4);
    }
    .pd__wide {
      grid-column: 1 / -1;
    }
    .pd__seg {
      width: fit-content;
    }
    .pd__value {
      margin: 0;
      min-height: var(--mf-ctl-h);
      display: flex;
      align-items: center;
      font-size: var(--mf-fs-md);
      overflow-wrap: anywhere;
    }
    .pd__none {
      color: var(--mf-text-muted);
    }
  `,
  template: `
    <mf-form-dialog
      size="large"
      [title]="dialogTitle()"
      [subtitle]="subtitle()"
      [primaryLabel]="person() ? 'Save Changes' : 'Create Person'"
      [secondaryLabel]="canManage() ? 'Cancel' : 'Close'"
      [showPrimary]="canManage()"
      [busy]="busy()"
      [error]="error()"
      [dirty]="dirty()"
      [focusId]="!canManage() ? '' : locked() ? 'person-title' : 'person-first'"
      [(visible)]="visible"
      (submitted)="save()"
    >
      <form class="pd__form" novalidate (submit)="$event.preventDefault(); save()" data-person-form>
        @if (locked() && canManage()) {
          <p class="pg-banner pg-banner--info pd__wide" role="status" data-system-banner>
            <i class="pi pi-lock" aria-hidden="true"></i>
            <span
              >This person is a system user. Name, email and type come from the user account; change
              them in
              @if (canOpenUsers()) {
                <a class="mf-link" routerLink="/admin/users" (click)="visible.set(false)"
                  >Administration, Users</a
                >.
              } @else {
                Administration, Users.
              }
              Title or Role and Comments can be edited here.</span
            >
          </p>
        }
        @if (plain()) {
          <div class="mf-field" data-plain-field="first">
            <span class="mf-field__label">First Name</span>
            <p class="pd__value">{{ first() }}</p>
          </div>
          <div class="mf-field" data-plain-field="last">
            <span class="mf-field__label">Last Name</span>
            <p class="pd__value">{{ last() }}</p>
          </div>
          <div class="mf-field" data-plain-field="type">
            <span class="mf-field__label">Internal or External</span>
            <p class="pd__value">
              <mf-person-type-badge [person]="{ personType: type(), isSystemUser: locked() }" />
            </p>
          </div>
          @if (type() === 'EXTERNAL') {
            <div class="mf-field" data-plain-field="company">
              <span class="mf-field__label">Company</span>
              <p class="pd__value" [class.pd__none]="!company()">{{ company() || 'None' }}</p>
            </div>
          }
        } @else {
          <mf-text-field
            inputId="person-first"
            label="First Name"
            [required]="true"
            [maxLength]="100"
            [error]="firstError()"
            [(value)]="first"
          />
          <mf-text-field
            inputId="person-last"
            label="Last Name"
            [required]="true"
            [maxLength]="100"
            [error]="lastError()"
            [(value)]="last"
          />
          <div class="mf-field">
            <span class="mf-field__label" id="person-type-label">Internal or External</span>
            <div
              mfSegmented
              class="pd__seg"
              role="group"
              aria-labelledby="person-type-label"
              data-person-type
            >
              <button
                type="button"
                class="mf-btn"
                data-type="INTERNAL"
                [attr.aria-pressed]="type() === 'INTERNAL'"
                (click)="setType('INTERNAL')"
              >
                Internal
              </button>
              <button
                type="button"
                class="mf-btn"
                data-type="EXTERNAL"
                [attr.aria-pressed]="type() === 'EXTERNAL'"
                (click)="setType('EXTERNAL')"
              >
                External
              </button>
            </div>
            <span class="mf-field__help" data-type-help>{{
              type() === 'EXTERNAL'
                ? 'External: works outside the firm. Add their company.'
                : 'Internal: works at the firm. A MatterFlow login is managed on the Users page.'
            }}</span>
          </div>
          @if (type() === 'EXTERNAL') {
            <mf-text-field
              inputId="person-company"
              label="Company"
              [maxLength]="200"
              [error]="fieldError('companyName')"
              [(value)]="company"
            />
          }
        }
        @if (canManage()) {
          <mf-text-field
            inputId="person-title"
            label="Title or Role"
            [maxLength]="200"
            [error]="fieldError('title')"
            [(value)]="title"
          />
        } @else {
          <div class="mf-field" data-plain-field="title">
            <span class="mf-field__label">Title or Role</span>
            <p class="pd__value" [class.pd__none]="!title()">{{ title() || 'None' }}</p>
          </div>
        }
        @if (plain()) {
          <div class="mf-field" data-plain-field="email">
            <span class="mf-field__label">Email</span>
            <p class="pd__value" [class.pd__none]="!email()">{{ email() || 'None' }}</p>
          </div>
        } @else {
          <mf-text-field
            inputId="person-email"
            label="Email"
            type="email"
            [maxLength]="254"
            [error]="emailError()"
            (blurred)="emailTouched.set(true)"
            [(value)]="email"
          />
        }
        @if (canManage()) {
          <div class="pd__wide">
            <mf-text-field
              inputId="person-comments"
              label="Comments"
              [multiline]="true"
              [maxLength]="2000"
              [counter]="true"
              [error]="fieldError('comments')"
              [(value)]="comments"
            />
          </div>
        } @else {
          <div class="mf-field pd__wide" data-plain-field="comments">
            <span class="mf-field__label">Comments</span>
            <p class="pd__value" [class.pd__none]="!comments()">{{ comments() || 'None' }}</p>
          </div>
        }
      </form>
    </mf-form-dialog>
  `,
})
export class PersonDialog {
  /** The person to edit; null creates a new one. */
  readonly person = input<PersonDto | null>(null);
  readonly visible = model(false);
  /** The person was saved: the page reloads its rows. */
  readonly saved = output<PersonDto>();

  private readonly api = inject(PeopleClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly injector = inject(Injector);

  protected readonly first = signal('');
  protected readonly last = signal('');
  protected readonly type = signal<'INTERNAL' | 'EXTERNAL'>('EXTERNAL');
  protected readonly title = signal('');
  protected readonly email = signal('');
  protected readonly company = signal('');
  protected readonly comments = signal('');
  protected readonly emailTouched = signal(false);
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly server = signal<Record<string, string>>({});

  protected readonly canManage = computed(() => this.auth.has('People.Manage'));
  protected readonly canOpenUsers = computed(() => this.auth.has('User.View'));
  /** A system user: name, email and type are the account's. */
  protected readonly locked = computed(() => this.person()?.isSystemUser === true);
  /** Name, email, type and company are plain text: a system user, or a person seen without People.Manage. */
  protected readonly plain = computed(() => this.locked() || !this.canManage());
  protected readonly dialogTitle = computed(() =>
    !this.person() ? 'New Person' : this.canManage() ? 'Edit Person' : 'Person',
  );
  protected readonly subtitle = computed(() =>
    this.person()
      ? shortAccountName(this.person()!.displayName)
      : 'Added to the shared address book',
  );

  protected readonly firstError = computed(
    () =>
      this.server()['firstName'] ??
      (this.submitted() && this.first().trim() === '' ? PERSON_MESSAGES.first : null),
  );
  protected readonly lastError = computed(
    () =>
      this.server()['lastName'] ??
      (this.submitted() && this.last().trim() === '' ? PERSON_MESSAGES.last : null),
  );
  protected readonly emailError = computed(() => {
    const value = this.email().trim();
    return (
      this.server()['email'] ??
      ((this.emailTouched() || this.submitted()) && value !== '' && !EMAIL_SHAPE.test(value)
        ? PERSON_MESSAGES.email
        : null)
    );
  });

  protected readonly dirty = computed(() => {
    const p = this.person();
    const now = [
      this.first().trim(),
      this.last().trim(),
      this.type(),
      this.title().trim(),
      this.email().trim(),
      this.company().trim(),
      this.comments().trim(),
    ];
    const was = p
      ? [
          p.firstName,
          p.lastName,
          p.personType,
          p.title ?? '',
          p.email ?? '',
          p.companyName ?? '',
          p.comments ?? '',
        ]
      : ['', '', 'EXTERNAL', '', '', '', ''];
    return now.some((v, i) => v !== was[i]);
  });

  constructor() {
    // Each opening starts from the person (or empty).
    effect(() => {
      if (!this.visible()) return;
      const p = this.person();
      untracked(() => {
        this.first.set(p?.firstName ?? '');
        this.last.set(p?.lastName ?? '');
        this.type.set(p ? (p.personType === 'INTERNAL' ? 'INTERNAL' : 'EXTERNAL') : 'EXTERNAL');
        this.title.set(p?.title ?? '');
        this.email.set(p?.email ?? '');
        this.company.set(p?.companyName ?? '');
        this.comments.set(p?.comments ?? '');
        this.emailTouched.set(false);
        this.submitted.set(false);
        this.server.set({});
        this.error.set('');
      });
    });
    // A typed change drops the server's answer for that field.
    effect(() => {
      this.first();
      this.last();
      this.email();
      untracked(() => this.server.set({}));
    });
  }

  protected setType(type: 'INTERNAL' | 'EXTERNAL'): void {
    this.type.set(type);
    if (type === 'INTERNAL') this.company.set('');
  }

  protected fieldError(name: string): string | null {
    return this.server()[name] ?? null;
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.canManage()) return;
    this.submitted.set(true);
    if (!this.plain() && (this.firstError() || this.lastError() || this.emailError())) {
      focusFirstInvalid(this.injector);
      return;
    }
    const body = {
      firstName: this.first().trim(),
      lastName: this.last().trim(),
      personType: this.type(),
      title: this.title().trim() || undefined,
      email: this.email().trim() || undefined,
      comments: this.comments().trim() || undefined,
      companyName: this.type() === 'EXTERNAL' ? this.company().trim() || undefined : undefined,
    };
    const current = this.person();
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = current
        ? await firstValueFrom(
            this.api.updatePerson(current.personId, {
              ...body,
              isActive: current.isActive,
              rowVersion: current.rowVersion,
            }),
          )
        : await firstValueFrom(this.api.createPerson(body));
      this.notify.success(
        current ? 'Person updated' : 'Person created',
        current ? `${saved.displayName}.` : `${saved.displayName} is in People.`,
      );
      this.visible.set(false);
      this.saved.emit(saved);
    } catch (err) {
      const failure = serverFormErrors(err);
      this.server.set(failure.fields);
      if (Object.keys(failure.fields).length > 0) {
        focusFirstInvalid(this.injector);
      } else if (failure.conflict) {
        this.error.set(PERSON_MESSAGES.conflict);
      } else if (failure.code === 'SYSTEM_PERSON_READ_ONLY') {
        this.error.set(PERSON_MESSAGES.systemReadOnly);
      } else {
        this.error.set(`${PERSON_MESSAGES.failed} ${(err as Error)?.message ?? ''}`.trim());
      }
    } finally {
      this.busy.set(false);
    }
  }
}
