import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PrioritiesClient, StatusLabelsClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { LeaveConfirmService } from '../../../shared/guards/unsaved-changes.guard';
import { LookupStore } from '../../../core/lookups/lookup-store';
import {
  FakePrioritiesClient,
  FakeStatusLabelsClient,
  apiError,
} from '../../../core/lookups/lookups-testing';
import { StatusLabelsPage } from './status-labels-page';

describe('StatusLabelsPage', () => {
  let api: FakeStatusLabelsClient;
  let priorityApi: FakePrioritiesClient;
  let fixture: ComponentFixture<StatusLabelsPage>;
  const el = (): HTMLElement => fixture.nativeElement;
  const row = (code: string): HTMLElement =>
    el().querySelector<HTMLElement>(`[data-row="${code}"]`)!;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  async function open(...permissions: Permission[]): Promise<void> {
    api = new FakeStatusLabelsClient();
    priorityApi = new FakePrioritiesClient();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: StatusLabelsClient, useValue: api },
        { provide: PrioritiesClient, useValue: priorityApi },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(StatusLabelsPage);
    await settle();
  }

  const dialog = (): HTMLElement | null => document.body.querySelector('mf-lookup-dialog');

  /** Opens the rename dialog of a status and types a name into its field. */
  async function edit(code: string, text: string): Promise<HTMLInputElement> {
    (row(code).querySelector('[data-rename]') as HTMLElement).click();
    await settle();
    const input = document.body.querySelector<HTMLInputElement>('#status-label-name')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await settle();
    return input;
  }

  async function submit(input: HTMLInputElement): Promise<void> {
    input.form!.dispatchEvent(new Event('submit'));
    await settle();
  }

  describe('as a status label manager only (AD-D #523)', () => {
    beforeEach(() => open('StatusLabel.Manage'));

    it('loads no priorities, offers no tab strip and shows no error', () => {
      expect(priorityApi.calls).toEqual([]);
      expect(el().querySelector('nav.tabs')).toBeNull();
      expect(el().querySelector('[data-failure], [role="alert"]')).toBeNull();
    });
  });

  describe('with both Labels permissions (AD-D #523)', () => {
    beforeEach(() => open('Priority.Manage', 'StatusLabel.Manage'));

    it('offers both tabs', () => {
      const tabs = Array.from(el().querySelectorAll('nav.tabs a')).map((a) =>
        a.textContent!.trim(),
      );
      expect(tabs).toEqual(['Priorities', 'Status labels']);
    });
  });

  describe('as a status label manager', () => {
    beforeEach(() => open('StatusLabel.Manage'));

    it('shows exactly the five fixed codes read-only with their labels and badges, and no add or delete', () => {
      const codes = Array.from(el().querySelectorAll('[data-row]')).map((r) =>
        r.getAttribute('data-row'),
      );
      expect(codes).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
      expect(row('ON_HOLD').querySelector('th.code')!.textContent).toBe('ON_HOLD');
      expect(row('ON_HOLD').querySelector('input[name=code]')).toBeNull();
      expect(row('ON_HOLD').querySelector('mf-status-badge')!.textContent).toContain('On Hold');
      expect(el().textContent).toContain(
        "You can rename how statuses appear. You can't add or remove them.",
      );
      expect(el().querySelector('[data-delete]')).toBeNull();
      expect(
        Array.from(el().querySelectorAll('button')).some((b) => /add/i.test(b.textContent ?? '')),
      ).toBe(false);
    });

    it('renames only the display label in the dialog, with a live preview, and keeps the code', async () => {
      const input = await edit('ON_HOLD', 'Waiting');
      // The dialog says what stays, and previews the badge as it will look; the row is unchanged until it is saved.
      expect(document.body.querySelector('[data-rename-help]')!.textContent).toContain(
        'The code ON_HOLD and every task',
      );
      expect(document.body.querySelector('[data-preview] mf-status-badge')!.textContent).toContain(
        'Waiting',
      );
      expect(row('ON_HOLD').querySelector('mf-status-badge')!.textContent).toContain('On Hold');

      await submit(input);

      expect(api.calls).toContain('update:ON_HOLD:Waiting');
      expect(row('ON_HOLD').querySelector('th.code')!.textContent).toBe('ON_HOLD');
      expect(row('ON_HOLD').textContent).toContain('Waiting');
      expect(TestBed.inject(LookupStore).statusLabel('ON_HOLD')).toBe('Waiting');
    });

    it('rejects a blank label with the summary and the message, and Cancel closes the dialog', async () => {
      const input = await edit('NEW', '  ');
      await submit(input);
      expect(document.body.querySelector('[data-summary]')!.textContent).toContain(
        'Enter a label.',
      );
      expect(dialog()!.textContent).toContain('Enter a label.');
      expect(api.calls.filter((c) => c !== 'list')).toEqual([]);

      // The blank text is an edit: Cancel asks first ("Stay" is the default), and Leave closes the dialog.
      const leave = TestBed.inject(LeaveConfirmService);
      (document.body.querySelector('[data-lookup-cancel] button') as HTMLElement).click();
      await settle();
      expect(leave.open()).toBe(true);
      leave.answer(true);
      await settle();
      expect(document.body.querySelector('#status-label-name')).toBeNull();
      expect(row('NEW').textContent).toContain('New');
    });

    it('shows the duplicate-label message from the server', async () => {
      const input = await edit('NEW', 'Completed');
      api.failNext = apiError(409, 'DUPLICATE_NAME', "A status labelled 'Completed' exists.", {
        displayLabel: [{ code: 'DUPLICATE', message: "A status labelled 'Completed' exists." }],
      });

      await submit(input);

      expect(dialog()!.textContent).toContain("A status labelled 'Completed' exists.");
      expect(document.body.querySelector('#status-label-name')).not.toBeNull();
    });
  });

  describe('without StatusLabel.Manage', () => {
    beforeEach(() => open('Task.View'));

    it('is read-only', () => {
      expect(el().querySelectorAll('[data-row]').length).toBe(5);
      expect(el().querySelector('[data-rename]')).toBeNull();
    });
  });
});
