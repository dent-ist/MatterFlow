import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { StubWorkflowLookup, WorkflowLookup } from '../../../core/lookups/workflow-lookup';
import { InMemoryTaskTypesApi } from './in-memory-task-types-api';
import { TaskTypeView, TaskTypesApi } from './task-types-api';
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

describe('TaskTypesPage deactivate dialog impact (#379)', () => {
  const type = (id: number, name: string, over: Partial<TaskTypeView> = {}): TaskTypeView => ({
    id,
    name,
    description: undefined,
    iconKey: 'cpu-2',
    isActive: true,
    defaultWorkflowDefinitionId: 1,
    eligibleWorkflowIds: [1],
    formDefinitionId: id,
    formStatus: undefined,
    publishedFormVersionId: undefined,
    publishedFormVersionNo: undefined,
    draftFormVersionNo: undefined,
    hasFormFields: false,
    isUsable: true,
    usabilityIssues: [],
    rowVersion: 'rv',
    openTaskCount: 14,
    ...over,
  });

  /** Opens the list over `rows` and the Deactivate dialog of `name`; returns what the dialog says. */
  async function dialogOf(rows: TaskTypeView[], name: string): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: TaskTypesApi, useValue: { list: () => of(rows) } },
        { provide: WorkflowLookup, useClass: StubWorkflowLookup },
        provideFakeMe(new FakeMeApi(withPermissions('TaskType.Manage', 'Workflow.Manage'))),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(TaskTypesPage);
    await settle(fixture);
    const row = fixture.nativeElement.querySelector(`[data-row="${name}"]`)!;
    row.querySelector('button[data-overflow]')!.click();
    await settle(fixture);
    fixture.nativeElement.querySelector('[role=menuitem][data-action="deactivate"]')!.click();
    await settle(fixture);
    return document.querySelector('.p-dialog') as HTMLElement;
  }
  const said = (dialog: HTMLElement) => dialog.textContent!.replace(/\s+/g, ' ').trim();

  it('says how many open tasks keep the type: none, one, many', async () => {
    for (const [count, sentence] of [
      [0, 'No open tasks use this task type.'],
      [1, '1 open task keeps this type.'],
      [14, '14 open tasks keep this type.'],
    ] as const) {
      TestBed.resetTestingModule();
      const dialog = await dialogOf(
        [type(1, 'Alpha', { openTaskCount: count }), type(2, 'Beta')],
        'Alpha',
      );
      expect(said(dialog), `${count} open`).toContain(
        `Alpha will no longer be offered when people create tasks. ${sentence}`,
      );
      expect(said(dialog)).toContain('You can activate it again later.');
    }
  });

  it('leaves the sentence out when the API gave no count', async () => {
    const dialog = await dialogOf(
      [type(1, 'Alpha', { openTaskCount: undefined }), type(2, 'Beta')],
      'Alpha',
    );
    expect(said(dialog)).not.toContain('open task');
    expect(said(dialog)).toContain('Alpha will no longer be offered when people create tasks.');
  });

  it('names the workflows that lose their last task type, up to three and then "and n others"', async () => {
    // Alpha is the only active type of workflows 1 and 4; Beta keeps workflow 2 and 3.
    let dialog = await dialogOf(
      [
        type(1, 'Alpha', { eligibleWorkflowIds: [1, 2, 4] }),
        type(2, 'Beta', { eligibleWorkflowIds: [2, 3] }),
      ],
      'Alpha',
    );
    expect(said(dialog)).toContain('2 workflows are left without a task type.');
    expect(dialog.querySelector('[data-impact-names]')!.textContent).toContain(
      'Production and Standard Processing',
    );
    TestBed.resetTestingModule();

    // An inactive type does not keep a workflow; one workflow reads as one.
    dialog = await dialogOf(
      [
        type(1, 'Alpha', { eligibleWorkflowIds: [1] }),
        type(2, 'Beta', { eligibleWorkflowIds: [1], isActive: false }),
      ],
      'Alpha',
    );
    expect(said(dialog)).toContain('1 workflow is left without a task type.');
    expect(dialog.querySelector('[data-impact-names]')!.textContent).toContain(
      'Standard Processing',
    );
    TestBed.resetTestingModule();

    // A workflow another active type keeps is not named.
    dialog = await dialogOf(
      [
        type(1, 'Alpha', { eligibleWorkflowIds: [1] }),
        type(2, 'Beta', { eligibleWorkflowIds: [1] }),
      ],
      'Alpha',
    );
    expect(dialog.querySelector('[data-impact-names]')).toBeNull();
    expect(said(dialog)).not.toContain('left without a task type');
  });
});

