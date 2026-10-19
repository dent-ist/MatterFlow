import { lastMain } from '../list-testing';
import { AdminShellFilters } from '../task-types/shell-filters';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import {
  FormsClient,
  StepDefinitionDetail,
  StepDefinitionSummary,
  StepDefinitionsClient,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  FakeMeApi,
  apiError,
  buttonByLabel,
  fakeQuery,
  ok,
  openOverflow,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { StepEditPage, isValidDocumentationUrl } from './step-edit-page';
import { StepsListPage } from './steps-list-page';

const summary = (overrides: Partial<StepDefinitionSummary> = {}): StepDefinitionSummary => ({
  stepDefinitionId: 4,
  title: 'Deduplicate',
  description: 'Remove duplicate items',
  documentationUrl: undefined,
  isActive: true,
  usedInVersions: 3,
  usedInWorkflows: 2,
  tags: [],
  rowVersion: 'AAAA',
  publishedFormVersionId: undefined,
  draftFormFieldCount: 0,
  ...overrides,
});

const detail = (overrides: Partial<StepDefinitionDetail> = {}): StepDefinitionDetail => ({
  stepDefinitionId: 4,
  title: 'Deduplicate',
  description: 'Remove duplicate items',
  instructions: 'Run the dedupe job.',
  documentationUrl: 'https://sharepoint.example.firm/dedupe',
  isActive: true,
  formDefinitionId: 9,
  publishedFormVersionId: undefined,
  draftFormFieldCount: 0,
  usage: [
    {
      workflowDefinitionId: 1,
      workflowName: 'Standard Processing',
      workflowVersionId: 5,
      versionNo: 2,
      status: 'Published' as never,
    },
  ],
  tags: [],
  rowVersion: 'BBBB',
  ...overrides,
});

let query: ReturnType<typeof fakeQuery>;

// The Description column shows from 1200 px (#356): the lists are measured on a wide window, whatever another spec left in `matchMedia`.
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
beforeEach(() => viewport(1366));
afterEach(() => vi.unstubAllGlobals());

async function setup(api: Record<string, unknown>) {
  localStorage.clear();
  query = fakeQuery();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      query.provider,
      MessageService,
      provideFakeMe(new FakeMeApi(withPermissions('Workflow.Manage'))),
      { provide: StepDefinitionsClient, useValue: api },
      // The Step page also reads which workflows are active and the versions of the step's form (both quiet, so empty answers are enough).
      {
        provide: WorkflowsClient,
        useValue: { listWorkflows: vi.fn().mockReturnValue(of({ items: [], total: 0 })) },
      },
      { provide: FormsClient, useValue: { listFormVersions: vi.fn().mockReturnValue(of([])) } },
      AdminShellFilters,
    ],
  });
  await TestBed.inject(AuthStore).ensureLoaded();
}

/** The filters the open tab handed to the page header (where the Filters button and its count live, #365). */
const headerFilters = () => TestBed.inject(AdminShellFilters).current()!.filters;

