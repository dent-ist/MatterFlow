import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { StubWorkflowLookup, WorkflowLookup } from '../../../core/lookups/workflow-lookup';
import { LeaveConfirmService } from '../../../shared/guards/unsaved-changes.guard';
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

describe('TaskTypeEditPage', () => {
  let fixture: ComponentFixture<TaskTypeEditPage>;
  let api: InMemoryTaskTypesApi;
  let router: Router;
  let navigate: ReturnType<typeof vi.spyOn>;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>(sel));

  async function open(
    id?: string,
    tab?: string,
    permissions: Permission[] = ['TaskType.Manage', 'Workflow.Manage', 'Audit.View'],
    seed?: (api: InMemoryTaskTypesApi) => Promise<void>,
  ): Promise<void> {
    api = new InMemoryTaskTypesApi();
    await seed?.(api);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: TaskTypesApi, useValue: api },
        { provide: WorkflowLookup, useClass: StubWorkflowLookup },
        { provide: FormDesignerApi, useClass: InMemoryFormDesignerApi },
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(TaskTypeEditPage);
    if (id !== undefined) fixture.componentRef.setInput('id', id);
    if (tab !== undefined) fixture.componentRef.setInput('tab', tab);
    await settle(fixture);
  }

  async function type(sel: string, value: string): Promise<void> {
    const input = q<HTMLInputElement>(sel);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
  }

  async function save(): Promise<void> {
    q<HTMLButtonElement>('[data-save]').click();
    await settle(fixture);
  }

  /** A second type without workflows or form (not usable). */
  const addCollection = (a: InMemoryTaskTypesApi): Promise<void> =>
    new Promise((resolve) =>
      a.create({ name: 'Collection', description: undefined }).subscribe(() => resolve()),
    );

  async function saved(id: number) {
    return new Promise<{
      name: string;
      description?: string;
      eligibleWorkflowIds: number[];
      defaultWorkflowDefinitionId?: number;
      isActive: boolean;
    }>((resolve) => api.get(id).subscribe(resolve));
  }

  describe('the record header, strip and tabs (#380, #381)', () => {
    beforeEach(() => open('1'));

    it('shows the name, the Active badge, Edit and the primary Edit form last (Activity too where the width allows it)', () => {
      expect(q('[data-page-title]').textContent).toContain('Data Processing');
      expect(q('[data-status-badge], mf-active-badge').textContent).toContain('Active');
      const ids = all('[data-page-actions] button[data-action]').map((b) =>
        b.getAttribute('data-action'),
      );
      // The buttons that fit the window are in the header (Activity moves to the overflow on a narrow one); Edit form is always one.
      expect(ids[ids.length - 1]).toBe('edit-form');
      expect(ids).toContain('edit');
      expect(q('[data-action="edit-form"]').classList).toContain('mf-btn--primary');
    });

    it('has the three tabs with the count of active workflows, Overview open and no footer while nothing changed', () => {
      expect(all('[role=tab]').map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
        'Overview',
        'Workflows (2)',
        'Request form',
      ]);
      expect(q('[role=tab][aria-selected=true]').getAttribute('data-tab')).toBe('overview');
      expect(el().querySelector('[data-footer]')).toBeNull();
      expect(q<HTMLInputElement>('#tt-name').value).toBe('Data Processing');
    });

    it('shows the summary strip: Form, Workflows, Default workflow and Status; Open tasks only with a number', () => {
      const strip = all('[data-strip-item]').map((i) => i.getAttribute('data-strip-item'));
      expect(strip).toEqual(['form', 'workflows', 'default', 'status']);
      expect(q('[data-strip-item=form]').textContent).toContain('Published v1');
      expect(q('[data-strip-item=default]').textContent).toContain('Standard Processing');
    });

    it('does not show the status note for a usable type', () => {
      expect(el().querySelector('[data-status-note]')).toBeNull();
    });

    it('opens Deactivate in the overflow with the dialog, and Activate straight away', async () => {
      q<HTMLButtonElement>('[data-page-actions] button[data-overflow]').click();
      await settle(fixture);
      q<HTMLElement>('[role=menuitem][data-action="deactivate"]').click();
      await settle(fixture);
      const confirm = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Deactivate task type' && b.closest('.p-dialog'),
      );
      expect(confirm).toBeDefined();
      confirm!.click();
      await settle(fixture);
      expect((await saved(1)).isActive).toBe(false);
      expect(q('[data-status-badge]').textContent).toContain('Inactive');
      expect(q('[data-status-note]').textContent).toContain('The task type is inactive.');

      q<HTMLButtonElement>('[data-page-actions] button[data-overflow]').click();
      await settle(fixture);
      q<HTMLElement>('[role=menuitem][data-action="activate"]').click();
      await settle(fixture);
      expect((await saved(1)).isActive).toBe(true);
      expect(q('[data-status-badge], mf-active-badge').textContent).toContain('Active');
    }, 20_000);

    it('goes to the form designer from the header primary and carries the list view on', async () => {
      q<HTMLButtonElement>('[data-action="edit-form"]').click();
      await settle(fixture);
      expect(navigate).toHaveBeenCalledWith(['/admin/task-types', 1, 'form'], {
        state: { keepRow: true },
      });
    });

    it('replaces the address for a tab and does not add a history entry', async () => {
      q<HTMLElement>('[data-tab="workflows"]').click();
      await settle(fixture);
      expect(navigate).toHaveBeenCalledWith([], {
        queryParams: { tab: 'workflows' },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    it('shows no Activity button without Audit.View', async () => {
      TestBed.resetTestingModule();
      await open('1', undefined, ['TaskType.Manage']);
      expect(
        all('[data-page-actions] button[data-action]').map((b) => b.dataset['action']),
      ).toEqual(['edit', 'edit-form']);
    });
  });

  describe('a new type (#381, #380)', () => {
    beforeEach(() => open());

    it('has a header without strip or badge, the Request form tab disabled with its reason, and the footer', () => {
      expect(q('[data-page-title]').textContent).toContain('New task type');
      expect(el().querySelector('[data-strip]')).toBeNull();
      expect(el().querySelector('[data-status-badge], mf-active-badge')).toBeNull();
      expect(el().querySelector('[data-page-actions] [data-action]')).toBeNull();
      const form = q('[data-tab="form"]');
      expect(form.getAttribute('aria-disabled')).toBe('true');
      expect(el().textContent).toContain('Save the task type first');
      expect(q('[data-save]').textContent).toContain('Create task type');
    });

    it('creates the type with its workflows and lands on the Workflows tab', async () => {
      await type('#tt-name', '  Collection  ');
      q<HTMLElement>('[data-tab="workflows"]').click();
      await settle(fixture);
      expect(navigate).toHaveBeenCalled();
      // The router is mocked: show the Workflows tab as the address would.
      fixture.componentRef.setInput('tab', 'workflows');
      await settle(fixture);
      const input = q<HTMLInputElement>('[data-add-input]');
      input.click();
      await settle(fixture);
      q<HTMLElement>('[data-option="3"]').dispatchEvent(new Event('mousedown'));
      await settle(fixture);
      expect(q('[data-workflow="3"] input[type=radio]')).not.toBeNull();
      await save();
      const list = await new Promise<
        { id: number; name: string; defaultWorkflowDefinitionId?: number }[]
      >((resolve) => api.list().subscribe(resolve));
      const created = list.find((t) => t.name === 'Collection')!;
      expect(created.defaultWorkflowDefinitionId).toBe(3);
      expect(navigate).toHaveBeenLastCalledWith(['/admin/task-types', created.id], {
        queryParams: { tab: 'workflows' },
        replaceUrl: true,
      });
    });

    it('requires a name and shows the summary, the icon and focus (#361)', async () => {
      await save();
      expect(q('[data-summary]').textContent).toContain('Fix the following to save:');
      expect(q('[data-summary] li').textContent).toBe('Enter a name.');
      expect(q('[data-name-error] .pi-exclamation-circle')).not.toBeNull();
      expect(q('#tt-name').getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(q('#tt-name'));
      await type('#tt-name', 'Collection');
      expect(el().querySelector('[data-summary]')).toBeNull();
    });

    it('shows the server duplicate-name message on the field', async () => {
      await type('#tt-name', 'data processing');
      await save();
      expect(q('[data-name-error]').textContent).toContain(
        "A task type named 'data processing' already exists.",
      );
    });

    it('counts the name and the description as n / 100 and n / 1000 (#386)', async () => {
      expect(q('#tt-name-count').textContent).toBe('0 / 100');
      await type('#tt-name', 'A'.repeat(92));
      expect(q('#tt-name-count').textContent).toBe('92 / 100');
      expect(q('#tt-name').getAttribute('aria-describedby')).toContain('tt-name-count');
      expect(q('mf-char-counter [data-char-count-live]').textContent).toContain(
        '92 of 100 characters',
      );
      expect(q('#tt-description-count').textContent).toBe('0 / 1000');
    });
  });

  describe('each tab saves on its own (#381)', () => {
    beforeEach(() => open('1'));

    it('saves the Overview edits and leaves the workflows as they were saved', async () => {
      await type('[data-description]', 'Edited');
      expect(q('[data-footer]')).not.toBeNull();
      expect(q('[data-save]').textContent).toContain('Save changes');
      await save();
      const t = await saved(1);
      expect(t.description).toBe('Edited');
      expect(t.eligibleWorkflowIds).toEqual([1, 2]);
      expect(t.defaultWorkflowDefinitionId).toBe(1);
      expect(el().querySelector('[data-footer]')).toBeNull();
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    });

    it('Cancel drops the edits of the open tab', async () => {
      await type('#tt-name', 'Something else');
      q<HTMLButtonElement>('[data-cancel]').click();
      await settle(fixture);
      expect(q<HTMLInputElement>('#tt-name').value).toBe('Data Processing');
      expect(el().querySelector('[data-footer]')).toBeNull();
    });

    it('asks before leaving a tab with edits: Stay keeps it, Leave drops the edits', async () => {
      await type('#tt-name', 'Something else');
      const leave = TestBed.inject(LeaveConfirmService);
      const asked = vi.spyOn(leave, 'ask').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      q<HTMLElement>('[data-tab="workflows"]').click();
      await settle(fixture);
      expect(asked).toHaveBeenCalledTimes(1);
      expect(asked.mock.calls[0][0]).toMatchObject({ label: 'Save and leave' });
      expect(navigate).not.toHaveBeenCalled();
      expect(q<HTMLInputElement>('#tt-name').value).toBe('Something else');

      q<HTMLElement>('[data-tab="workflows"]').click();
      await settle(fixture);
      expect(navigate).toHaveBeenCalled();
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    });

    it('Save and leave of the question saves the tab', async () => {
      await type('#tt-name', 'Renamed');
      expect(await fixture.componentInstance.saveForLeave()).toBe(true);
      expect((await saved(1)).name).toBe('Renamed');
    });

    it('Save and leave stays when the save fails', async () => {
      await type('#tt-name', '   ');
      expect(await fixture.componentInstance.saveForLeave()).toBe(false);
    });

    it('offers a reload after a conflict', async () => {
      const current = await new Promise<{ rowVersion: string }>((resolve) =>
        api.get(1).subscribe(resolve),
      );
      await new Promise<void>((resolve) =>
        api
          .update(1, {
            name: 'Data Processing',
            description: undefined,
            iconKey: 'cpu-2',
            isActive: true,
            eligibleWorkflowIds: [3],
            defaultWorkflowDefinitionId: undefined,
            rowVersion: current.rowVersion,
          })
          .subscribe(() => resolve()),
      );
      await type('[data-description]', 'Edited');
      await save();
      expect(q('[data-conflict]')).not.toBeNull();
      q<HTMLButtonElement>('[data-reload]').click();
      await settle(fixture);
      expect(el().querySelector('[data-conflict]')).toBeNull();
      expect(q<HTMLInputElement>('[data-description]').value).toBe('');
    });
  });

  describe('the Workflows tab (#382, #383)', () => {
    beforeEach(() => open('1', 'workflows'));

    it('lists the chosen workflows with the Default radio, a link and Remove with a name', () => {
      expect(all('[data-workflows] tbody tr')).toHaveLength(2);
      const row = q('[data-workflow="1"]');
      expect(row.textContent).toContain('Standard Processing');
      expect(row.querySelector<HTMLInputElement>('input[type=radio]')!.checked).toBe(true);
      expect(q('[data-workflow="2"] input[type=radio]')).not.toBeNull();
      expect(row.querySelector('[data-remove]')!.getAttribute('aria-label')).toBe(
        'Remove Standard Processing',
      );
      expect(row.querySelector('a')!.getAttribute('href')).toBe('/admin/workflows/1');
    });

    it('changes the default with the radio and says so', async () => {
      q<HTMLInputElement>('[data-default-radio="2"]').click();
      await settle(fixture);
      expect(q('[data-announce]').textContent).toContain(
        'Expedited Processing is now the default workflow.',
      );
      await save();
      expect((await saved(1)).defaultWorkflowDefinitionId).toBe(2);
    });

    it('removing the default moves the default to the next workflow and announces it', async () => {
      q<HTMLButtonElement>('[data-remove="1"]').click();
      await settle(fixture);
      expect(q('[data-announce]').textContent).toContain(
        'Standard Processing removed. Expedited Processing is now the default workflow.',
      );
      expect(q<HTMLInputElement>('[data-default-radio="2"]').checked).toBe(true);
      expect(el().querySelector('[data-workflow="1"]')).toBeNull();
      expect(document.activeElement).toBe(q('[data-remove="2"]'));
      await save();
      const t = await saved(1);
      expect(t.eligibleWorkflowIds).toEqual([2]);
      expect(t.defaultWorkflowDefinitionId).toBe(2);
    });

    it('removing the last workflow leaves no default and puts focus on the search', async () => {
      q<HTMLButtonElement>('[data-remove="1"]').click();
      await settle(fixture);
      q<HTMLButtonElement>('[data-remove="2"]').click();
      await settle(fixture);
      expect(q('[data-announce]').textContent).toContain('There is no default workflow.');
      expect(q('[data-no-workflows]')).not.toBeNull();
      expect(document.activeElement).toBe(q('[data-add-input]'));
    });

    it('updates the tab count live and keeps the strip at the saved number', async () => {
      q<HTMLButtonElement>('[data-remove="2"]').click();
      await settle(fixture);
      expect(q('[data-tab="workflows"]').textContent).toContain('(1)');
      expect(q('[data-strip-item=workflows]').textContent).toContain('2');
    });

    it('offers a searchable list: published and active first, the rest disabled with their reason, added ones hidden', async () => {
      const input = q<HTMLInputElement>('[data-add-input]');
      input.click();
      await settle(fixture);
      const options = all('[data-add-list] [role=option]');
      expect(options.map((o) => o.getAttribute('data-option'))).toEqual(['3', '4']);
      expect(options[0].getAttribute('aria-disabled')).toBeNull();
      expect(options[1].getAttribute('aria-disabled')).toBe('true');
      expect(options[1].querySelector('[data-option-reason]')!.textContent).toBe(
        'No published version',
      );

      await type('[data-add-input]', 'prod');
      expect(all('[data-add-list] [role=option]')).toHaveLength(1);
      expect(q('[data-add-list] [role=option]').textContent).toContain('Production');
      expect(q('[data-add-list] [data-option-reason]').textContent).toBe('No published version');
      await type('[data-add-input]', 'zzz');
      expect(q('[data-add-empty]').textContent).toContain('No workflows match.');
    });

    it('shows at most eight entries and says how many more a search would narrow down to', async () => {
      const input = q<HTMLInputElement>('[data-add-input]');
      input.click();
      await settle(fixture);
      expect(all('[data-add-list] [role=option]')).toHaveLength(2);
      expect(el().querySelector('[data-add-more]')).toBeNull();
    });

    it('adds with the keyboard (arrows, Enter) and ignores Enter on a disabled entry', async () => {
      const input = q<HTMLInputElement>('[data-add-input]');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await settle(fixture);
      expect(input.getAttribute('aria-expanded')).toBe('true');
      expect(input.getAttribute('aria-activedescendant')).toMatch(/-opt-0$/);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await settle(fixture);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle(fixture);
      expect(el().querySelector('[data-workflow="4"]')).toBeNull(); // the disabled one
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await settle(fixture);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle(fixture);
      expect(q('[data-workflow="3"]')).not.toBeNull();
      expect(q('[data-announce]').textContent).toContain('Collection and Review added.');
      expect(q('[data-announce]').textContent).not.toContain('default');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(fixture);
      expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('the first workflow added becomes the default', async () => {
      q<HTMLButtonElement>('[data-remove="1"]').click();
      await settle(fixture);
      q<HTMLButtonElement>('[data-remove="2"]').click();
      await settle(fixture);
      q<HTMLInputElement>('[data-add-input]').click();
      await settle(fixture);
      q<HTMLElement>('[data-option="1"]').dispatchEvent(new Event('mousedown'));
      await settle(fixture);
      expect(q('[data-announce]').textContent).toContain(
        'Standard Processing added and is now the default workflow.',
      );
      expect(q<HTMLInputElement>('[data-default-radio="1"]').checked).toBe(true);
    });

    it('marks a workflow without a published version and does not link names without Workflow.Manage', async () => {
      TestBed.resetTestingModule();
      await open('1', 'workflows', ['TaskType.Manage']);
      expect(el().querySelector('[data-wf-link]')).toBeNull();
      expect(q('[data-workflow="1"]').textContent).toContain('Standard Processing');
    });
  });

  describe('why a type is not usable (#384)', () => {
    it('names each reason with its fix, in one note', async () => {
      await open('2', undefined, undefined, addCollection);
      const note = q('[data-status-note]');
      expect(all('[data-status-note]')).toHaveLength(1);
      expect(note.getAttribute('role')).toBe('note');
      expect(note.textContent).toContain('Not usable for new tasks yet.');
      expect(q('[data-reason=NO_ELIGIBLE_WORKFLOW]').textContent).toContain(
        'No eligible published workflow.',
      );
      expect(q('[data-reason=NO_ELIGIBLE_WORKFLOW] [data-note-fix]').textContent).toContain(
        'Add one',
      );
      expect(q('[data-status-badge]').textContent).toContain('Not usable');
    });
  });

  describe('the Request form tab (#385)', () => {
    it('shows the published version, the Edit form button and no old link wording', async () => {
      await open('1', 'form');
      expect(q('[data-form-published]').textContent).toContain('Published v1');
      expect(q('[data-open-form]').textContent).toContain('Edit form');
      expect(el().textContent).not.toContain('Open the form designer');
      q<HTMLButtonElement>('[data-open-form]').click();
      await settle(fixture);
      expect(navigate).toHaveBeenCalledWith(['/admin/task-types', 1, 'form'], {
        state: { keepRow: true },
      });
    });

    it('says there is no form yet and offers Create form', async () => {
      await open('2', 'form', undefined, addCollection);
      expect(q('[data-form-none]').textContent).toContain('No form yet');
      expect(q('[data-open-form]').textContent).toContain('Create form');
    });
  });
});
