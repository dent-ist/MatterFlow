import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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

  async function open(withTasks: boolean, ...permissions: Permission[]): Promise<void> {
    api = new FakeStatusLabelsClient();
    if (withTasks) {
      const counts: Record<string, number> = {
        NEW: 3,
        IN_PROGRESS: 2,
        ON_HOLD: 0,
        COMPLETED: 14,
        CANCELLED: 1,
      };
      api.rows = api.rows.map((r) => ({ ...r, taskCount: counts[r.code] }));
    }
    priorityApi = new FakePrioritiesClient();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
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

  async function setEdit(value: string | undefined): Promise<void> {
    fixture.componentRef.setInput('edit', value);
    await settle();
  }

  /** Opens the rename dialog of a status (`?edit=<code>`) and types a name into its field. */
  async function edit(code: string, text: string): Promise<HTMLInputElement> {
    await setEdit(code);
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

  describe('as a status label manager who may see tasks (#622)', () => {
    beforeEach(() => open(true, 'StatusLabel.Manage', 'Task.View'));

    it('shows exactly the five fixed statuses as badges with the code as the tooltip, a Tasks count and one menu', () => {
      const codes = Array.from(el().querySelectorAll('[data-row]')).map((r) =>
        r.getAttribute('data-row'),
      );
      expect(codes).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
      expect(
        Array.from(el().querySelectorAll('thead th')).map((th) => th.textContent!.trim()),
      ).toEqual(['Status', 'Tasks', 'Actions']);
      expect(row('ON_HOLD').querySelector('mf-status-badge')!.textContent).toContain('On Hold');
      expect(row('ON_HOLD').querySelector('[data-edit]')!.getAttribute('title')).toBe(
        'Internal code: ON_HOLD',
      );
      expect(row('ON_HOLD').textContent).not.toContain('ON_HOLD');
      for (const r of Array.from(el().querySelectorAll('[data-row]'))) {
        expect(r.querySelectorAll('mf-action-menu').length).toBe(1);
        expect(r.querySelectorAll('button').length).toBe(1);
      }
      expect(el().querySelector('[data-delete]')).toBeNull();
    });

    it('counts every task of the status and links the number to the Task Queue', () => {
      expect(
        Array.from(el().querySelectorAll('[data-tasks]')).map((c) => c.textContent!.trim()),
      ).toEqual(['3', '2', '0', '14', '1']);
      const link = row('COMPLETED').querySelector<HTMLAnchorElement>('[data-tasks] a')!;
      expect(link.getAttribute('href')).toBe('/tasks?status=COMPLETED');
      expect(link.getAttribute('aria-label')).toBe('14 tasks with the status Completed');
      expect(row('ON_HOLD').querySelector('[data-tasks] a')).toBeNull();
    });

    it('opens Rename from the name link (?edit=<code>) and from the row menu', async () => {
      expect(row('NEW').querySelector('[data-edit]')!.getAttribute('href')).toContain('edit=NEW');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      (row('NEW').querySelector('button[data-overflow]') as HTMLElement).click();
      await settle();
      expect(
        Array.from(row('NEW').querySelectorAll('[data-action]')).map((b) =>
          b.getAttribute('data-action'),
        ),
      ).toEqual(['rename']);
      (row('NEW').querySelector('[data-action="rename"]') as HTMLElement).click();
      await settle();
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { edit: 'NEW' } }),
      );
    });

    it('renames only the display label in the dialog, with the code, the live badge and where the name shows', async () => {
      const input = await edit('ON_HOLD', 'Waiting');
      // The dialog says what stays and where the name shows, and previews the badge; the row is unchanged until it is saved.
      const help = document.body.querySelector('[data-rename-help]')!.textContent;
      expect(help).toContain('The code ON_HOLD and every task');
      expect(help).toContain('Task Queue, My Work, the Dashboard and on task pages');
      expect(document.body.querySelector('[data-preview] mf-status-badge')!.textContent).toContain(
        'Waiting',
      );
      expect(row('ON_HOLD').querySelector('mf-status-badge')!.textContent).toContain('On Hold');

      await submit(input);

      expect(api.calls).toContain('update:ON_HOLD:Waiting');
      expect(row('ON_HOLD').querySelector('mf-status-badge')!.textContent).toContain('Waiting');
      expect(row('ON_HOLD').querySelector('[data-was]')!.textContent).toContain('was On Hold');
      expect(row('NEW').querySelector('[data-was]')).toBeNull();
      expect(TestBed.inject(LookupStore).statusLabel('ON_HOLD')).toBe('Waiting');
      // The count survives the rename.
      expect(row('ON_HOLD').querySelector('[data-tasks]')!.textContent).toContain('0');
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
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      (document.body.querySelector('[data-lookup-cancel] button') as HTMLElement).click();
      await settle();
      expect(leave.open()).toBe(true);
      leave.answer(true);
      await settle();
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { edit: null } }),
      );
      expect(row('NEW').textContent).toContain('New');
    });

    it('shows the duplicate-label message from the server and keeps the dialog open', async () => {
      const input = await edit('NEW', 'Completed');
      api.failNext = apiError(409, 'DUPLICATE_NAME', "A status labelled 'Completed' exists.", {
        displayLabel: [{ code: 'DUPLICATE', message: "A status labelled 'Completed' exists." }],
      });

      await submit(input);

      expect(dialog()!.textContent).toContain("A status labelled 'Completed' exists.");
      expect(document.body.querySelector('#status-label-name')).not.toBeNull();
    });

    it('previews a 50 character label without breaking out of the dialog', async () => {
      await edit('NEW', 'Waiting for the other side to answer our long letter');
      const preview = document.body.querySelector<HTMLElement>('[data-preview] mf-status-badge')!;
      expect(preview.textContent).toContain('Waiting for the other side');
    });
  });

  describe('as a status label manager without Task.View', () => {
    beforeEach(() => open(false, 'StatusLabel.Manage'));

    it('has no Tasks column, loads no priorities and shows no error or tab strip of its own', () => {
      expect(priorityApi.calls).toEqual([]);
      expect(el().querySelector('[data-tasks]')).toBeNull();
      expect(
        Array.from(el().querySelectorAll('thead th')).map((th) => th.textContent!.trim()),
      ).toEqual(['Status', 'Actions']);
      expect(el().querySelector('nav, [data-failure], [role="alert"]')).toBeNull();
      expect(el().querySelectorAll('[data-row]').length).toBe(5);
    });
  });

  describe('without StatusLabel.Manage', () => {
    beforeEach(() => open(true, 'Task.View'));

    it('is read-only: no menu, no dialog', async () => {
      expect(el().querySelectorAll('[data-row]').length).toBe(5);
      expect(el().querySelector('mf-action-menu button')).toBeNull();
      await setEdit('NEW');
      expect(document.body.querySelector('#status-label-name')).toBeNull();
    });
  });
});