describe('StepsListPage', () => {
  it('lists steps with usage and status, linking each to its editor', async () => {
    const api = {
      listStepDefinitions: vi.fn().mockReturnValue(
        ok({
          items: [
            summary(),
            summary({
              stepDefinitionId: 5,
              title: 'OCR',
              usedInVersions: 0,
              usedInWorkflows: 0,
              isActive: false,
            }),
          ],
          total: 2,
          page: 1,
          pageSize: 25,
        }),
      ),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    const rows = Array.from(el.querySelectorAll('tbody tr'));
    expect(rows.map((r) => r.getAttribute('data-row'))).toEqual(['Deduplicate', 'OCR']);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/admin/steps/4');
    // "Used in n workflows" opens the Workflows tab filtered to the step; 0 says "Not used" (muted, no link).
    const used = rows[0].querySelector<HTMLAnchorElement>('[data-used-in-link]')!;
    expect(used.textContent!.trim()).toBe('2');
    expect(used.getAttribute('aria-label')).toBe('Used in 2 workflows');
    expect(used.getAttribute('href')).toBe('/admin/workflows?step=4');
    expect(rows[1].querySelector('[data-used-in-link]')).toBeNull();
    expect(rows[1].querySelector('[data-used-in] .pg-muted')!.textContent).toBe('Not used');
    expect(rows[1].textContent).toContain('Not used');
    expect(rows[1].textContent).toContain('Inactive');
    expect(api.listStepDefinitions).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      1,
      25,
    );
  });

  it('shows an empty state that points at the New step button of the page header', async () => {
    await setup({
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [], total: 0, page: 1, pageSize: 25 })),
    });
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-empty="none"]')).not.toBeNull();
    // The one way to add is the page header's New step button: the empty state says so and has no second button (#370).
    expect(el.querySelector('[data-empty="none"]')!.textContent).toContain('New step');
    expect(el.querySelector('[data-empty="none"] button, [data-empty="none"] a')).toBeNull();
  });

  it('sends the column filters of the address to the API', async () => {
    const api = {
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [], total: 0, page: 1, pageSize: 25 })),
      listStepTags: vi.fn().mockReturnValue(ok([])),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    query.set({ title: ' qc ', description: 'dupes', used: 'false', status: 'all' });
    fixture.componentRef.setInput('page', '2');
    await settle(fixture);
    expect(lastMain(api.listStepDefinitions)).toEqual([
      undefined,
      undefined,
      'qc',
      'dupes',
      false,
      undefined,
      undefined,
      undefined,
      2,
      25,
    ]);
    // A link with filters opens the row with the values in it and counts them (status All is a change from the default).
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector<HTMLInputElement>('[aria-label="Filter by Title"]')!.value).toBe('qc');
    expect(headerFilters().activeCount()).toBe(4);
  });

  it('says what the default Active hides: one more request for the inactive ones, the count in the pager (#369)', async () => {
    const api = {
      listStepDefinitions: vi
        .fn()
        // (sort, q, title, description, used, tags, tagMatch, isActive, page, size): isActive false is the hidden-count request.
        .mockImplementation((...args: unknown[]) =>
          ok({
            items: args[7] === false ? [] : [summary()],
            total: args[7] === false ? 3 : 5,
            page: 1,
            pageSize: 25,
          }),
        ),
      listStepTags: vi.fn().mockReturnValue(ok([])),
    };
    await setup(api);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(api.listStepDefinitions).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      1,
      1,
    );
    expect(el.querySelector('mf-pager [data-hidden-hint]')!.textContent).toContain(
      '3 inactive hidden',
    );
    expect(el.querySelector('mf-pager')!.textContent).toContain('of 5 active');
    // Show all puts Status = All in the address, where no hidden count is asked for.
    el.querySelector<HTMLButtonElement>('mf-pager [data-show-all]')!.click();
    await settle(fixture);
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { status: 'all', page: null },
      queryParamsHandling: 'merge',
    });
  });

  it('makes Status a sortable column', async () => {
    const api = {
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [summary()], total: 1, page: 1, pageSize: 25 })),
      listStepTags: vi.fn().mockReturnValue(ok([])),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    fixture.componentRef.setInput('sort', 'status');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const th = Array.from(el.querySelectorAll('th')).find((t) =>
      t.textContent!.includes('Status'),
    )!;
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(lastMain(api.listStepDefinitions)![0]).toBe('status');
  });

  it('has column filters instead of a search box, status select and tag popover, open by default', async () => {
    const api = {
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [summary()], total: 1, page: 1, pageSize: 25 })),
      listStepTags: vi.fn().mockReturnValue(ok([])),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(
      el.querySelector('#step-search, #step-status, #step-tags-button, mf-search-box'),
    ).toBeNull();
    // Open by default (from 640 px, #365); the Filters button sits in the page header, not in this tab.
    expect(el.querySelector('[data-filter-row]')).not.toBeNull();
    expect(el.querySelector('[data-filters-toggle]')).toBeNull();
    for (const column of ['Title', 'Description', 'Used in', 'Status']) {
      expect(el.querySelector(`[aria-label="Filter by ${column}"]`)).not.toBeNull();
    }
    expect(el.querySelector('button[data-filter="tags"]')).not.toBeNull();
    // Match all / any waits for a tag.
    expect(el.querySelector('[data-filter-disabled]')?.textContent).toContain('Choose tags first');
    expect(headerFilters().activeCount()).toBe(0);
  });
});

