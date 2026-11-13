import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PeopleClient, PersonLookupItem } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { NotificationService } from '../../core/notify/notification.service';
import { aLookupPerson, aPerson } from '../testing/people-testing';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../testing/org-testing';
import { PERSON_PICKER_MESSAGES, PersonPicker } from './person-picker';
import { splitName } from './person-new-form';

@Component({
  imports: [PersonPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-person-picker
    inputId="pick"
    label="Person"
    [debounceMs]="0"
    [taken]="taken()"
    [clearOnPick]="clear()"
    [onlyType]="only()"
    [(selected)]="selected"
    (picked)="log.push('picked ' + $event.displayName)"
    (draftChange)="draft.set($event)"
  />`,
})
class Host {
  readonly selected = signal<PersonLookupItem | null>(null);
  readonly taken = signal<number[]>([]);
  readonly clear = signal(false);
  readonly only = signal<'INTERNAL' | 'EXTERNAL' | null>(null);
  readonly draft = signal('');
  readonly log: string[] = [];
}

describe('PersonPicker', () => {
  let api: {
    lookupPeople: ReturnType<typeof vi.fn>;
    findSimilarPeople: ReturnType<typeof vi.fn>;
    createPerson: ReturnType<typeof vi.fn>;
  };
  const laura = aLookupPerson();
  const maria = aLookupPerson({
    personId: 12,
    displayName: 'Maria Alvarez',
    personType: 'INTERNAL',
    title: 'Project Manager',
    email: 'maria.alvarez@lawfirm.example',
    companyName: undefined,
    userId: 3,
    isSystemUser: true,
  });

  async function start(permissions: Permission[] = ['People.View', 'People.Manage']) {
    api = {
      lookupPeople: vi.fn().mockReturnValue(ok([laura, maria])),
      findSimilarPeople: vi.fn().mockReturnValue(ok([])),
      createPerson: vi.fn().mockReturnValue(
        ok(
          aPerson({
            personId: 40,
            firstName: 'Dana',
            lastName: 'Whitaker',
            displayName: 'Dana Whitaker',
            title: undefined,
            email: undefined,
            companyName: undefined,
          }),
        ),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: PeopleClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    await settle(f);
    return f;
  }

  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const input = (f: { nativeElement: unknown }) => el(f).querySelector<HTMLInputElement>('#pick')!;
  async function type(f: Awaited<ReturnType<typeof start>>, value: string) {
    const box = input(f);
    box.focus();
    box.value = value;
    box.dispatchEvent(new Event('input'));
    await settle(f);
  }
  async function key(f: Awaited<ReturnType<typeof start>>, k: string) {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    input(f).dispatchEvent(ev);
    await settle(f);
    return ev;
  }
  // The list is a floating panel in the body (like the shared dropdown), not inside the picker.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- same shape as the other helpers
  const options = (_f?: unknown) =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[role=option]'));

  it('is a named combobox that searches People as the person types', async () => {
    const f = await start();
    const box = input(f);
    expect(box.getAttribute('role')).toBe('combobox');
    expect(box.getAttribute('aria-expanded')).toBe('false');
    await type(f, 'lau');
    expect(api.lookupPeople).toHaveBeenCalledWith('lau', undefined);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(box.getAttribute('aria-controls')).toBe('pick-list');
    expect(document.body.querySelector('[role=listbox]')!.getAttribute('aria-label')).toBe(
      'Person',
    );
  });

  it('shows the Internal, External or System User badge, the title and the company or email in every option', async () => {
    const f = await start();
    await type(f, 'a');
    const [first, second] = options(f);
    expect(first.textContent).toContain('Laura Whitfield');
    expect(first.textContent).toContain('Account Executive, Northbridge eDiscovery');
    expect(first.querySelector('[data-person-kind]')!.textContent!.trim()).toBe('External');
    expect(second.textContent).toContain('Project Manager, maria.alvarez@lawfirm.example');
    expect(second.querySelector('[data-person-kind]')!.textContent!.trim()).toBe('System User');
  });

  it('draws the list in the body as 36 px single-line options with the shared dropdown look, never inside the field', async () => {
    const f = await start();
    await type(f, 'a');
    const list = document.body.querySelector<HTMLElement>('[data-person-panel]')!;
    expect(list.parentElement).toBe(document.body);
    expect(el(f).querySelector('[role=listbox]')).toBeNull();
    expect(getComputedStyle(list).position).toBe('fixed');
    for (const o of options(f))
      expect(o.querySelectorAll('br, [data-second-line]')).toHaveLength(0);
    expect(document.body.querySelector('[data-person-panel] .pp__avatar')).toBeNull();
  });

  it('picks with the standard keys only: Arrow Down, Enter, and Escape closes the list', async () => {
    const f = await start();
    await type(f, 'a');
    await key(f, 'ArrowDown');
    expect(input(f).getAttribute('aria-activedescendant')).toBe('pick-opt-0');
    await key(f, 'ArrowDown');
    expect(options(f)[1].getAttribute('aria-selected')).toBe('true');
    await key(f, 'ArrowUp');
    const escape = await key(f, 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(document.body.querySelector('[role=listbox]')).toBeNull();
    await key(f, 'ArrowDown');
    await key(f, 'ArrowDown');
    await key(f, 'Enter');
    expect(f.componentInstance.selected()?.displayName).toBe('Laura Whitfield');
    expect(f.componentInstance.log).toEqual(['picked Laura Whitfield']);
    expect(el(f).querySelector('[data-chosen-name]')!.textContent).toContain('Laura Whitfield');
    expect(el(f).querySelector('[data-change]')).not.toBeNull();
  });

  it('picks with a click, and Change brings the box back', async () => {
    const f = await start();
    await type(f, 'a');
    options(f)[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await settle(f);
    expect(f.componentInstance.selected()?.personId).toBe(12);
    el(f).querySelector<HTMLButtonElement>('[data-change]')!.click();
    await settle(f);
    expect(f.componentInstance.selected()).toBeNull();
    expect(input(f)).not.toBeNull();
  });

  it('never accepts free text: typing without picking leaves the value empty and reports the draft', async () => {
    const f = await start();
    await type(f, 'Someone Else');
    input(f).dispatchEvent(new Event('blur'));
    await key(f, 'Enter');
    expect(f.componentInstance.selected()).toBeNull();
    expect(f.componentInstance.draft()).toBe('Someone Else');
    expect(PERSON_PICKER_MESSAGES.pick).toBe('Choose a person from the list.');
  });

  it('shows a person that is already on the list as disabled, with the label, and does not pick it', async () => {
    const f = await start();
    f.componentInstance.taken.set([11]);
    await settle(f);
    await type(f, 'a');
    const [first] = options(f);
    expect(first.getAttribute('aria-disabled')).toBe('true');
    expect(first.textContent).toContain('On the List');
    await key(f, 'ArrowDown');
    await key(f, 'Enter');
    expect(f.componentInstance.selected()).toBeNull();
  });

  it('empties itself after a pick in the empty-row pattern (clearOnPick)', async () => {
    const f = await start();
    f.componentInstance.clear.set(true);
    await settle(f);
    await type(f, 'a');
    await key(f, 'ArrowDown');
    await key(f, 'Enter');
    expect(f.componentInstance.log).toEqual(['picked Laura Whitfield']);
    expect(f.componentInstance.selected()).toBeNull();
    expect(input(f).value).toBe('');
  });

  it('says so when nothing matches and when the search fails', async () => {
    const f = await start(['People.View', 'Matter.Edit']);
    api.lookupPeople.mockReturnValue(ok([]));
    await type(f, 'zz');
    // No People.Manage: the Create option is shown (disabled), so the list is not empty.
    expect(options(f)).toHaveLength(1);
    TestBed.resetTestingModule();
    const g = await start(['People.View', 'People.Manage']);
    api.lookupPeople.mockReturnValue(apiError(500, { status: 500, code: 'INTERNAL_ERROR' }));
    await type(g, 'zz');
    expect(document.body.querySelector('[data-person-note]')!.textContent).toContain(
      PERSON_PICKER_MESSAGES.failed,
    );
    expect(document.body.querySelector('[role=listbox]')).toBeNull();
    expect(input(g).hasAttribute('aria-controls')).toBe(false);
  });

  describe('Create (People.Manage)', () => {
    it('offers + Create "typed name" and the "Did you mean this person?" group first', async () => {
      const f = await start();
      api.lookupPeople.mockReturnValue(ok([]));
      api.findSimilarPeople.mockReturnValue(
        ok([{ person: laura, isActive: true, reason: 'SIMILAR_NAME' }]),
      );
      await type(f, 'Laura Whitfeld');
      expect(api.findSimilarPeople).toHaveBeenCalledWith('Laura', 'Whitfeld');
      const rows = options(f);
      expect(document.body.querySelector('[data-group]')!.textContent).toBe(
        'Did you mean this person?',
      );
      expect(rows[0].textContent).toContain('Laura Whitfield');
      expect(rows[1].hasAttribute('data-create')).toBe(true);
      expect(rows[1].textContent).toContain('Create "Laura Whitfeld"');
    });

    it('does not offer Create for a name that is already a person', async () => {
      const f = await start();
      await type(f, 'Laura Whitfield');
      expect(document.body.querySelector('[data-create]')).toBeNull();
      expect(api.findSimilarPeople).not.toHaveBeenCalled();
    });

    it('with onlyType asks for that type only, creates that type and does not show the type choice (matter team, #1383)', async () => {
      const f = await start();
      f.componentInstance.only.set('INTERNAL');
      await settle(f);
      api.lookupPeople.mockReturnValue(ok([]));
      await type(f, 'Dana Whitaker');
      expect(api.lookupPeople).toHaveBeenCalledWith('Dana Whitaker', 'INTERNAL');
      document.body
        .querySelector('[data-create]')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await settle(f);
      const form = el(f).querySelector('[data-person-new]')!;
      expect(form.querySelector('[data-person-type]')).toBeNull();
      expect(form.querySelector('#pick-new-company')).toBeNull();
      (form.querySelector('[data-person-new-save]') as HTMLButtonElement).click();
      await settle(f);
      expect(api.createPerson).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Dana', personType: 'INTERNAL' }),
      );
    });

    it('opens the inline form with the typed name, saves with POST /people and selects the new person', async () => {
      const f = await start();
      const notify = vi.spyOn(TestBed.inject(NotificationService), 'success');
      api.lookupPeople.mockReturnValue(ok([]));
      await type(f, 'Dana Whitaker');
      document.body
        .querySelector('[data-create]')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await settle(f);
      const form = el(f).querySelector('[data-person-new]')!;
      expect(form).not.toBeNull();
      expect((form.querySelector('#pick-new-first') as HTMLInputElement).value).toBe('Dana');
      expect((form.querySelector('#pick-new-last') as HTMLInputElement).value).toBe('Whitaker');
      expect(form.querySelector('[data-type="EXTERNAL"]')!.getAttribute('aria-pressed')).toBe(
        'true',
      );
      const company = form.querySelector('#pick-new-company') as HTMLInputElement;
      company.value = 'Whitaker Court Reporting';
      company.dispatchEvent(new Event('input'));
      (form.querySelector('[data-person-new-save]') as HTMLButtonElement).click();
      await settle(f);
      expect(api.createPerson).toHaveBeenCalledWith({
        firstName: 'Dana',
        lastName: 'Whitaker',
        personType: 'EXTERNAL',
        title: undefined,
        email: undefined,
        companyName: 'Whitaker Court Reporting',
      });
      expect(f.componentInstance.selected()?.personId).toBe(40);
      expect(notify).toHaveBeenCalledWith('Person created', 'Dana Whitaker is in People.');
      expect(el(f).querySelector('[data-person-new]')).toBeNull();
    });

    it('checks the form before it saves and shows the server message under the field', async () => {
      const f = await start();
      api.lookupPeople.mockReturnValue(ok([]));
      await type(f, 'Dana');
      document.body
        .querySelector('[data-create]')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await settle(f);
      const form = el(f).querySelector('[data-person-new]')!;
      (form.querySelector('[data-person-new-save]') as HTMLButtonElement).click();
      await settle(f);
      expect(form.textContent).toContain('Enter a last name.');
      expect(api.createPerson).not.toHaveBeenCalled();

      const last = form.querySelector('#pick-new-last') as HTMLInputElement;
      last.value = 'Whitaker';
      last.dispatchEvent(new Event('input'));
      api.createPerson.mockReturnValue(
        apiError(400, {
          status: 400,
          code: 'VALIDATION_FAILED',
          errors: { email: [{ code: 'INVALID', message: 'Enter a valid e-mail address.' }] },
        }),
      );
      (form.querySelector('[data-person-new-save]') as HTMLButtonElement).click();
      await settle(f);
      expect(form.textContent).toContain('Enter a valid e-mail address.');
      expect(f.componentInstance.selected()).toBeNull();
    });

    it('Cancel closes the form without saving, and "Use This Person" picks the existing one', async () => {
      const f = await start();
      api.lookupPeople.mockReturnValue(ok([]));
      api.findSimilarPeople.mockReturnValue(
        ok([{ person: laura, isActive: true, reason: 'SAME_NAME' }]),
      );
      await type(f, 'Laura Whitfeld');
      const open = async () => {
        document.body
          .querySelector('[data-create]')!
          .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await settle(f);
      };
      await open();
      el(f).querySelector<HTMLButtonElement>('[data-person-new-cancel]')!.click();
      await settle(f);
      expect(el(f).querySelector('[data-person-new]')).toBeNull();
      expect(api.createPerson).not.toHaveBeenCalled();
      await type(f, 'Laura Whitfeld');
      await open();
      expect(el(f).querySelector('[data-similar]')!.textContent).toContain(
        'Did you mean this person?',
      );
      el(f).querySelector<HTMLButtonElement>('[data-use-similar]')!.click();
      await settle(f);
      expect(f.componentInstance.selected()?.personId).toBe(11);
      expect(api.createPerson).not.toHaveBeenCalled();
    });
  });

  describe('without People.Manage', () => {
    it('shows Create disabled with the reason, never opens the form and never asks for similar people', async () => {
      const f = await start(['People.View']);
      api.lookupPeople.mockReturnValue(ok([]));
      await type(f, 'Dana Whitaker');
      const create = document.body.querySelector<HTMLElement>('[data-create]')!;
      expect(create.getAttribute('aria-disabled')).toBe('true');
      expect(create.textContent).toContain('Create "Dana Whitaker" (not available)');
      expect(create.getAttribute('aria-describedby')).toBe('pick-why');
      expect(document.body.querySelector('#pick-why')!.textContent).toContain(
        PERSON_PICKER_MESSAGES.noPermission,
      );
      create.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await settle(f);
      expect(el(f).querySelector('[data-person-new]')).toBeNull();
      expect(api.findSimilarPeople).not.toHaveBeenCalled();
    });
  });
});

describe('splitName', () => {
  it('splits a typed name into first and last', () => {
    expect(splitName('Laura Whitfeld')).toEqual({ first: 'Laura', last: 'Whitfeld' });
    expect(splitName('  Mary Jane   Smith ')).toEqual({ first: 'Mary Jane', last: 'Smith' });
    expect(splitName('Dana')).toEqual({ first: 'Dana', last: '' });
    expect(splitName('')).toEqual({ first: '', last: '' });
  });
});