describe('TaskTypesPage phone cards and narrow columns (#374)', () => {
  /** A window `width` px wide (the list reads `matchMedia`; jsdom has none). */
  const viewport = (width: number) =>
    vi.stubGlobal('matchMedia', (q: string) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
      const max = Number(/max-width:\s*([\d.]+)px/.exec(q)?.[1] ?? Infinity);
      return {
        matches: width >= min && width <= max,
        media: q,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
    });
  afterEach(() => vi.unstubAllGlobals());

  async function open(width: number): Promise<ComponentFixture<TaskTypesPage>> {
    viewport(width);
    configure();
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(TaskTypesPage);
    await settle(fixture);
    return fixture;
  }

  it('is one card per task type below 640 px: the icon and name, the status, the form and the default workflow, the warning and the row menu, and no table', async () => {
    const fixture = await open(375);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('table')).toBeNull();
    const cards = Array.from(el.querySelectorAll('li[data-record-card]'));
    expect(cards.length).toBeGreaterThan(0);
    const card = cards.find((c) => c.textContent!.includes('Data Processing'))!;
    const name = card.querySelector<HTMLAnchorElement>('a[data-card-name]')!;
    expect(name.getAttribute('href')).toBe('/admin/task-types/1');
    expect(name.getAttribute('data-row-list')).toBe('admin-task-types');
    expect(card.querySelector('mf-task-type-icon svg')).not.toBeNull();
    expect(card.textContent).toContain('Active');
    // The form and the default workflow with how many more may be used.
    expect(card.querySelector('[data-card-meta]')!.textContent!.trim()).toBe(
      'Published v1 - Standard Processing +1',
    );
    expect(card.querySelector('button[data-overflow]')!.getAttribute('aria-label')).toBe(
      'Actions for Data Processing',
    );
  });

  it('drops the optional columns in a fixed order as the window narrows: Workflows below 1100 px, Request form below 900 px', async () => {
    const heads = (f: ComponentFixture<TaskTypesPage>) =>
      Array.from(f.nativeElement.querySelectorAll('thead tr:first-child th')).map((th) =>
        (th as HTMLElement).textContent!.trim(),
      );
    let fixture = await open(768);
    expect(heads(fixture)).toEqual([
      'Name',
      'Default workflow',
      'Target (days)',
      'Status',
      'Actions',
    ]);
    expect(fixture.nativeElement.querySelector('[data-workflows]')).toBeNull();
    fixture.destroy();
    TestBed.resetTestingModule();
    fixture = await open(1000);
    expect(heads(fixture)).toEqual([
      'Name',
      'Default workflow',
      'Target (days)',
      'Request form',
      'Status',
      'Actions',
    ]);
    fixture.destroy();
    TestBed.resetTestingModule();
    fixture = await open(1366);
    expect(heads(fixture)).toEqual([
      'Name',
      'Default workflow',
      'Target (days)',
      'Request form',
      'Workflows',
      'Status',
      'Actions',
    ]);
    expect(fixture.nativeElement.querySelector('[data-workflows]')).not.toBeNull();
  });
});

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

  it('lists task types with the default workflow, the form status and the number of workflows that links to them (#371)', () => {
    const r = row('Data Processing');
    expect(r.querySelector('[data-form-status]')!.textContent).toContain('Published');
    expect(r.querySelector('[data-form-status]')!.textContent).toContain('v1');
    // One name (the default) and "+1" for the other, the whole list as the tooltip; no chips, no red box.
    const def = r.querySelector('[data-default-workflow] .tt-clip')!;
    expect(def.textContent!.replace(/\s+/g, ' ').trim()).toBe('Standard Processing +1');
    expect(def.getAttribute('title')).toBe('Standard Processing, Expedited Processing');
    expect(r.querySelector('[data-assoc-chip]')).toBeNull();
    // "Workflows" is a number that opens the Workflows tab filtered to the type.
    const count = r.querySelector<HTMLAnchorElement>('[data-workflows-link]')!;
    expect(count.textContent!.trim()).toBe('2');
    expect(count.getAttribute('href')).toBe('/admin/workflows?taskType=1');
    expect(count.getAttribute('aria-label')).toBe('2 workflows for Data Processing');
    expect(r.querySelector('[data-not-usable]')).toBeNull();
    expect(r.querySelector('[data-warning]')).toBeNull();
    // The name is the row link of the list (#354): Back puts focus on it again.
    const link = r.querySelector<HTMLAnchorElement>('a[data-row-key]')!;
    expect(link.getAttribute('data-row-list')).toBe('admin-task-types');
    expect(link.getAttribute('data-row-key')).toBe('1');
    expect(link.getAttribute('href')).toBe('/admin/task-types/1');
  });

  it('says what the default Active hides, with a Show all that applies Status = All, and Status sorts (#369)', async () => {
    for (const name of ['Archive One', 'Archive Two']) {
      await new Promise<void>((resolve) =>
        api
          .create({ name, description: undefined })
          .subscribe((t) =>
            api
              .update(t.id, { ...t, isActive: false, rowVersion: t.rowVersion })
              .subscribe(() => resolve()),
          ),
      );
    }
    await (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    await settle(fixture);
    const names = () =>
      Array.from(el().querySelectorAll('tbody tr[data-row]')).map((r) =>
        r.getAttribute('data-row'),
      );
    expect(names()).not.toContain('Archive One');
    expect(el().querySelector('mf-pager [data-hidden-hint]')!.textContent).toContain(
      '2 inactive hidden',
    );
    expect(el().querySelector('mf-pager')!.textContent).toContain('active');

    fixture.componentRef.setInput('status', 'all');
    await settle(fixture);
    expect(names()).toContain('Archive One');
    expect(el().querySelector('mf-pager [data-hidden-hint]')).toBeNull();

    // Status sorts: active first, then the inactive ones (and back).
    fixture.componentRef.setInput('sort', 'status');
    await settle(fixture);
    expect(el().querySelector('th[aria-sort="ascending"]')!.textContent).toContain('Status');
    const order = Array.from(el().querySelectorAll('tbody tr[data-row]')).map((r) =>
      r.classList.contains('inactive'),
    );
    expect(order).toEqual([...order].sort((x, y) => Number(x) - Number(y)));
    fixture.componentRef.setInput('sort', '-status');
    await settle(fixture);
    const reversed = Array.from(el().querySelectorAll('tbody tr[data-row]')).map((r) =>
      r.classList.contains('inactive'),
    );
    expect(reversed).toEqual([...reversed].sort((x, y) => Number(y) - Number(x)));
  });

  it('shows the health strip over the whole list and a chip puts its filters in the address (#367)', async () => {
    // One type without a workflow (not usable, active) and one inactive; Data Processing is usable.
    for (const name of ['No Flow', 'Old']) {
      await new Promise<void>((resolve) =>
        api.create({ name, description: undefined }).subscribe((t) => {
          if (name === 'Old') {
            api
              .update(t.id, { ...t, isActive: false, rowVersion: t.rowVersion })
              .subscribe(() => resolve());
          } else resolve();
        }),
      );
    }
    await (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    await settle(fixture);
    const item = (key: string) => el().querySelector(`[data-strip-item="${key}"]`)!;
    const n = (key: string) => item(key).querySelector('.n')!.textContent!.trim();
    expect(el().querySelector('[data-strip]')!.getAttribute('aria-label')).toBe(
      'Task types summary',
    );
    expect([n('active'), n('notUsable'), n('formDraft'), n('inactive')]).toEqual([
      '2',
      '1',
      '0',
      '1',
    ]);
    // Neutral chips: no red, no alert styling.
    expect(el().querySelectorAll('[data-strip-item].alert')).toHaveLength(0);
    expect(item('active').getAttribute('aria-pressed')).toBe('true');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    item('notUsable').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { status: null, form: null, usable: 'no', page: null },
      queryParamsHandling: 'merge',
    });
    await settle(fixture);
    expect(el().querySelector('[data-announce]')!.textContent).toContain('Not usable: 1');
    item('inactive').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { status: 'inactive', form: null, usable: null, page: null },
      queryParamsHandling: 'merge',
    });
  });

  it('shows the target turnaround in its own column (a dash and "No target" for none) and a coloured badge before the name (#853)', async () => {
    await new Promise<void>((resolve) =>
      api
        .create({ name: 'Production', description: undefined, colourKey: 'teal', targetDays: 3 })
        .subscribe(() => resolve()),
    );
    await (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    await settle(fixture);
    expect(el().querySelector('[data-target-col]')!.textContent).toContain('Target (days)');
    expect(row('Production').querySelector('[data-target]')!.textContent!.trim()).toBe('3');
    expect(row('Production').querySelector('mf-task-type-badge')!.getAttribute('data-colour')).toBe(
      'teal',
    );
    expect(row('Data Processing').querySelector('[data-target]')!.textContent).toContain(
      'No target',
    );
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

  it('marks a type without an eligible workflow with a neutral Not usable badge, and deactivates and reactivates', async () => {
    await new Promise<void>((resolve) =>
      api.create({ name: 'Collection', description: undefined }).subscribe(() => resolve()),
    );
    await (fixture.componentInstance as unknown as { load(): Promise<void> }).load();
    await settle(fixture);

    // A neutral badge in Status (text and icon, the reason is its description), not a red box in the name cell.
    const badge = row('Collection').querySelector('[data-not-usable]')!;
    expect(badge.textContent!.trim()).toBe('Not usable');
    expect(badge.querySelector('.pi')).not.toBeNull();
    expect(badge.querySelector('[data-tone="neutral"]')).not.toBeNull();
    const why = row('Collection').querySelector('[data-warning]')!;
    expect(why.textContent).toContain(
      "No eligible published workflow: users can't create tasks of this type.",
    );
    expect(badge.querySelector('.badge')!.getAttribute('aria-describedby')).toBe(why.id);
    expect(row('Collection').querySelector('.chip')).toBeNull();
    expect(row('Collection').querySelector('[data-form-status]')!.textContent).toContain('No form');
    // No workflow at all: "No workflow", muted (not a warning), and a plain 0.
    const none = row('Collection').querySelector('[data-default-workflow] .tt-clip')!;
    expect(none.textContent!.trim()).toBe('No workflow');
    expect(none.classList.contains('muted')).toBe(true);
    expect(row('Collection').querySelector('[data-workflows]')!.textContent!.trim()).toBe('0');
    expect(row('Collection').querySelector('[data-workflows-link]')).toBeNull();

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

  it('names the default workflow and counts how many are eligible, the whole list as the tooltip', async () => {
    await open();
    const r = row('Collection');
    // The default (Collection and Review) leads; the three others are behind "+3".
    const def = r.querySelector('[data-default-workflow] .tt-clip')!;
    expect(def.textContent!.replace(/\s+/g, ' ').trim()).toBe('Collection and Review +3');
    expect(def.getAttribute('title')).toBe(
      'Collection and Review, Expedited Processing, Production, Standard Processing',
    );
    expect(r.querySelector('[data-workflows-link]')!.textContent!.trim()).toBe('4');
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

  it('shows the number of workflows as plain text, not a link, without Workflow.Manage', async () => {
    api = configure('TaskType.Manage');
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(TaskTypesPage);
    await settle(fixture);
    const r = row('Data Processing');
    expect(r.querySelector('[data-workflows]')!.textContent!.trim()).toBe('2');
    expect(r.querySelector('[data-workflows-link]')).toBeNull();
    expect(r.querySelector('[data-default-workflow]')!.textContent).toContain(
      'Standard Processing',
    );
  });
});