describe('StepsListPage narrow window (#356)', () => {
  it('leaves the Description column out below 1200 px and shows the number of workflows as the link', async () => {
    viewport(1024);
    const api = {
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [summary()], total: 1, page: 1, pageSize: 25 })),
      listStepTags: vi.fn().mockReturnValue(ok([])),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent!.trim())).toEqual(
      ['Title', 'Used in', 'Status', 'Actions'],
    );
    const row = el.querySelector('tbody tr[data-row="Deduplicate"]')!;
    expect(row.querySelectorAll('td')).toHaveLength(4);
    expect(row.querySelector('a.pg-name')!.getAttribute('title')).toBe('Deduplicate');
    const used = row.querySelector('[data-used-in-link]')!;
    expect(used.textContent!.trim()).toBe('2');
    expect(used.closest('td')!.classList.contains('pg-num')).toBe(true);
  });
});

describe('StepsListPage phone cards and narrow columns (#375)', () => {
  const list = (items: StepDefinitionSummary[]) =>
    vi.fn().mockReturnValue(ok({ items, total: items.length, page: 1, pageSize: 25 }));

  it('is one card per step below 640 px: the name link, the status, the facts and the row menu, and no table', async () => {
    viewport(375);
    const api = {
      listStepDefinitions: list([
        summary(),
        summary({
          stepDefinitionId: 5,
          title: 'OCR',
          description: undefined,
          usedInWorkflows: 0,
          isActive: false,
        }),
      ]),
      listStepTags: vi.fn().mockReturnValue(ok([])),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('table')).toBeNull();
    const cards = Array.from(el.querySelectorAll('li[data-record-card]'));
    expect(cards).toHaveLength(2);
    const first = cards[0];
    const name = first.querySelector<HTMLAnchorElement>('a[data-card-name]')!;
    expect(name.textContent!.trim()).toBe('Deduplicate');
    expect(name.getAttribute('href')).toBe('/admin/steps/4');
    expect(name.getAttribute('data-row-list')).toBe('admin-steps');
    expect(name.getAttribute('data-row-key')).toBe('4');
    expect(first.textContent).toContain('Active');
    expect(first.textContent).toContain('Remove duplicate items');
    expect(first.querySelector('[data-used-in-link]')!.textContent!.trim()).toBe(
      'Used in 2 workflows',
    );
    expect(first.querySelector('button[data-overflow]')!.getAttribute('aria-label')).toBe(
      'Actions for Deduplicate',
    );
    expect(cards[1].textContent).toContain('Inactive');
    expect(cards[1].textContent).toContain('Not used in a workflow');
  });

  it('leaves the Tags column out below 1100 px, and shows two tags and "+n more" from there', async () => {
    const api = {
      listStepDefinitions: list([summary({ tags: ['a', 'b', 'c'] })]),
      listStepTags: vi.fn().mockReturnValue(ok([])),
    };
    viewport(700);
    await setup(api);
    let fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const heads = (f: typeof fixture) =>
      Array.from(f.nativeElement.querySelectorAll('thead th')).map((th) =>
        (th as HTMLElement).textContent!.trim(),
      );
    expect(heads(fixture)).toEqual(['Title', 'Used in', 'Status', 'Actions']);
    fixture.destroy();

    viewport(1366);
    fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    expect(heads(fixture)).toEqual([
      'Title',
      'Description',
      'Tags',
      'Used in',
      'Status',
      'Actions',
    ]);
    const row: HTMLElement = fixture.nativeElement.querySelector('tbody tr[data-row]');
    expect(row.querySelectorAll('[data-tag]')).toHaveLength(2);
    expect(row.querySelector('[data-tags-more]')!.textContent).toContain('+1 more');
  });
});

