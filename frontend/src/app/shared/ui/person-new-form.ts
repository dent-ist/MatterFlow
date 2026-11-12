import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  PeopleClient,
  PersonDto,
  PersonLookupItem,
  PersonSimilarItem,
} from '../../api/generated/api-client';
import { serverFormErrors } from '../forms/api-errors';
import { QuietRequests } from '../../core/http/interceptors';
import { Segmented } from './segmented';
import { TextField } from './text-field';
import { PersonTypeBadge } from './person-type';

/** Words of the form (D-20, D-35): one place so the specs and the picker agree. */
export const PERSON_FORM_MESSAGES = {
  first: 'Enter a first name.',
  last: 'Enter a last name.',
  email: 'Enter a valid email address like name@example.com.',
  failed: "Couldn't create the person.",
} as const;

/** Text, an @, a domain with a dot, no spaces (the same shape the API checks). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** "Laura Whitfeld" becomes first "Laura", last "Whitfeld"; one word is a first name; more words: the last word is the last name. */
export function splitName(text: string): { first: string; last: string } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { first: words[0] ?? '', last: '' };
  return { first: words.slice(0, -1).join(' '), last: words[words.length - 1] };
}

/**
 * The inline "New Person" form of the person picker (`mf-person-picker`; epic #1373, issue #1375): first and last name, Internal or External, email, company (External only)
 * and title or role. It saves through `POST /api/v1/people` (needs `People.Manage`; the picker only offers it then) and emits the created person. While the name or email is typed it
 * asks `GET /api/v1/people/similar` and shows "Did you mean this person?" so the same person is not typed twice; "Use This Person" emits the existing one instead.
 * It is a form inside the dialog that holds the picker, never a second dialog (D-31). Two columns from 640 px of width (a large dialog), else one (D-35).
 */
