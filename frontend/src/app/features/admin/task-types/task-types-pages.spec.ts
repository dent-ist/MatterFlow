import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { MessageService } from 'primeng/api';
import { StubWorkflowLookup, WorkflowLookup } from '../../../core/lookups/workflow-lookup';
import { InMemoryTaskTypesApi } from './in-memory-task-types-api';
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
    expect(go).toHaveBeenCalledWith(['/admin/task-types', 1, 'form'], {
      state: { returnTo: expect.any(String) },
    });
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
    // The name is the row link of the list (#354): Back puts focus on it again.
    const link = r.querySelector<HTMLAnchorElement>('a[data-row-key]')!;
    expect(link.getAttribute('data-row-list')).toBe('admin-task-types');
    expect(link.getAttribute('data-row-key')).toBe('1');
    expect(link.getAttribute('href')).toBe('/admin/task-types/1');
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