describe('StepsListPage health strip (#368)', () => {
  it('counts only from the API summary; Inputs in draft is a plain count and the others are chips that filter', async () => {
    const api = {
      listStepDefinitions: vi.fn().mockReturnValue(
        ok({
          items: [summary()],
          total: 1,
          page: 1,
          pageSize: 25,
          summary: { total: 12, active: 10, inactive: 2, notUsed: 4, inputsInDraft: 3 },
        }),
      ),
      listStepTags: vi.fn().mockReturnValue(ok([])),
    };
    await setup(api);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const n = (key: string) =>
      el.querySelector(`[data-strip-item="${key}"] .n`)!.textContent!.trim();
    expect([n('active'), n('notUsed'), n('inputsDraft'), n('inactive')]).toEqual([
      '10',
      '4',
      '3',
      '2',
    ]);
    expect(el.querySelector('[data-strip-item="inputsDraft"]')!.tagName).toBe('SPAN');
    el.querySelector<HTMLButtonElement>('[data-strip-item="notUsed"]')!.click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { status: null, used: 'false', page: null },
      queryParamsHandling: 'merge',
    });
    expect(el.querySelector('[data-strip-item="active"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

describe('StepsListPage row menu', () => {
  const list = (items: StepDefinitionSummary[]) =>
    vi.fn().mockReturnValue(ok({ items, total: items.length, page: 1, pageSize: 25 }));
  const entries = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[role=menuitem]')).map((i) => i.getAttribute('data-action'));

  it('has one overflow button per row with Edit inputs and Deactivate (Activate when inactive), and confirms Deactivate', async () => {
    const api = {
      listStepDefinitions: list([
        summary(),
        summary({ stepDefinitionId: 5, title: 'OCR', isActive: false }),
      ]),
      deactivateStepDefinition: vi.fn().mockReturnValue(of(detail({ isActive: false }))),
      activateStepDefinition: vi.fn().mockReturnValue(of(detail())),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('tbody button[data-overflow]')).toHaveLength(2);
    expect(
      el.querySelector('tr[data-row="OCR"] button[data-overflow]')!.getAttribute('aria-label'),
    ).toBe('Actions for OCR');

    el.querySelector<HTMLButtonElement>('tr[data-row="OCR"] button[data-overflow]')!.click();
    await settle(fixture);
    expect(entries(el)).toEqual(['edit-inputs', 'activate']);
    el.querySelector<HTMLButtonElement>('[data-action=activate]')!.click();
    await settle(fixture);
    expect(api.activateStepDefinition).toHaveBeenCalledWith(5, { rowVersion: 'AAAA' });

    el.querySelector<HTMLButtonElement>(
      'tr[data-row="Deduplicate"] button[data-overflow]',
    )!.click();
    await settle(fixture);
    expect(entries(el)).toEqual(['edit-inputs', 'deactivate']);
    const go = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>('[data-action=edit-inputs]')!.click();
    expect(go).toHaveBeenCalledWith(['/admin/steps', 4, 'form'], {
      state: { returnTo: expect.any(String) },
    });

    el.querySelector<HTMLButtonElement>(
      'tr[data-row="Deduplicate"] button[data-overflow]',
    )!.click();
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-action=deactivate]')!.click();
    await settle(fixture);
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Deactivate step' && b.closest('p-dialog, .p-dialog'),
    );
    expect(confirm).toBeDefined();
    expect(api.deactivateStepDefinition).not.toHaveBeenCalled();
    confirm!.click();
    await settle(fixture);
    expect(api.deactivateStepDefinition).toHaveBeenCalledWith(4, { rowVersion: 'AAAA' });
  });
});

describe('StepEditPage', () => {
  it('creates a step and opens it for editing; requires a title and a valid link', async () => {
    const api = {
      createStepDefinition: vi.fn().mockReturnValue(ok(detail({ stepDefinitionId: 12 }))),
    };
    await setup(api);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StepEditPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const type = (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };

    expect(el.querySelector('[data-banner]')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('New step');
    // Inputs and Used by wait for the saved step (disabled with a reason, still in the tab order).
    expect(el.querySelector('[role=tab][data-tab="inputs"]')?.getAttribute('aria-disabled')).toBe(
      'true',
    );

    buttonByLabel(el, 'Create step')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-summary]')?.textContent).toContain('Enter a title.');
    expect(api.createStepDefinition).not.toHaveBeenCalled();

    type('step-title', ' Deduplicate ');
    type('step-url', 'not a url');
    buttonByLabel(el, 'Create step')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-summary]')?.textContent).toContain('http');
    expect(api.createStepDefinition).not.toHaveBeenCalled();

    type('step-url', 'https://sharepoint.example.firm/dedupe');
    buttonByLabel(el, 'Create step')!.click();
    await settle(fixture);
    expect(api.createStepDefinition).toHaveBeenCalledWith({
      title: 'Deduplicate',
      description: undefined,
      instructions: undefined,
      documentationUrl: 'https://sharepoint.example.firm/dedupe',
      tags: [],
    });
    // A saved step opens on its Inputs tab, the next thing to set up (the address is replaced).
    expect(navigate).toHaveBeenCalledWith(['/admin/steps', 12], {
      queryParams: { tab: 'inputs' },
      replaceUrl: true,
    });
  });

  it('shows the record header, strip and tabs of a saved step; no banner, no form footer without edits', async () => {
    const api = { getStepDefinition: vi.fn().mockReturnValue(ok(detail())) };
    await setup(api);
    const fixture = TestBed.createComponent(StepEditPage);
    fixture.componentRef.setInput('stepId', '4');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('h1')?.textContent).toContain('Deduplicate');
    expect(el.querySelector('[data-status-badge], mf-active-badge')?.textContent).toContain(
      'Active',
    );
    expect(el.querySelector('[data-banner]')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('#step-title')!.value).toBe('Deduplicate');
    expect(
      Array.from(el.querySelectorAll('[role=tab]')).map((t) =>
        t.textContent!.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['Details', 'Inputs', 'Used by (1)']);
    expect(el.querySelector('[data-footer]')).toBeNull();
    expect(buttonByLabel(el, 'Deactivate')).toBeUndefined();
  });

  it('saves edits with the row version and reports a concurrency conflict', async () => {
    const api = {
      getStepDefinition: vi.fn().mockReturnValue(ok(detail())),
      updateStepDefinition: vi
        .fn()
        .mockReturnValue(ok(detail({ title: 'Dedupe', rowVersion: 'CCCC' }))),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepEditPage);
    fixture.componentRef.setInput('stepId', '4');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const title = el.querySelector<HTMLInputElement>('#step-title')!;
    title.value = 'Dedupe';
    title.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    await settle(fixture);

    buttonByLabel(el, 'Save changes')!.click();
    await settle(fixture);
    expect(api.updateStepDefinition).toHaveBeenCalledWith(4, {
      title: 'Dedupe',
      description: 'Remove duplicate items',
      instructions: 'Run the dedupe job.',
      documentationUrl: 'https://sharepoint.example.firm/dedupe',
      isActive: true,
      tags: [],
      rowVersion: 'BBBB',
    });
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);

    api.updateStepDefinition.mockReturnValue(
      apiError(409, {
        status: 409,
        title: 'Conflict',
        code: 'CONCURRENCY_CONFLICT',
        detail: 'Changed.',
      }),
    );
    title.value = 'Dedupe 2';
    title.dispatchEvent(new Event('input'));
    await settle(fixture);
    buttonByLabel(el, 'Save changes')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-conflict]')).not.toBeNull();
  });

  it('deactivates after confirmation', async () => {
    const api = {
      getStepDefinition: vi.fn().mockReturnValue(ok(detail())),
      deactivateStepDefinition: vi
        .fn()
        .mockReturnValue(of(detail({ isActive: false, rowVersion: 'DDDD' }))),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepEditPage);
    fixture.componentRef.setInput('stepId', '4');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    const menu = await openOverflow(fixture);
    menu!.querySelector<HTMLElement>('[data-action="deactivate"]')!.click();
    await settle(fixture);
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Deactivate step' && b.closest('p-dialog, .p-dialog'),
    );
    expect(confirm).toBeDefined();
    confirm!.click();
    await settle(fixture);

    expect(api.deactivateStepDefinition).toHaveBeenCalledWith(4, { rowVersion: 'BBBB' });
    expect(el.querySelector('[data-status-badge], mf-active-badge')?.textContent).toContain(
      'Inactive',
    );
    expect((await openOverflow(fixture))?.querySelector('[data-action="activate"]')).not.toBeNull();
  });
});

