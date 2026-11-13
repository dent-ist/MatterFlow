import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PeopleClient, VendorsClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { NotificationService } from '../../core/notify/notification.service';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { aContact } from '../../shared/testing/vendors-testing';
import { VendorContactsTab } from './vendor-contacts-tab';

@Component({
  imports: [VendorContactsTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-vendor-contacts-tab
    [vendorId]="7"
    [canManage]="manage()"
    (countChange)="counts.push($event)"
    (changed)="changes = changes + 1"
  />`,
})
class Host {
  readonly manage = signal(true);
  readonly counts: number[] = [];
  changes = 0;
}

describe('VendorContactsTab', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const flagged = aContact({
    contactId: 22,
    personId: 12,
    personName: 'Sam Rivera',
    personTitle: 'Reviewer',
    personCompany: undefined,
    personEmail: 'sam.rivera@northbridge.example',
    flag: 'DO_NOT_HIRE',
    reportedOn: '2026-10-02',
    reportedByName: 'Maria Alvarez',
    note: 'Missed two deadlines.',
  });

  async function start(
    contacts = [aContact(), flagged],
    permissions: Permission[] = ['Vendor.View', 'Vendor.Manage'],
  ) {
    api = {
      listVendorContacts: vi.fn().mockReturnValue(ok(contacts)),
      createVendorContact: vi.fn().mockReturnValue(ok(aContact({ contactId: 23 }))),
      updateVendorContact: vi
        .fn()
        .mockImplementation((_v: number, id: number, b: { flag: string; note?: string }) =>
          ok(aContact({ contactId: id, flag: b.flag, note: b.note, rowVersion: 'CV2' })),
        ),
      deleteVendorContact: vi.fn().mockReturnValue(ok(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: VendorsClient, useValue: api },
        {
          provide: PeopleClient,
          useValue: {
            lookupPeople: () => ok([]),
            findSimilarPeople: () => ok([]),
            createPerson: vi.fn(),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    f.componentInstance.manage.set(permissions.includes('Vendor.Manage'));
    await settle(f);
    return f;
  }

  it('lists the contacts with name, title, company or email, the flag and, for a flagged one, the date, the reporter and the note', async () => {
    const f = await start();
    const rows = Array.from(el(f).querySelectorAll('[data-contact]'));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Laura Whitfield');
    expect(rows[0].textContent).toContain('Account Executive · Northbridge eDiscovery');
    expect(rows[0].querySelector('[data-contact-flag="NONE"]')).not.toBeNull();
    expect(rows[0].querySelector('[data-contact-note]')).toBeNull();
    expect(rows[1].querySelector('[data-contact-flag="DO_NOT_HIRE"]')!.textContent).toContain(
      'Do Not Hire',
    );
    const note = rows[1].querySelector('[data-contact-note]')!.textContent!;
    expect(note).toContain('Reported 10/02');
    expect(note).toContain('by Maria Alvarez');
    expect(note).toContain('Missed two deadlines.');
    expect(f.componentInstance.counts).toEqual([2]);
  });

  it('says so when there are no contacts', async () => {
    const f = await start([]);
    expect(el(f).querySelector('[data-contacts-empty]')!.textContent).toContain('No contacts yet.');
  });

  it('Add Note opens the form inside the row (flag, date, note, Reported By), never a dialog', async () => {
    const f = await start();
    el(f).querySelector<HTMLElement>('[data-contact="21"] [data-edit-note]')!.click();
    await settle(f);
    expect(document.body.querySelector('.p-dialog')).toBeNull();
    const form = el(f).querySelector('[data-note-form]')!;
    expect(form.querySelectorAll('[data-note-flag] button')).toHaveLength(3);
    expect(form.textContent).not.toContain('Reported Date');
    form.querySelector<HTMLElement>('[data-flag="RECOMMENDED"]')!.click();
    await settle(f);
    expect(form.textContent).toContain('Reported Date');
    expect(form.textContent).toContain('Reported By');
    expect(form.querySelector('[data-reported-by]')!.textContent).toContain('You');
  });

  it('refuses a flag without a note and saves a note through PUT with the row version', async () => {
    const f = await start();
    const notify = vi.spyOn(TestBed.inject(NotificationService), 'success');
    el(f).querySelector<HTMLElement>('[data-contact="21"] [data-edit-note]')!.click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-flag="RECOMMENDED"]')!.click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-note-save] button, button[data-note-save]')!.click();
    await settle(f);
    expect(api['updateVendorContact']).not.toHaveBeenCalled();
    expect(el(f).querySelector('#note-text-error')!.textContent).toContain('Write the note.');
    const area = el(f).querySelector<HTMLTextAreaElement>('#note-text')!;
    area.value = 'Excellent on short notice.';
    area.dispatchEvent(new Event('input'));
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-note-save] button, button[data-note-save]')!.click();
    await settle(f);
    expect(api['updateVendorContact']).toHaveBeenCalledWith(
      7,
      21,
      expect.objectContaining({
        flag: 'RECOMMENDED',
        note: 'Excellent on short notice.',
        rowVersion: 'CV1',
        reportedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    expect(notify).toHaveBeenCalledWith('Note saved', 'Laura Whitfield.');
    expect(f.componentInstance.changes).toBe(1);
    expect(el(f).querySelector('[data-note-form]')).toBeNull();
  });

  it('choosing No Note clears the flag without a date or note', async () => {
    const f = await start();
    el(f).querySelector<HTMLElement>('[data-contact="22"] [data-edit-note]')!.click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-flag="NONE"]')!.click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-note-save] button, button[data-note-save]')!.click();
    await settle(f);
    expect(api['updateVendorContact']).toHaveBeenCalledWith(7, 22, {
      flag: 'NONE',
      reportedOn: undefined,
      note: undefined,
      rowVersion: 'CV1',
    });
  });

  it('Cancel closes the note form without saving', async () => {
    const f = await start();
    el(f).querySelector<HTMLElement>('[data-contact="22"] [data-edit-note]')!.click();
    await settle(f);
    el(f)
      .querySelector<HTMLElement>('[data-note-cancel] button, button[data-note-cancel]')!
      .click();
    await settle(f);
    expect(el(f).querySelector('[data-note-form]')).toBeNull();
    expect(api['updateVendorContact']).not.toHaveBeenCalled();
  });

  it('a stale row version reloads the list and says so', async () => {
    const f = await start();
    api['updateVendorContact'].mockReturnValue(
      apiError(409, { status: 409, code: 'CONCURRENCY_CONFLICT' }),
    );
    el(f).querySelector<HTMLElement>('[data-contact="22"] [data-edit-note]')!.click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-note-save] button, button[data-note-save]')!.click();
    await settle(f);
    expect(api['listVendorContacts']).toHaveBeenCalledTimes(2);
  });

  it('Add Contact opens a panel with the person combobox and adds the chosen person', async () => {
    const f = await start();
    el(f)
      .querySelector<HTMLElement>('[data-add-contact] button, button[data-add-contact]')!
      .click();
    await settle(f);
    expect(el(f).querySelector('[data-add-contact-panel] mf-person-picker')).not.toBeNull();
    el(f)
      .querySelector<HTMLElement>('[data-add-confirm] button, button[data-add-confirm]')!
      .click();
    await settle(f);
    expect(api['createVendorContact']).not.toHaveBeenCalled();
    expect(el(f).textContent).toContain('Choose a person from the list.');
  });

  it('Remove asks inside the row, then removes the contact and keeps the person in People', async () => {
    const f = await start();
    const notify = vi.spyOn(TestBed.inject(NotificationService), 'success');
    el(f).querySelector<HTMLElement>('[data-contact="22"] [data-remove-contact]')!.click();
    await settle(f);
    expect(el(f).querySelector('[data-remove-ask]')!.textContent).toContain(
      'Remove Sam Rivera from this vendor? The person stays in People.',
    );
    el(f)
      .querySelector<HTMLElement>('[data-remove-confirm] button, button[data-remove-confirm]')!
      .click();
    await settle(f);
    expect(api['deleteVendorContact']).toHaveBeenCalledWith(7, 22);
    expect(notify).toHaveBeenCalledWith('Contact removed', 'Sam Rivera stays in People.');
  });

  it('Keep Contact closes the question', async () => {
    const f = await start();
    el(f).querySelector<HTMLElement>('[data-contact="22"] [data-remove-contact]')!.click();
    await settle(f);
    el(f)
      .querySelector<HTMLElement>('[data-remove-keep] button, button[data-remove-keep]')!
      .click();
    await settle(f);
    expect(el(f).querySelector('[data-remove-ask]')).toBeNull();
    expect(api['deleteVendorContact']).not.toHaveBeenCalled();
  });

  it('Vendor.View only: the list is read only, no Add Contact, Add Note, Edit Note or Remove', async () => {
    const f = await start(undefined, ['Vendor.View']);
    expect(el(f).querySelector('[data-add-contact]')).toBeNull();
    expect(el(f).querySelector('[data-edit-note]')).toBeNull();
    expect(el(f).querySelector('[data-remove-contact]')).toBeNull();
    expect(el(f).querySelector('[data-contacts-readonly]')).not.toBeNull();
    expect(el(f).querySelectorAll('[data-contact]')).toHaveLength(2);
  });

  it('shows an inactive person as such', async () => {
    const f = await start([aContact({ personIsActive: false })]);
    expect(el(f).textContent).toContain('(inactive in People)');
  });

  it('says so, with Retry, when the contacts cannot be loaded', async () => {
    api = { listVendorContacts: vi.fn().mockReturnValue(apiError(500, { status: 500 })) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions('Vendor.View'))),
        { provide: VendorsClient, useValue: api },
        { provide: PeopleClient, useValue: {} },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    await settle(f);
    expect(el(f).textContent).toContain("Couldn't load the contacts.");
  });
});
