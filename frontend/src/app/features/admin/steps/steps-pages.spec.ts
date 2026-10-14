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
  rowVersion: 'BBBB',
  ...overrides,
});

async function setup(api: Record<string, unknown>) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
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
            summary({ stepDefinitionId: 5, title: 'OCR', usedInVersions: 0, isActive: false }),
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
    expect(rows[0].textContent).toContain('3 versions');
    expect(rows[1].textContent).toContain('Not used');
    expect(rows[1].textContent).toContain('Inactive');
    expect(api.listStepDefinitions).toHaveBeenCalledWith(undefined, true, 1, 25);
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

  it('sends the URL state to the API', async () => {
    const api = {
      listStepDefinitions: vi
        .fn()
        .mockReturnValue(ok({ items: [], total: 0, page: 1, pageSize: 25 })),
    };
    await setup(api);
    const fixture = TestBed.createComponent(StepsListPage);
    await settle(fixture);
    fixture.componentRef.setInput('q', ' qc ');
    fixture.componentRef.setInput('status', 'all');
    fixture.componentRef.setInput('page', '2');
    await settle(fixture);
    expect(api.listStepDefinitions).toHaveBeenLastCalledWith('qc', undefined, 2, 25);
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

    buttonByLabel(el, 'Save step')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-summary]')?.textContent).toContain('Enter a title.');
    expect(api.createStepDefinition).not.toHaveBeenCalled();

    type('step-title', ' Deduplicate ');
    type('step-url', 'not a url');
    buttonByLabel(el, 'Save step')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-summary]')?.textContent).toContain('http');
    expect(api.createStepDefinition).not.toHaveBeenCalled();

    type('step-url', 'https://sharepoint.example.firm/dedupe');
    buttonByLabel(el, 'Save step')!.click();
    await settle(fixture);
    expect(api.createStepDefinition).toHaveBeenCalledWith({
      title: 'Deduplicate',
      description: undefined,
      instructions: undefined,
      documentationUrl: 'https://sharepoint.example.firm/dedupe',
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

    buttonByLabel(el, 'Save step')!.click();
    await settle(fixture);
    expect(api.updateStepDefinition).toHaveBeenCalledWith(4, {
      title: 'Dedupe',
      description: 'Remove duplicate items',
      instructions: 'Run the dedupe job.',
      documentationUrl: 'https://sharepoint.example.firm/dedupe',
      isActive: true,
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
    buttonByLabel(el, 'Save step')!.click();
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
      (b) => b.textContent?.trim() === 'Deactivate' && b.closest('p-dialog, .p-dialog'),
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