describe('isValidDocumentationUrl', () => {
  it('accepts blank and http(s) addresses only', () => {
    expect(isValidDocumentationUrl('')).toBe(true);
    expect(isValidDocumentationUrl('  ')).toBe(true);
    expect(isValidDocumentationUrl('https://x.example/y')).toBe(true);
    expect(isValidDocumentationUrl('http://x.example')).toBe(true);
    expect(isValidDocumentationUrl('ftp://x.example')).toBe(false);
    expect(isValidDocumentationUrl('x.example')).toBe(false);
  });
});

describe('StepsListPage tags', () => {
  const tagOptions = [
    { name: 'Relativity', stepCount: 3 },
    { name: 'QC', stepCount: 1 },
  ];

  it('shows each step tags as chips with +n more, and offers the existing tags with counts', async () => {
    const api = {
      listStepDefinitions: vi.fn().mockReturnValue(
        ok({
          items: [
            summary({ tags: ['Relativity', 'Processing', 'QC', 'Review', 'Intake'] }),
            summary({ stepDefinitionId: 5, title: 'OCR', tags: [] }),
          ],
          total: 2,
          page: 1,
          pageSize: 25,
        }),
      ),
      listStepTags: vi.fn().mockReturnValue(ok(tagOptions)),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent!.trim())).toEqual(
      ['Title', 'Description', 'Tags', 'Used in', 'Status', 'Actions'],
    );
    const first = el.querySelector('tbody tr[data-row="Deduplicate"]')!;
    expect(
      Array.from(first.querySelectorAll('[data-tag]')).map((c) => c.textContent!.trim()),
    ).toEqual(['Relativity', 'Processing']);
    expect(first.querySelector('[data-tags-more]')!.textContent).toContain('+3 more');
    expect(el.querySelector('tbody tr[data-row="OCR"] [data-tags]')).toBeNull();
    expect(api.listStepTags).toHaveBeenCalledWith(undefined, true, 200);

    el.querySelector<HTMLButtonElement>('button[data-filter="tags"]')!.click();
    await settle(fixture);
    expect(
      Array.from(el.querySelectorAll('.ms-opt')).map((o) =>
        o.textContent!.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['Relativity3', 'QC1']);
  });

  it('puts the chosen tags and Match all / any in the address and sends them to the API', async () => {
    const api = {
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [], total: 0, page: 1, pageSize: 25 })),
      listStepTags: vi.fn().mockReturnValue(ok(tagOptions)),
    };
    await setup(api);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    el.querySelector<HTMLButtonElement>('button[data-filter="tags"]')!.click();
    await settle(fixture);
    el.querySelector<HTMLInputElement>('input[data-option="Relativity"]')!.click();
    await new Promise((r) => setTimeout(r, 450));
    await settle(fixture);
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { tags: ['Relativity'], page: null },
      queryParamsHandling: 'merge',
    });

    query.set({ tags: 'Relativity' });
    await settle(fixture);
    expect(lastMain(api.listStepDefinitions)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ['Relativity'],
      undefined, // Match all is the default and is not sent
      true,
      1,
      25,
    ]);
  });

  it('sends Match any with the tags, and ignores it while no tag is chosen', async () => {
    const api = {
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [], total: 0, page: 1, pageSize: 25 })),
      listStepTags: vi.fn().mockReturnValue(ok(tagOptions)),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    query.set({ tagMatch: 'any' });
    await settle(fixture);
    expect(lastMain(api.listStepDefinitions)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      1,
      25,
    ]);

    query.set({ tags: 'Relativity' });
    await settle(fixture);
    expect(lastMain(api.listStepDefinitions)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ['Relativity'],
      'any',
      true,
      1,
      25,
    ]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector<HTMLSelectElement>('[aria-label="Filter by Tag match"]')!.value).toBe(
      'any',
    );
  });

  it('treats a tag in the address as filtering, and Clear filters resets the tags too', async () => {
    const api = {
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [], total: 0, page: 1, pageSize: 25 })),
      listStepTags: vi.fn().mockReturnValue(ok(tagOptions)),
    };
    await setup(api);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StepsListPage);
    query.set({ tags: 'QC' });
    await settle(fixture);
    expect(lastMain(api.listStepDefinitions)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ['QC'],
      undefined,
      true,
      1,
      25,
    ]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('td[data-empty="filtered"]')).not.toBeNull();
    expect(el.querySelector('thead th')).not.toBeNull(); // the headers stay
    buttonByLabel(el, 'Clear filters')!.click();
    await settle(fixture);
    expect(navigate).toHaveBeenCalled();
    expect(navigate.mock.lastCall?.[1]).toMatchObject({
      queryParams: expect.objectContaining({ tags: null, q: null, page: null }),
    });
  });

  it('still lists steps when the tag options cannot be loaded', async () => {
    const api = {
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [summary()], total: 1, page: 1, pageSize: 25 })),
      listStepTags: vi.fn().mockReturnValue(apiError(500, { status: 500, title: 'x' })),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
  });
});

