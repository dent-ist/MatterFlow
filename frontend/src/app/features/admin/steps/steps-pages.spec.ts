import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import {
  StepDefinitionDetail,
  StepDefinitionSummary,
  StepDefinitionsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  FakeMeApi,
  apiError,
  buttonByLabel,
  fakeQuery,
  ok,
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
    ],
  });
  await TestBed.inject(AuthStore).ensureLoaded();
}

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

  it('shows an empty state with a way to add the first step', async () => {
    await setup({
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [], total: 0, page: 1, pageSize: 25 })),
    });
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-empty="none"]')).not.toBeNull();
    expect(buttonByLabel(el, 'New step')).toBeDefined();
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
    expect(api.listStepDefinitions).toHaveBeenLastCalledWith(
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
    );
    // A link with filters opens the row with the values in it and counts them (status All is a change from the default).
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector<HTMLInputElement>('[aria-label="Filter by Title"]')!.value).toBe('qc');
    expect(el.querySelector('[data-filter-count]')?.textContent).toBe('(4)');
  });

  it('has column filters instead of a search box, status select and tag popover, closed by default', async () => {
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
    expect(el.querySelector('[data-filter-row]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
    for (const column of ['Title', 'Description', 'Used in', 'Status']) {
      expect(el.querySelector(`[aria-label="Filter by ${column}"]`)).not.toBeNull();
    }
    expect(el.querySelector('button[data-filter="tags"]')).not.toBeNull();
    // Match all / any waits for a tag.
    expect(el.querySelector('[data-filter-disabled]')?.textContent).toContain('Choose tags first');
    expect(el.querySelector('[data-filter-count]')).toBeNull();
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
      ['Title', 'Tags', 'Used in', 'Status', 'Actions'],
    );
    const row = el.querySelector('tbody tr[data-row="Deduplicate"]')!;
    expect(row.querySelectorAll('td')).toHaveLength(5);
    expect(row.querySelector('a.pg-name')!.getAttribute('title')).toBe('Deduplicate');
    const used = row.querySelector('[data-used-in-link]')!;
    expect(used.textContent!.trim()).toBe('2');
    expect(used.closest('td')!.classList.contains('pg-num')).toBe(true);
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
    expect(go).toHaveBeenCalledWith(['/admin/steps', 4, 'form']);

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
    expect(el.querySelector('[data-inputs-state]')?.textContent).toContain('Save the step first');

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
    expect(navigate).toHaveBeenCalledWith(['/admin/steps', 12]);
  });

  it('shows the snapshot banner, usage and the form designer link when editing', async () => {
    const api = { getStepDefinition: vi.fn().mockReturnValue(ok(detail())) };
    await setup(api);
    const fixture = TestBed.createComponent(StepEditPage);
    fixture.componentRef.setInput('stepId', '4');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-banner]')?.textContent).toContain(
      "doesn't change workflows that are already published",
    );
    expect(el.querySelector<HTMLInputElement>('#step-title')!.value).toBe('Deduplicate');
    expect(el.querySelector('[data-usage]')?.textContent).toContain('Standard Processing v2');
    expect(el.querySelector('[data-form-link]')?.getAttribute('href')).toBe('/admin/steps/4/form');
    expect(el.querySelector('[data-inputs-state]')?.textContent).toContain('no inputs yet');
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

    buttonByLabel(el, 'Deactivate')!.click();
    await settle(fixture);
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Deactivate step' && b.closest('p-dialog, .p-dialog'),
    );
    expect(confirm).toBeDefined();
    confirm!.click();
    await settle(fixture);

    expect(api.deactivateStepDefinition).toHaveBeenCalledWith(4, { rowVersion: 'BBBB' });
    expect(buttonByLabel(el, 'Activate')).toBeDefined();
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

    el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
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

    el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
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
    expect(api.listStepDefinitions).toHaveBeenLastCalledWith(
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
    );
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
    expect(api.listStepDefinitions).toHaveBeenLastCalledWith(
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

    query.set({ tags: 'Relativity' });
    await settle(fixture);
    expect(api.listStepDefinitions).toHaveBeenLastCalledWith(
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
    );
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
    expect(api.listStepDefinitions).toHaveBeenLastCalledWith(
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
    );
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
    ).map((li) => li.textContent!.trim());
    expect(crumbs).toEqual(['Administration', 'Task Types', 'Workflow Steps', 'Deduplicate']);
  });
});