@Component({
  selector: 'mf-person-new-form',
  imports: [TextField, Segmented, PersonTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }
    .pn {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
      padding: var(--mf-s4);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface-alt);
    }
    .pn__title {
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: var(--mf-fw-bold);
    }
    .pn__sub {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .pn__grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s4);
    }
    @container (min-width: 640px) {
      .pn__grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .pn__similar {
      margin: 0;
      padding: var(--mf-s3);
      border: 1px solid var(--mf-sem-info-line);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
    }
    .pn__similar-head {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
      font-weight: var(--mf-fw-bold);
    }
    .pn__similar ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .pn__similar li {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-ctl-h);
    }
    .pn__who {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .pn__who b {
      font-weight: var(--mf-fw-semibold);
    }
    .pn__who span {
      font-size: var(--mf-fs-sm);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pn__foot {
      display: flex;
      justify-content: flex-end;
      gap: var(--mf-s2);
    }
    .pn__error {
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <section class="pn" [attr.aria-labelledby]="prefix() + '-title'" data-person-new>
      <div>
        <h3 class="pn__title" [id]="prefix() + '-title'">New Person</h3>
        <p class="pn__sub">Saved to People and selected here.</p>
      </div>
      @if (similar().length > 0) {
        <div class="pn__similar" role="status" data-similar>
          <p class="pn__similar-head">Did you mean this person?</p>
          <ul>
            @for (s of similar(); track s.person.personId) {
              <li data-similar-item>
                <span class="pn__who"
                  ><b>{{ s.person.displayName }}</b
                  ><span>{{ meta(s.person) }}</span></span
                >
                <mf-person-type-badge [person]="s.person" />
                @if (s.isActive) {
                  <button
                    type="button"
                    class="mf-btn mf-btn--text"
                    data-use-similar
                    [attr.aria-label]="'Use ' + s.person.displayName"
                    (click)="useExisting.emit(s.person)"
                  >
                    Use This Person
                  </button>
                } @else {
                  <span data-similar-inactive>Inactive</span>
                }
              </li>
            }
          </ul>
        </div>
      }
      <form class="pn__grid" novalidate (submit)="$event.preventDefault(); save()">
        <mf-text-field
          [inputId]="prefix() + '-first'"
          label="First Name"
          [required]="true"
          [maxLength]="100"
          [error]="firstError()"
          (blurred)="touch('first')"
          [(value)]="first"
        />
        <mf-text-field
          [inputId]="prefix() + '-last'"
          label="Last Name"
          [required]="true"
          [maxLength]="100"
          [error]="lastError()"
          (blurred)="touch('last')"
          [(value)]="last"
        />
        <div class="mf-field">
          <span class="mf-field__label" [id]="prefix() + '-type-label'">Internal or External</span>
          <div
            mfSegmented
            role="group"
            [attr.aria-labelledby]="prefix() + '-type-label'"
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
        </div>
        @if (type() === 'EXTERNAL') {
          <mf-text-field
            [inputId]="prefix() + '-company'"
            label="Company Name"
            [maxLength]="200"
            [error]="serverFields()['companyName'] || null"
            [(value)]="company"
          />
        }
        <mf-text-field
          [inputId]="prefix() + '-email'"
          label="Email"
          type="email"
          [maxLength]="254"
          [error]="emailError()"
          (blurred)="touch('email')"
          [(value)]="email"
        />
        <mf-text-field
          [inputId]="prefix() + '-title-role'"
          label="Title or Role"
          [maxLength]="200"
          [error]="serverFields()['title'] || null"
          [(value)]="title"
        />
      </form>
      @if (error()) {
        <p class="pn__error" role="alert" data-person-new-error>{{ error() }}</p>
      }
      <div class="pn__foot">
        <button type="button" class="mf-btn" data-person-new-cancel (click)="cancelled.emit()">
          Cancel
        </button>
        <button
          type="button"
          class="mf-btn mf-btn--primary"
          data-person-new-save
          [disabled]="busy()"
          (click)="save()"
        >
          {{ busy() ? 'Saving...' : 'Create Person' }}
        </button>
      </div>
    </section>
  `,
})
export class PersonNewForm {
  /** What the person typed in the picker: becomes the first and last name. */
  readonly text = input('');
  /** Prefix of every element id (two forms on one page stay apart). */
  readonly prefix = input('pn');
  readonly created = output<PersonDto>();
  /** The person picked "Use This Person" from the near-duplicate hint. */
  readonly useExisting = output<PersonLookupItem>();
  readonly cancelled = output<void>();

  private readonly api = inject(PeopleClient);
  private readonly quiet = inject(QuietRequests);

  protected readonly first = signal('');
  protected readonly last = signal('');
  protected readonly type = signal<'INTERNAL' | 'EXTERNAL'>('EXTERNAL');
  protected readonly company = signal('');
  protected readonly email = signal('');
  protected readonly title = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly serverFields = signal<Record<string, string>>({});
  protected readonly similar = signal<PersonSimilarItem[]>([]);
  private readonly touched = signal<ReadonlySet<string>>(new Set());
  private readonly submitted = signal(false);
  private checkId = 0;

  protected readonly firstError = computed(
    () =>
      this.serverFields()['firstName'] ??
      (this.shows('first') && this.first().trim() === '' ? PERSON_FORM_MESSAGES.first : null),
  );
  protected readonly lastError = computed(
    () =>
      this.serverFields()['lastName'] ??
      (this.shows('last') && this.last().trim() === '' ? PERSON_FORM_MESSAGES.last : null),
  );
  protected readonly emailError = computed(() => {
    const value = this.email().trim();
    return (
      this.serverFields()['email'] ??
      (this.shows('email') && value !== '' && !EMAIL_SHAPE.test(value)
        ? PERSON_FORM_MESSAGES.email
        : null)
    );
  });

  constructor() {
    // The typed text is the starting point; the form is created per opening, so this runs once.
    queueMicrotask(() => {
      const { first, last } = splitName(this.text());
      this.first.set(first);
      this.last.set(last);
      void this.check();
    });
  }

  protected meta(p: PersonLookupItem): string {
    return [p.title, p.companyName || p.email].filter(Boolean).join(', ');
  }

  protected setType(type: 'INTERNAL' | 'EXTERNAL'): void {
    this.type.set(type);
    if (type === 'INTERNAL') this.company.set('');
  }

  protected touch(name: string): void {
    this.touched.update((s) => new Set(s).add(name));
    void this.check();
  }

  private shows(name: string): boolean {
    return this.submitted() || this.touched().has(name);
  }

  /** The near-duplicate hint for the typed name and email; a failure shows nothing (the hint is help, never a gate). */
  private async check(): Promise<void> {
    const id = ++this.checkId;
    const first = this.first().trim();
    const last = this.last().trim();
    const email = this.email().trim();
    if (!first && !last && !email) {
      this.similar.set([]);
      return;
    }
    try {
      const found = await firstValueFrom(
        this.quiet.run(() =>
          this.api.findSimilarPeople(first || undefined, last || undefined, email || undefined),
        ),
      );
      if (id === this.checkId) this.similar.set(found);
    } catch {
      if (id === this.checkId) this.similar.set([]);
    }
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.submitted.set(true);
    this.serverFields.set({});
    this.error.set('');
    if (this.firstError() || this.lastError() || this.emailError()) return;
    this.busy.set(true);
    try {
      const person = await firstValueFrom(
        this.api.createPerson({
          firstName: this.first().trim(),
          lastName: this.last().trim(),
          personType: this.type(),
          title: this.title().trim() || undefined,
          email: this.email().trim() || undefined,
          companyName: this.type() === 'EXTERNAL' ? this.company().trim() || undefined : undefined,
        }),
      );
      this.created.emit(person);
    } catch (err) {
      const failure = serverFormErrors(err);
      this.serverFields.set(failure.fields);
      this.error.set(
        Object.keys(failure.fields).length > 0
          ? ''
          : `${PERSON_FORM_MESSAGES.failed} ${(err as Error)?.message ?? ''}`.trim(),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
