import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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

function configure(): InMemoryTaskTypesApi {
  const api = new InMemoryTaskTypesApi();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: TaskTypesApi, useValue: api },
      { provide: WorkflowLookup, useClass: StubWorkflowLookup },
      { provide: MessageService, useValue: { add: vi.fn() } },
    ],
  });
  return api;
}

describe('TaskTypesPage', () => {
  let fixture: ComponentFixture<TaskTypesPage>;
  let api: InMemoryTaskTypesApi;
  const el = (): HTMLElement => fixture.nativeElement;
  const row = (name: string): HTMLElement => el().querySelector(`[data-row="${name}"]`)!;

  beforeEach(async () => {
    api = configure();
    fixture = TestBed.createComponent(TaskTypesPage);
    await settle(fixture);
  });

  it('lists task types with form status, eligible count and the default workflow name', () => {
    const r = row('Data Processing');
    expect(r.querySelector('[data-form-status]')!.textContent).toContain('Published');
    expect(r.querySelector('[data-form-status]')!.textContent).toContain('v1');
    expect(r.querySelector('[data-eligible-count]')!.textContent!.trim()).toBe('2');
    expect(r.querySelector('[data-default]')!.textContent!.trim()).toBe('Standard Processing');
    expect(r.querySelector('[data-warning]')).toBeNull();
    expect(
      r
        .querySelector<HTMLAnchorElement>('a[aria-label^="Design the request form"]')!
        .getAttribute('href'),
    ).toBe('/admin/task-types/1/form');
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

    fixture.componentRef.setInput('q', 'COLLECTION');
    await settle(fixture);
    expect(names()).toContain('Collection');
    const actions = row('Collection').querySelector('.mf-row-actions')!;
    expect(Array.from(actions.querySelectorAll('[aria-label]')).map((a) => a.ariaLabel)).toEqual([
      'Design the request form of Collection',
      'Edit Collection',
      'Deactivate Collection',
    ]);

    fixture.componentRef.setInput('q', 'no such type');
    await settle(fixture);
    expect(el().querySelector('[data-empty=filtered]')).not.toBeNull();
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

    row('Data Processing').querySelector<HTMLButtonElement>('[data-deactivate]')!.click();
    await settle(fixture);
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

    row('Data Processing').querySelector<HTMLButtonElement>('[data-activate]')!.click();
    await settle(fixture);
    expect(row('Data Processing').textContent).not.toContain('Inactive');
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

  it('requires a name and shows the server duplicate-name message on the field', async () => {
    await open();
    await save();
    expect(q('[data-name-error]').textContent).toContain('Enter a name.');

    await type('[data-name]', 'data processing');
    await save();
    expect(q('[data-name-error]').textContent).toContain(
      "A task type named 'data processing' already exists.",
    );
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
