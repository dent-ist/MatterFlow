import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { MessageService } from 'primeng/api';
import { StubWorkflowLookup, WorkflowLookup } from '../../../core/lookups/workflow-lookup';
import { InMemoryTaskTypesApi } from './in-memory-task-types-api';
import { TaskTypeEditPage } from './task-type-edit-page';
import { TaskTypesApi } from './task-types-api';
import { TaskTypesPage } from './task-types-page';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }
  await fixture.whenStable();
}

function configure(...permissions: Permission[]): InMemoryTaskTypesApi {
  const api = new InMemoryTaskTypesApi();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: TaskTypesApi, useValue: api },
      { provide: WorkflowLookup, useClass: StubWorkflowLookup },
      { provide: MessageService, useValue: { add: vi.fn() } },
      provideFakeMe(
        new FakeMeApi(
          withPermissions(
            ...(permissions.length
              ? permissions
              : (['TaskType.Manage', 'Workflow.Manage'] as Permission[])),
          ),
        ),
      ),
    ],
  });
  return api;
}

describe('TaskTypesPage', () => {
  let fixture: ComponentFixture<TaskTypesPage>;
  let api: InMemoryTaskTypesApi;
  const el = (): HTMLElement => fixture.nativeElement;
  const row = (name: string): HTMLElement => el().querySelector(`[data-row="${name}"]`)!;

  /** Opens the row menu of a type and picks one entry (`data-action`). */
  async function pick(name: string, action: string): Promise<void> {
    row(name).querySelector<HTMLButtonElement>('button[data-overflow]')!.click();
    await settle(fixture);
    el().querySelector<HTMLButtonElement>(`[role=menuitem][data-action="${action}"]`)!.click();
    await settle(fixture);
  }

  beforeEach(async () => {
    api = configure();
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(TaskTypesPage);
    await settle(fixture);
  });

  it('offers Edit form and Deactivate in the row menu of an active type, Edit form and Activate for an inactive one', async () => {
    row('Data Processing').querySelector<HTMLButtonElement>('button[data-overflow]')!.click();
    await settle(fixture);
    const entries = () =>
      Array.from(el().querySelectorAll('[role=menuitem]')).map((i) =>
        i.getAttribute('data-action'),
      );
    expect(entries()).toEqual(['edit-form', 'deactivate']);
    const router = TestBed.inject(Router);
    const go = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    el().querySelector<HTMLButtonElement>('[data-action=edit-form]')!.click();
    expect(go).toHaveBeenCalledWith(['/admin/task-types', 1, 'form']);
  });

  it('lists task types with form status and the eligible workflows as chips, the default marked', () => {
    const r = row('Data Processing');
    expect(r.querySelector('[data-form-status]')!.textContent).toContain('Published');
    expect(r.querySelector('[data-form-status]')!.textContent).toContain('v1');
    const chips = Array.from(r.querySelectorAll('[data-assoc-chip]'));
    // The default first, with a star and the text "default"; the other one after it.
    expect(chips.map((c) => c.getAttribute('data-assoc-chip'))).toEqual([
      'Standard Processing',
      'Expedited Processing',
    ]);
    expect(chips[0].querySelector('.pi-star-fill')).not.toBeNull();
    expect(chips[0].querySelector('[data-assoc-default]')!.textContent).toBe('default');
    expect(chips[1].querySelector('[data-assoc-default]')).toBeNull();
    // Each chip opens the workflow's page; "Workflows (n)" opens the Workflows tab filtered to the type.
    expect(chips[0].querySelector('a')!.getAttribute('href')).toBe('/admin/workflows/1');
    expect(chips[1].querySelector('a')!.getAttribute('href')).toBe('/admin/workflows/2');
    expect(r.querySelector('[data-assoc-all]')!.textContent!.trim()).toBe('Workflows (2)');
    expect(r.querySelector('[data-assoc-all]')!.getAttribute('href')).toBe(
      '/admin/workflows?taskType=1',
    );
    expect(r.querySelector('[data-assoc-more]')).toBeNull();
    expect(r.querySelector('[data-warning]')).toBeNull();
  });

  it('shows each type with its icon in neutral colour before the name', () => {
    const icon = row('Data Processing').querySelector('mf-task-type-icon svg')!;
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('stroke')).toBe('currentColor');
  });

  it('searches, sorts and pages in the browser, hides inactive types by default and names the row actions', async () => {
    await new Promise<void>((resolve) =>
      api.create({ name: 'Collection', description: undefined }).subscribe(() => resolve()),
    );
    await (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    await settle(fixture);
    const names = () =>
      Array.from(el().querySelectorAll('tbody tr')).map((r) => r.getAttribute('data-row'));

    expect(names()).toContain('Collection');
    expect(el().querySelector('th[aria-sort="ascending"]')!.textContent).toContain('Name');
    expect(names()).toEqual([...names()].sort((a, b) => a!.localeCompare(b!)));

    fixture.componentRef.setInput('sort', '-name');
    await settle(fixture);
    expect(names()).toEqual([...names()].sort((a, b) => b!.localeCompare(a!)));

    await TestBed.inject(Router).navigateByUrl('/admin/task-types?name=COLLECTION');
    await settle(fixture);
    expect(names()).toContain('Collection');
    // One overflow button per row (#355) named after the row; the text links are gone.
    const cell = row('Collection').querySelector('td.mf-col-menu')!;
    expect(cell.querySelectorAll('button[data-overflow]')).toHaveLength(1);
    expect(cell.querySelector('button[data-overflow]')!.getAttribute('aria-label')).toBe(
      'Actions for Collection',
    );
    expect(
      row('Collection').querySelector('[data-deactivate], a[aria-label^="Edit the request"]'),
    ).toBeNull();

    await TestBed.inject(Router).navigateByUrl('/admin/task-types?name=no%20such%20type');
    await settle(fixture);
    expect(el().querySelector('[data-empty=filtered]')).not.toBeNull();
    expect(el().querySelector('thead th')).not.toBeNull(); // the headers stay
    expect(el().querySelector('[data-filter-row]')).not.toBeNull(); // opened by the address
  });

  it('filters by the request form status in the browser', async () => {
    await new Promise<void>((resolve) =>
      api.create({ name: 'Collection', description: undefined }).subscribe(() => resolve()),
    );
    await (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    await settle(fixture);
    const names = () =>
      Array.from(el().querySelectorAll('tbody tr')).map((r) => r.getAttribute('data-row'));
    expect(names()).toEqual(expect.arrayContaining(['Collection', 'Data Processing']));

    // Collection has no form yet; Data Processing has a published one.
    await TestBed.inject(Router).navigateByUrl('/admin/task-types?form=none');
    await settle(fixture);
    expect(names()).toEqual(['Collection']);
    await TestBed.inject(Router).navigateByUrl('/admin/task-types?form=published');
    await settle(fixture);
    expect(names()).toEqual(['Data Processing']);
    expect(
      el().querySelector<HTMLSelectElement>('[aria-label="Filter by Request form"]')!.value,
    ).toBe('published');
  });

  it('warns about a type without an eligible workflow and deactivates and reactivates', async () => {
    await new Promise<void>((resolve) =>
      api.create({ name: 'Collection', description: undefined }).subscribe(() => resolve()),
    );
    await (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    await settle(fixture);

    expect(row('Collection').querySelector('[data-warning]')!.textContent).toContain(
      "No eligible published workflow: users can't create tasks of this type.",
    );
    expect(row('Collection').querySelector('[data-form-status]')!.textContent).toContain('No form');
    // No workflow at all is said in the Workflows column too, as a warning for an active type.
    expect(row('Collection').querySelector('[data-assoc-empty]')!.textContent).toContain(
      'No workflow',
    );
    expect(row('Collection').querySelector('.ac__empty--warn')).not.toBeNull();

    await pick('Data Processing', 'deactivate');
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Deactivate task type' && b.closest('p-dialog, .p-dialog'),
    );
    expect(confirm).toBeDefined();
    confirm!.click();
    await settle(fixture);
    // Inactive types are hidden by the default Active filter; the announcement says what happened.
    expect(el().querySelector('[data-row="Data Processing"]')).toBeNull();
    expect(el().querySelector('[data-announce]')!.textContent).toContain(
      'Data Processing deactivated.',
    );

    fixture.componentRef.setInput('status', 'all');
    await settle(fixture);
    expect(row('Data Processing').textContent).toContain('Inactive');
    expect(row('Data Processing').querySelector('[data-warning]')).toBeNull();

    await pick('Data Processing', 'activate');
    expect(row('Data Processing').textContent).not.toContain('Inactive');
  }, 20_000);
});

describe('TaskTypesPage workflow chips and filter', () => {
  let fixture: ComponentFixture<TaskTypesPage>;
  let api: InMemoryTaskTypesApi;
  const el = (): HTMLElement => fixture.nativeElement;
  const row = (name: string): HTMLElement => el().querySelector(`[data-row="${name}"]`)!;
  const names = () =>
    Array.from(el().querySelectorAll('tbody tr')).map((r) => r.getAttribute('data-row'));

  async function create(name: string, eligible: number[], def?: number): Promise<void> {
    await new Promise<void>((resolve) =>
      api
        .create({
          name,
          description: undefined,
          eligibleWorkflowIds: eligible,
          defaultWorkflowDefinitionId: def,
        })
        .subscribe(() => resolve()),
    );
  }

  async function open(url = '/admin/task-types'): Promise<void> {
    api = configure();
    await TestBed.inject(AuthStore).ensureLoaded();
    await create('Collection', [1, 2, 3, 4], 3);
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    fixture = TestBed.createComponent(TaskTypesPage);
    await settle(fixture);
  }

  it('shows three chips then +n more that opens the Workflows tab filtered to the type', async () => {
    await open();
    const r = row('Collection');
    // The default (Collection and Review) leads, then by name; the fourth is behind "+1 more".
    expect(
      Array.from(r.querySelectorAll('[data-assoc-chip]')).map((c) =>
        c.getAttribute('data-assoc-chip'),
      ),
    ).toEqual(['Collection and Review', 'Expedited Processing', 'Production']);
    const more = r.querySelector<HTMLAnchorElement>('[data-assoc-more]')!;
    expect(more.textContent!.trim()).toBe('+1 more');
    expect(more.getAttribute('href')).toMatch(/^\/admin\/workflows\?taskType=\d+$/);
    expect(r.querySelector('[data-assoc-all]')!.textContent!.trim()).toBe('Workflows (4)');
  });

  it('limits the list to the types a workflow is eligible for, with a removable chip', async () => {
    await open('/admin/task-types?workflow=4');
    expect(names()).toEqual(['Collection']);
    expect(el().querySelector('[data-filtered-by]')!.textContent).toContain(
      'Filtered by workflow Production: 1 task type',
    );
    const remove = el().querySelector<HTMLButtonElement>(
      'button[aria-label="Remove filter Workflow: Production"]',
    )!;
    expect(remove).not.toBeNull();
    remove.click();
    await settle(fixture);
    expect(TestBed.inject(Router).url).toBe('/admin/task-types');
    expect(names()).toEqual(['Collection', 'Data Processing']);
    expect(el().querySelector('[data-assoc-filter]')).toBeNull();
  });

  it('shows plain chips, not links, without Workflow.Manage', async () => {
    api = configure('TaskType.Manage');
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(TaskTypesPage);
    await settle(fixture);
    const r = row('Data Processing');
    expect(r.querySelectorAll('[data-assoc-chip]')).toHaveLength(2);
    expect(r.querySelector('[data-assoc-chip] a')).toBeNull();
    expect(r.querySelector('[data-assoc-all]')).toBeNull();
  });
});

describe('TaskTypeEditPage', () => {
  let fixture: ComponentFixture<TaskTypeEditPage>;
  let api: InMemoryTaskTypesApi;
  let router: Router;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;

  async function open(id?: string): Promise<void> {
    api = configure();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(TaskTypeEditPage);
    if (id !== undefined) fixture.componentRef.setInput('id', id);
    await settle(fixture);
  }

  async function type(sel: string, value: string): Promise<void> {
    const input = q<HTMLInputElement>(sel);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
  }

  async function tick(workflowId: number, on: boolean): Promise<void> {
    const box = q<HTMLInputElement>(`[data-workflow="${workflowId}"]`);
    box.checked = on;
    box.dispatchEvent(new Event('change'));
    await settle(fixture);
  }

  async function save(): Promise<void> {
    q<HTMLButtonElement>('[data-save] button').click();
    await settle(fixture);
  }

  it('creates a task type with eligible workflows and a default, then opens it', async () => {
    await open();
    expect(q('[data-form-hint]').textContent).toContain('Save the task type first');

    await type('[data-name]', '  Collection  ');
    await tick(1, true);
    await tick(3, true);
    expect(q('[data-default]').querySelectorAll('option')).toHaveLength(3); // None + two eligible
    const select = q<HTMLSelectElement>('[data-default]');
    select.value = select.options[2].value;
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);

    await save();
    const created = await new Promise<{
      id: number;
      defaultWorkflowDefinitionId?: number;
      eligibleWorkflowIds: number[];
      name: string;
    }>((resolve) =>
      api.list().subscribe((all) => resolve(all.find((t) => t.name === 'Collection')!)),
    );
    expect(created.eligibleWorkflowIds).toEqual([1, 3]);
    expect(created.defaultWorkflowDefinitionId).toBe(3);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/task-types', created.id]);
  });

  it('requires an icon: new types start with the default and the chosen icon is saved', async () => {
    await open();
    expect(q('[data-icon-current]').textContent).toBe('Document');
    await type('[data-name]', 'Collection');

    q<HTMLButtonElement>('[data-icon-trigger]').click();
    await new Promise((r) => setTimeout(r, 80));
    fixture.detectChanges();
    document.querySelector<HTMLButtonElement>('[data-icon-dialog] [data-key="mail"]')!.click();
    await new Promise((r) => setTimeout(r, 80));
    await settle(fixture);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);

    await save();
    const created = await new Promise<{ iconKey: string }>((resolve) =>
      api.list().subscribe((all) => resolve(all.find((t) => t.name === 'Collection')!)),
    );
    expect(created.iconKey).toBe('mail');
  });

  it('shows the saved icon when editing', async () => {
    await open('1');
    expect(q('[data-icon-current]').textContent).toBe('Processing');
  });

  it('requires a name and shows the server duplicate-name message on the field', async () => {
    await open();
    await save();
    expect(q('[data-name-error]').textContent).toContain('Enter a name.');

    await type('[data-name]', 'data processing');
    await save();
    expect(q('[data-name-error]').textContent).toContain(
      "A task type named 'data processing' already exists.",
    );
    // The server message is in the summary too.
    expect(q('[data-summary]').textContent).toContain("A task type named 'data processing'");
  });

  it('validates like the Workflow and Step pages: summary at the top, icon in the message, focus on the first invalid field (#361)', async () => {
    await open();
    await save();
    expect(q('[data-summary]').getAttribute('role')).toBe('alert');
    expect(q('[data-summary]').textContent).toContain('Fix the following to save:');
    expect(q('[data-summary] li').textContent).toBe('Enter a name.');
    expect(q('[data-name-error] .pi-exclamation-circle')).not.toBeNull();
    expect(q('[data-name]').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(q('[data-name]'));
    // Typing clears the problems.
    await type('[data-name]', 'Collection');
    expect(el().querySelector('[data-summary]')).toBeNull();
  });

  it('edits an existing type: removing the default workflow clears the default', async () => {
    await open('1');
    expect(q<HTMLInputElement>('[data-name]').value).toBe('Data Processing');
    expect(q('[data-form-summary]').textContent).toContain('Published v1');
    expect(q<HTMLAnchorElement>('[data-open-form]').getAttribute('href')).toBe(
      '/admin/task-types/1/form',
    );
    expect(q<HTMLButtonElement>('[data-save] button').disabled).toBe(true);
    expect(q<HTMLInputElement>('[data-workflow="1"]').checked).toBe(true);
    expect(q<HTMLSelectElement>('[data-default]').selectedOptions[0].textContent!.trim()).toBe(
      'Standard Processing',
    );

    await tick(1, false);
    expect(q<HTMLSelectElement>('[data-default]').selectedOptions[0].textContent!.trim()).toBe(
      'None',
    );
    expect(q('[data-announce]').textContent).toContain('no longer the default workflow');

    await save();
    const saved = await new Promise<number[]>((resolve) =>
      api.get(1).subscribe((t) => resolve(t.eligibleWorkflowIds)),
    );
    expect(saved).toEqual([2]);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('explains why a type is not usable and offers a reload after a conflict', async () => {
    await open('1');
    await tick(1, false);
    await tick(2, false);
    await save();
    expect(q('[data-usability]').textContent).toContain('No eligible workflow is selected.');

    // Another admin saved in the meantime.
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
    expect(q<HTMLInputElement>('[data-workflow="3"]').checked).toBe(true);
  });
});

describe('TaskTypeEditPage workflow labels', () => {
  it('shows "not published yet" once, with the plain workflow name', async () => {
    configure();
    const fixture = TestBed.createComponent(TaskTypeEditPage);
    fixture.componentRef.setInput('id', '1');
    await settle(fixture);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Production (not published yet)');
    expect(text).not.toContain('(not published yet) (not published yet)');
  });
});