describe('StepEditPage tags', () => {
  it('shows the tags as chips, saves added and removed tags, and offers existing tags as suggestions', async () => {
    const api = {
      getStepDefinition: vi
        .fn()
        .mockReturnValue(ok(detail({ tags: ['Relativity', 'Processing'] }))),
      listStepTags: vi.fn().mockReturnValue(ok([{ name: 'QC', stepCount: 2 }])),
      updateStepDefinition: vi
        .fn()
        .mockReturnValue(ok(detail({ tags: ['Relativity', 'QC'], rowVersion: 'CCCC' }))),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepEditPage);
    fixture.componentRef.setInput('stepId', '4');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('label[for="step-tags"]')?.textContent).toContain('Tags');
    expect(
      Array.from(el.querySelectorAll('.ti__chip .ti__text')).map((c) => c.textContent),
    ).toEqual(['Relativity', 'Processing']);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);

    el.querySelector<HTMLButtonElement>('[aria-label="Remove tag Processing"]')!.click();
    const input = el.querySelector<HTMLInputElement>('#step-tags')!;
    input.focus();
    input.value = 'qc';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(api.listStepTags).toHaveBeenLastCalledWith('qc', undefined, 12);
    expect(el.querySelector('[role="option"]')?.textContent?.trim()).toBe('QC');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await settle(fixture);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    await settle(fixture);

    buttonByLabel(el, 'Save changes')!.click();
    await settle(fixture);
    expect(api.updateStepDefinition).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ tags: ['Relativity', 'QC'], rowVersion: 'BBBB' }),
    );
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('shows a server tag error under the field', async () => {
    const api = {
      getStepDefinition: vi.fn().mockReturnValue(ok(detail())),
      listStepTags: vi.fn().mockReturnValue(ok([])),
      updateStepDefinition: vi.fn().mockReturnValue(
        apiError(400, {
          status: 400,
          title: 'Validation failed',
          code: 'TAG_TOO_LONG',
          errors: {
            tags: [{ code: 'TAG_TOO_LONG', message: 'A tag can have at most 40 characters.' }],
          },
        } as never),
      ),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepEditPage);
    fixture.componentRef.setInput('stepId', '4');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const title = el.querySelector<HTMLInputElement>('#step-title')!;
    title.value = 'Dedupe';
    title.dispatchEvent(new Event('input'));
    await settle(fixture);
    buttonByLabel(el, 'Save changes')!.click();
    await settle(fixture);
    expect(el.querySelector('#step-tags-error')?.textContent).toContain('at most 40 characters');
  });

  it('has the Administration > Task Types > Workflow Steps > step breadcrumb', async () => {
    const api = {
      getStepDefinition: vi.fn().mockReturnValue(ok(detail())),
      listStepTags: vi.fn().mockReturnValue(ok([])),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepEditPage);
    fixture.componentRef.setInput('stepId', '4');
    await settle(fixture);
    const crumbs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('nav[aria-label="Breadcrumb"] li'),
    ).map((li) => li.querySelector('.mf-sr-only')?.textContent ?? li.textContent!.trim());
    expect(crumbs).toEqual(['Administration', 'Task Types', 'Workflow Steps', 'Deduplicate']);
  });
});
