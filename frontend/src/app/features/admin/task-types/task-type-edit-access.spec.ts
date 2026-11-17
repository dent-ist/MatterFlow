import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { StubWorkflowLookup, WorkflowLookup } from '../../../core/lookups/workflow-lookup';
import { NotificationService } from '../../../core/notify/notification.service';
import { ddChoose, ddText } from '../../../testing/dropdown-testing.spec-util';
import { FormDesignerApi } from './form-designer-api';
import { InMemoryFormDesignerApi } from './in-memory-form-designer-api';
import { InMemoryTaskTypesApi } from './in-memory-task-types-api';
import { TaskTypeEditPage } from './task-type-edit-page';
import { TaskTypesApi } from './task-types-api';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }
  await fixture.whenStable();
}

const problem = (status: number, code: string, detail: string): ApiError =>
  ApiError.from(new HttpErrorResponse({ status, error: { code, detail } }));

/**
 * The Access tab of the Task Type page (#1402): the three lists, the linked chips, the save with its preview and confirmation, the failure states and the
 * new-type flow. Role ids of the stub: 1 Attorney (the signed-in person holds it), 2 eDiscovery Analyst, 3 Paralegal, 4 Partner, 5 Project Manager,
 * 6 Vendor Liaison (inactive).
 */
describe('TaskTypeEditPage: Access (#1402)', () => {
  let fixture: ComponentFixture<TaskTypeEditPage>;
  let api: InMemoryTaskTypesApi;
  let router: Router;
  let navigate: ReturnType<typeof vi.spyOn>;
  let notify: NotificationService;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const dialog = (): HTMLElement | null => document.body.querySelector('.p-dialog');
  const dialogText = (): string => (dialog()?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const dialogButtons = (): string[] =>
    Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.p-dialog .mf-dlg__buttons button'),
    ).map((b) => b.textContent!.trim());
  const press = async (label: string): Promise<void> => {
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.p-dialog button'))
      .find((b) => b.textContent!.trim() === label)!
      .click();
    await settle(fixture);
  };

  async function open(
    id: string | undefined,
    seed?: (a: InMemoryTaskTypesApi) => void | Promise<void>,
    tab: string | undefined = 'access',
  ): Promise<void> {
    api = new InMemoryTaskTypesApi();
    await seed?.(api);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: TaskTypesApi, useValue: api },
        { provide: WorkflowLookup, useClass: StubWorkflowLookup },
        { provide: FormDesignerApi, useClass: InMemoryFormDesignerApi },
        provideFakeMe(new FakeMeApi(withPermissions('TaskType.Manage', 'Workflow.Manage'))),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    notify = TestBed.inject(NotificationService);
    fixture = TestBed.createComponent(TaskTypeEditPage);
    if (id !== undefined) fixture.componentRef.setInput('id', id);
    if (tab !== undefined) fixture.componentRef.setInput('tab', tab);
    await settle(fixture);
  }

  /** Makes type 1 restricted through the API, as an earlier save would have. */
  const restrict =
    (canView: number[], canEdit: number[] = [], canAssign: number[] = []) =>
    async (a: InMemoryTaskTypesApi): Promise<void> => {
      const t = await new Promise<{ rowVersion: string }>((r) => a.get(1).subscribe(r));
      await new Promise((r) =>
        a.replaceAccess(1, { canView, canEdit, canAssign, rowVersion: t.rowVersion }).subscribe(r),
      );
    };

  async function pick(label: string, value: string): Promise<void> {
    ddChoose(el(), label, value);
    document.body
      .querySelector<HTMLElement>('.dd-panel [role="listbox"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
  }

  const chips = (list: string): string[] =>
    Array.from(el().querySelectorAll(`[data-chips="${list}"] mf-tag-chip`)).map((c) =>
      c.textContent!.replace(/\s+/g, ' ').trim(),
    );
  const summary = (): string => q('[data-access-summary]').textContent!.trim();
  const save = async (): Promise<void> => {
    q<HTMLButtonElement>('[data-save]').click();
    await settle(fixture);
  };

  afterEach(() => {
    document.body.querySelectorAll('.p-dialog-mask, .dd-panel').forEach((n) => n.remove());
  });

  describe('the tab', () => {
    beforeEach(() => open('1'));

    it('is the fourth tab and shows three role lists that say what an empty list means', () => {
      const tabs = Array.from(el().querySelectorAll('[role=tab]')).map((t) =>
        t.textContent!.replace(/\s+/g, ' ').trim(),
      );
      expect(tabs[3]).toBe('Access');
      expect(q('[role=tab][aria-selected=true]').getAttribute('data-tab')).toBe('access');
      expect(ddText(el(), 'Can View')).toBe('Everyone (No Limit)');
      expect(ddText(el(), 'Can Edit')).toBe('No Extra Limit');
      expect(ddText(el(), 'Can Be Assigned')).toBe('No Extra Limit');
      expect(summary()).toBe('Open to everyone.');
      expect(el().querySelector('[data-footer]')).toBeNull();
      expect(q('[data-access-summary-card]').textContent).toContain('How access works');
    });

    it('shows the amber banner while the server does not enforce the rules', () => {
      expect(q('[data-not-enforced-banner]').textContent).toContain(
        'Access rules are saved but not enforced yet.',
      );
    });

    it('lists the roles in the first list, with an inactive one that cannot be newly chosen', async () => {
      ddText(el(), 'Can View');
      q<HTMLButtonElement>('mf-dropdown button').click();
      const rows = Array.from(
        document.body.querySelectorAll<HTMLElement>('.dd-panel [role=option]'),
      );
      expect(rows.map((r) => r.getAttribute('data-value'))).toEqual([
        '',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
      ]);
      expect(rows[6].getAttribute('aria-disabled')).toBe('true');
      expect(rows[0].textContent).toContain('Everyone (No Limit)');
    });

    it('puts a role chosen in Can Edit into Can View at once as a linked chip, and the summary restricts the type', async () => {
      await pick('Can Edit', '4');
      expect(chips('canEdit')).toEqual(['Partner']);
      expect(chips('canView')).toEqual(['Partner']);
      const linked = q('[data-chips="canView"] [data-linked]');
      expect(linked.getAttribute('aria-label')).toBe(
        'Partner is in Can Edit, so it can also view. Remove it from Can Edit first.',
      );
      expect(linked.querySelector('button')).toBeNull();
      expect(summary()).toBe(
        'Restricted: 1 role can view, 1 can edit, all viewers can be assigned.',
      );
      expect(q('[data-footer]')).not.toBeNull();
      // Removing it from Can Edit takes it out of Can View again (it was only there through the link).
      q<HTMLButtonElement>('[data-chips="canEdit"] [data-remove]').click();
      await settle(fixture);
      expect(chips('canView')).toEqual([]);
      expect(summary()).toBe('Open to everyone.');
      expect(el().querySelector('[data-footer]')).toBeNull();
    });

    it('removes a Can View chip and counts several roles', async () => {
      await pick('Can View', '1');
      await pick('Can View', '3');
      expect(ddText(el(), 'Can View')).toBe('Attorney +1');
      q<HTMLButtonElement>(
        '[data-chips="canView"] [data-remove="Paralegal"], [data-chips="canView"] button',
      ).click();
      await settle(fixture);
      expect(chips('canView')).toHaveLength(1);
    });

    it('asks first when leaving the tab with edits, and Cancel in the footer drops them', async () => {
      await pick('Can View', '1');
      q<HTMLButtonElement>('[data-cancel]').click();
      await settle(fixture);
      expect(summary()).toBe('Open to everyone.');
    });
  });

  describe('saving', () => {
    it('saves at once and says "Not enforced yet" when nobody loses anything and the switch is off', async () => {
      await open('1');
      const info = vi.spyOn(notify, 'info');
      await pick('Can View', '1'); // the signed-in person holds Attorney
      await save();
      expect(dialog()).toBeNull();
      expect(info).toHaveBeenCalledWith('Access rules saved', 'Not enforced yet.');
      const saved = await new Promise<{ access?: { canView: number[] } }>((r) =>
        api.get(1).subscribe(r),
      );
      expect(saved.access?.canView).toEqual([1]);
      // The header says it on every tab.
      expect(q('[data-page-title], mf-record-header').textContent).toContain('Restricted');
      expect(el().querySelector('[data-footer]')).toBeNull();
    });

    it('toasts a plain success when the server enforces the rules', async () => {
      await open('1', (a) => {
        a.enforced = true;
      });
      const success = vi.spyOn(notify, 'success');
      await pick('Can View', '1');
      expect(el().querySelector('[data-not-enforced-banner]')).toBeNull();
      await save();
      expect(success).toHaveBeenCalledWith('Access rules saved');
    });

    it('confirms when people lose view: lead, fact lines, closing sentence, Cancel on the left', async () => {
      await open('1', async (a) => {
        a.enforced = true;
        await restrict([1, 4])(a);
      });
      await pick('Can View', '4'); // takes Partner out
      await save();
      expect(dialogText()).toContain('Save Access Rules');
      expect(dialogText()).toContain('This will hide the task type from 6 people.');
      expect(dialogText()).toContain(
        'will no longer appear for them in lists, counts, search or notifications.',
      );
      expect(dialogText()).toContain('You can change the access again at any time.');
      expect(dialogButtons()).toEqual(['Cancel', 'Save Access Rules']);
      expect(document.body.querySelector('.p-dialog .mf-btn--solid')).toBeNull();
      await press('Save Access Rules');
      expect(document.body.querySelector('[data-access-lead]')).toBeNull();
      const saved = await new Promise<{ access?: { canView: number[] } }>((r) =>
        api.get(1).subscribe(r),
      );
      expect(saved.access?.canView).toEqual([1]);
    });

    it('Cancel in the question saves nothing and keeps the edits', async () => {
      await open('1', async (a) => {
        a.enforced = true;
        await restrict([1, 4])(a);
      });
      await pick('Can View', '4');
      await save();
      await press('Cancel');
      const saved = await new Promise<{ access?: { canView: number[] } }>((r) =>
        api.get(1).subscribe(r),
      );
      expect(saved.access?.canView).toEqual([1, 4]);
      expect(summary()).toContain('Restricted: 1 role can view');
      expect(q('[data-footer]')).not.toBeNull();
    });

    it('says the type becomes open to everyone', async () => {
      await open('1', async (a) => {
        a.enforced = true;
        await restrict([1])(a);
      });
      q<HTMLButtonElement>('[data-chips="canView"] button').click();
      await settle(fixture);
      expect(summary()).toBe('Open to everyone.');
      await save();
      expect(dialogText()).toContain('This makes the task type open to everyone.');
      expect(dialogText()).toContain(
        'Everyone who can use tasks will be able to see and use Data Processing',
      );
    });

    it('turns the confirm red and says it cannot be undone by the person when they lose access themselves', async () => {
      await open('1', (a) => {
        a.enforced = true;
      });
      await pick('Can View', '4'); // Partner only: the signed-in Attorney is out
      await save();
      expect(dialogText()).toContain('You will lose access yourself.');
      expect(dialogText()).toContain('Only a System Admin can change it back.');
      expect(dialogText()).not.toContain('You can change the access again at any time.');
      expect(document.body.querySelector('.p-dialog .mf-btn--solid')).not.toBeNull();
    });

    it('while the switch is off the question says nobody loses access today and is not red', async () => {
      await open('1', restrict([1, 4]));
      await pick('Can View', '4');
      await save();
      expect(dialogText()).toContain(
        'These rules are saved but not enforced yet, so nobody loses access today.',
      );
      expect(dialogText()).toContain(
        'When Task Type Access is switched on, this will hide Data Processing from 6 people',
      );
      expect(document.body.querySelector('.p-dialog .mf-btn--solid')).toBeNull();
    });

    it('blocks the save when the preview fails: Cancel and Retry only, and Retry asks again', async () => {
      await open('1', (a) => {
        a.enforced = true;
      });
      await pick('Can View', '1');
      api.failNext.preview = problem(500, 'SERVER_ERROR', 'boom');
      await save();
      expect(dialogText()).toContain("Couldn't check who is affected. Nothing was saved.");
      expect(dialogButtons()).toEqual(['Cancel', 'Retry']);
      const before = await new Promise<{ access?: { canView: number[] } }>((r) =>
        api.get(1).subscribe(r),
      );
      expect(before.access?.canView).toEqual([]);
      await press('Retry');
      expect(dialog()).toBeNull();
      const after = await new Promise<{ access?: { canView: number[] } }>((r) =>
        api.get(1).subscribe(r),
      );
      expect(after.access?.canView).toEqual([1]);
    });

    it('keeps the question open with the reason when the save itself fails', async () => {
      await open('1', async (a) => {
        a.enforced = true;
        await restrict([1, 4])(a);
      });
      await pick('Can View', '4');
      await save();
      api.failNext.replace = problem(500, 'SERVER_ERROR', 'The database is busy.');
      await press('Save Access Rules');
      expect(dialog()).not.toBeNull();
      expect(dialog()!.querySelector('[data-confirm-error]')!.textContent).toContain(
        'The database is busy.',
      );
      await press('Save Access Rules');
      expect(document.body.querySelector('[data-access-lead]')).toBeNull();
    });

    it('shows the failure line when the save fails and no question was open', async () => {
      await open('1');
      await pick('Can View', '1');
      api.failNext.replace = problem(500, 'SERVER_ERROR', 'The database is busy.');
      await save();
      expect(q('[data-failure]').textContent).toContain(
        "Couldn't save the access rules. The database is busy.",
      );
      expect(q('[data-footer]')).not.toBeNull();
    });

    it('shows the stale line when someone else changed the type, and Reload Latest takes theirs', async () => {
      await open('1');
      await pick('Can View', '1');
      api.failNext.replace = problem(
        409,
        'CONCURRENCY_CONFLICT',
        'Someone else changed this item.',
      );
      await save();
      expect(q('[data-conflict]').textContent).toContain('Someone else changed this task type.');
      q<HTMLButtonElement>('[data-reload]').click();
      await settle(fixture);
      expect(el().querySelector('[data-conflict]')).toBeNull();
      expect(summary()).toBe('Open to everyone.');
    });

    it('shows a role the server refused under its list', async () => {
      await open('1');
      await pick('Can View', '1');
      api.failNext.replace = ApiError.from(
        new HttpErrorResponse({
          status: 400,
          error: {
            code: 'VALIDATION_FAILED',
            detail: 'Role not found',
            errors: {
              canView: [{ code: 'ROLE_NOT_FOUND', message: 'One of the roles no longer exists.' }],
            },
          },
        }),
      );
      await save();
      expect(q('[data-error="canView"]').textContent).toContain(
        'One of the roles no longer exists.',
      );
    });
  });

  describe('loading and failing', () => {
    it('offers Retry when the lists cannot be loaded and loads them on Retry', async () => {
      await open('1', (a) => {
        a.failNext.get = problem(500, 'SERVER_ERROR', 'boom');
      });
      expect(q('[data-access-error]').textContent).toContain("Couldn't load the access rules.");
      q<HTMLButtonElement>('[data-access-error] button').click();
      await settle(fixture);
      expect(el().querySelector('[data-access-error]')).toBeNull();
      expect(ddText(el(), 'Can View')).toBe('Everyone (No Limit)');
    });

    it('marks an inactive role that is already in a list with an amber chip and a note in the summary card', async () => {
      await open('1', (a) => a.setAccess(1, { canView: [6] }));
      expect(chips('canView')).toEqual(['Vendor Liaison (inactive)']);
      expect(q('[data-inactive-note]').textContent).toContain(
        'only a System Admin can see this task type',
      );
    });
  });

  describe('a new task type', () => {
    async function openNew(): Promise<void> {
      await open(undefined, undefined, '');
      const name = q<HTMLInputElement>('#tt-name');
      name.value = 'Privilege Review';
      name.dispatchEvent(new Event('input'));
      await settle(fixture);
    }
    const toAccess = async (): Promise<void> => {
      fixture.componentRef.setInput('tab', 'access');
      await settle(fixture);
    };

    it('offers the Access tab and creates the type first, then saves the rules, landing on Workflows', async () => {
      await openNew();
      await toAccess();
      expect(el().querySelector('[data-not-enforced-banner]')).toBeNull(); // unknown for a type that does not exist yet
      await pick('Can View', '1');
      const replace = vi.spyOn(api, 'replaceAccess');
      await save();
      expect(replace).toHaveBeenCalledTimes(1);
      const [id, body] = replace.mock.calls[0];
      expect(body).toMatchObject({ canView: [1], canEdit: [], canAssign: [] });
      expect(navigate).toHaveBeenLastCalledWith(['/admin/task-types', id], {
        queryParams: { tab: 'workflows' },
        replaceUrl: true,
      });
    });

    it('does not call the access endpoint for an open type', async () => {
      await openNew();
      const replace = vi.spyOn(api, 'replaceAccess');
      await save();
      expect(replace).not.toHaveBeenCalled();
    });

    it('creates the type, says the rules were not saved and carries them to its Access tab when that second step fails', async () => {
      await openNew();
      await toAccess();
      await pick('Can Edit', '4');
      api.failNext.replace = problem(500, 'SERVER_ERROR', 'boom');
      const error = vi.spyOn(notify, 'error');
      await save();
      expect(error).toHaveBeenCalledWith(
        'Task type created, but its access rules were not saved.',
        'Open the Access tab and save them again.',
      );
      const [, extras] = navigate.mock.calls[navigate.mock.calls.length - 1] as [
        unknown[],
        { queryParams: { tab: string }; state: { accessDraft: unknown } },
      ];
      expect(extras.queryParams.tab).toBe('access');
      expect(extras.state.accessDraft).toEqual({ canView: [4], canEdit: [4], canAssign: [] });
    });
  });
});
