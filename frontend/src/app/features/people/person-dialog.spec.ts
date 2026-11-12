import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PeopleClient, PersonDto } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { aPerson } from '../../shared/testing/people-testing';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { PERSON_MESSAGES, PersonDialog } from './person-dialog';

@Component({
  imports: [PersonDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-person-dialog
    [person]="person()"
    [(visible)]="open"
    (saved)="log.push($event.displayName)"
  />`,
})
class Host {
  readonly person = signal<PersonDto | null>(null);
  readonly open = signal(true);
  readonly log: string[] = [];
}

describe('PersonDialog', () => {
  let api: { createPerson: ReturnType<typeof vi.fn>; updatePerson: ReturnType<typeof vi.fn> };
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const type = (id: string, value: string) => {
    const input = q(`#${id}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const save = () =>
    (q('[data-panel-primary] button, button[data-panel-primary]') as HTMLButtonElement).click();

  async function start(
    person: PersonDto | null = null,
    permissions: Permission[] = ['People.View', 'People.Manage'],
  ) {
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    api = {
      createPerson: vi
        .fn()
        .mockReturnValue(ok(aPerson({ personId: 60, displayName: 'Dana Whitaker' }))),
      updatePerson: vi
        .fn()
        .mockImplementation((_id: number, body: object) => ok(aPerson({ ...body }))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: PeopleClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    f.componentInstance.person.set(person);
    await settle(f);
    return f;
  }

  it('New Person: a 576 px form with First Name, Last Name, Internal or External, Title or Role, Email, Company Name and Comments', async () => {
    await start();
    expect(q('[data-panel-title]')!.textContent).toContain('New Person');
    const labels = Array.from(
      document.body.querySelectorAll(
        '[data-person-form] label, [data-person-form] .mf-field__label',
      ),
    ).map((l) => l.textContent!.replace(/\s+/g, ' ').trim());
    expect(labels.join('|')).toContain('First Name (required)');
    expect(labels.join('|')).toContain('Last Name (required)');
    expect(labels).toContain('Internal or External');
    expect(labels).toContain('Title or Role');
    expect(labels.join('|')).toContain('Email');
    expect(labels).toContain('External Company Name');
    expect(labels.join('|')).toContain('Comments');
    expect(q('[data-type="EXTERNAL"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('.mf-formdlg')).not.toBeNull();
  });

  it('hides the company for an Internal person and sends none', async () => {
    const f = await start();
    type('person-first', 'Helen');
    type('person-last', 'Park');
    type('person-company', 'Whitaker Court Reporting');
    (q('[data-type="INTERNAL"]') as HTMLButtonElement).click();
    await settle(f);
    expect(q('#person-company')).toBeNull();
    save();
    await settle(f);
    expect(api.createPerson).toHaveBeenCalledWith({
      firstName: 'Helen',
      lastName: 'Park',
      personType: 'INTERNAL',
      title: undefined,
      email: undefined,
      comments: undefined,
      companyName: undefined,
    });
  });

  it('refuses an empty name and a bad email, and focuses the first problem', async () => {
    const f = await start();
    type('person-email', 'not-an-email');
    save();
    await settle(f);
    expect(api.createPerson).not.toHaveBeenCalled();
    expect(q('[data-person-form]')!.textContent).toContain(PERSON_MESSAGES.first);
    expect(q('[data-person-form]')!.textContent).toContain(PERSON_MESSAGES.last);
    expect(q('[data-person-form]')!.textContent).toContain(PERSON_MESSAGES.email);
  });

  it('Edit Person saves the changes with the row version and closes', async () => {
    const f = await start(aPerson());
    expect(q('[data-panel-title]')!.textContent).toContain('Edit Person');
    expect(q('[data-panel-title]')!.textContent).toContain('Laura Whitfield');
    type('person-title', 'Director');
    await settle(f);
    save();
    await settle(f);
    expect(api.updatePerson).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        title: 'Director',
        isActive: true,
        rowVersion: 'RV1',
        firstName: 'Laura',
      }),
    );
    expect(f.componentInstance.log).toEqual(['Laura Whitfield']);
    expect(f.componentInstance.open()).toBe(false);
  });

  it('a system user: name, email and type are plain text with the banner; Title or Role and Comments stay editable', async () => {
    const f = await start(
      aPerson({
        personId: 3,
        firstName: 'Maria',
        lastName: 'Alvarez',
        displayName: 'Maria Alvarez',
        personType: 'INTERNAL',
        userId: 8,
        isSystemUser: true,
        companyName: undefined,
      }),
      ['People.View', 'People.Manage', 'User.View'],
    );
    expect(q('[data-system-banner]')!.className).toContain('pg-banner--info');
    expect(q('[data-system-banner] i.pi')).not.toBeNull();
    expect(q('[data-system-banner]')!.textContent).toContain('This person is a system user.');
    expect(q('[data-system-banner] a')!.getAttribute('href')).toBe('/admin/users');
    expect(q('#person-first')).toBeNull();
    expect(q('#person-email')).toBeNull();
    expect(q('[data-plain-field="first"]')!.textContent).toContain('Maria');
    expect(q('[data-plain-field="type"]')!.textContent).toContain('System User');
    expect(q('#person-title')).not.toBeNull();
    expect(q('#person-comments')).not.toBeNull();
    type('person-comments', 'Covers the Boston office.');
    await settle(f);
    save();
    await settle(f);
    expect(api.updatePerson).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        comments: 'Covers the Boston office.',
        firstName: 'Maria',
        personType: 'INTERNAL',
      }),
    );
  });

  it('People.View only: a read-only view, no fields, no save, one Close', async () => {
    await start(aPerson({ comments: 'Prefers email.' }), ['People.View']);
    expect(q('[data-panel-title]')!.textContent).toContain('Person');
    expect(q('[data-panel-title]')!.textContent).not.toContain('Edit');
    expect(q('[data-person-form] input, [data-person-form] textarea')).toBeNull();
    expect(q('[data-plain-field="comments"]')!.textContent).toContain('Prefers email.');
    expect(q('[data-system-banner]')).toBeNull();
    expect(q('[data-panel-primary]')).toBeNull();
    expect(q('[data-panel-footer]')!.textContent).toContain('Close');
  });

  it('shows a server message under its field, and the stale-save sentence in the footer', async () => {
    const f = await start(aPerson());
    api.updatePerson.mockReturnValue(
      apiError(400, {
        status: 400,
        code: 'VALIDATION_FAILED',
        errors: { email: [{ code: 'INVALID', message: 'Enter a valid e-mail address.' }] },
      }),
    );
    type('person-title', 'X');
    await settle(f);
    save();
    await settle(f);
    expect(q('[data-person-form]')!.textContent).toContain('Enter a valid e-mail address.');
    api.updatePerson.mockReturnValue(apiError(409, { status: 409, code: 'CONCURRENCY_CONFLICT' }));
    type('person-email', 'laura@northbridge.example');
    await settle(f);
    save();
    await settle(f);
    expect(q('[data-panel-error]')!.textContent).toContain(PERSON_MESSAGES.conflict);
    expect(f.componentInstance.open()).toBe(true);
  });
});
