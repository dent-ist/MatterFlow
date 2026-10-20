import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import {
  FormVersionStatus,
  FormsClient,
  StepDefinitionDetail,
  StepDefinitionsClient,
  WorkflowVersionStatus,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  FakeMeApi,
  apiError,
  fakeQuery,
  ok,
  openOverflow,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { StepEditPage } from './step-edit-page';

const usage = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    workflowDefinitionId: 100 + i,
    workflowName: `Workflow ${i}`,
    workflowVersionId: 500 + i,
    versionNo: 1 + (i % 2),
    status: (i % 3 === 0
      ? WorkflowVersionStatus.Draft
      : WorkflowVersionStatus.Published) as WorkflowVersionStatus,
  }));

const detail = (o: Partial<StepDefinitionDetail> = {}): StepDefinitionDetail => ({
  stepDefinitionId: 4,
  title: 'Deduplicate',
  description: 'Remove duplicate items',
  instructions: undefined,
  documentationUrl: undefined,
  isActive: true,
  formDefinitionId: 9,
  publishedFormVersionId: undefined,
  draftFormFieldCount: 0,
  usage: usage(2),
  tags: ['QC'],
  rowVersion: 'AAAA',
  ...o,
});

const fields = [
  { key: 'in', label: 'Items in', control: 'NUMBER', required: true },
  { key: 'qc', label: 'QC result', control: 'SELECT' },
];

interface Setup {
  steps?: Record<string, unknown>;
  forms?: Record<string, unknown>;
  permissions?: Parameters<typeof withPermissions>;
  workflows?: unknown;
}

async function open(step: StepDefinitionDetail, tab: string | undefined, s: Setup = {}) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      fakeQuery().provider,
      MessageService,
      provideFakeMe(
        new FakeMeApi(
          withPermissions(
            ...(s.permissions ?? (['Workflow.Manage'] as Parameters<typeof withPermissions>)),
          ),
        ),
      ),
      {
        provide: StepDefinitionsClient,
        useValue: { getStepDefinition: vi.fn().mockReturnValue(ok(step)), ...s.steps },
      },
      {
        provide: WorkflowsClient,
        useValue: {
          listWorkflows: s.workflows ?? vi.fn().mockReturnValue(of({ items: [], total: 0 })),
        },
      },
      {
        provide: FormsClient,
        useValue: {
          listFormVersions: vi.fn().mockReturnValue(of([])),
          getFormVersionSchema: vi.fn().mockReturnValue(of({ fields })),
          ...s.forms,
        },
      },
    ],
  });
  await TestBed.inject(AuthStore).ensureLoaded();
  const fixture = TestBed.createComponent(StepEditPage);
  fixture.componentRef.setInput('stepId', '4');
  fixture.componentRef.setInput('tab', tab);
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('Step page, Used by tab (#404)', () => {
  it('has one muted sentence and a link with a status badge to each workflow version', async () => {
    const { el } = await open(detail({ usage: usage(3) }), 'used-by');
    expect(el.querySelector('[data-used-note]')?.textContent).toContain(
      "doesn't change workflows that are already published",
    );
    expect(el.querySelector('.pg-banner')).toBeNull();
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('[data-used-link]'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/admin/workflows/100/versions/500',
      '/admin/workflows/101/versions/501',
      '/admin/workflows/102/versions/502',
    ]);
    expect(links[0].textContent!.trim()).toBe('Workflow 0 v1');
    expect(
      Array.from(el.querySelectorAll('[data-used-status]')).map((b) => b.textContent!.trim()),
    ).toEqual(['Draft', 'Published', 'Published']);
  });

  it('says Not used, without the sentence, when no workflow contains the step', async () => {
    const { el } = await open(detail({ usage: [] }), 'used-by');
    expect(el.querySelector('[data-not-used]')?.textContent).toContain('Not used');
    expect(el.querySelector('[data-used-note]')).toBeNull();
    expect(el.querySelector('[data-strip-item="used"]')?.textContent).toContain('Not used');
  });

  it('counts the active workflows on the tab and marks one that was deactivated', async () => {
    const workflows = vi.fn().mockReturnValue(
      of({
        items: [
          { workflowDefinitionId: 100, isActive: true },
          { workflowDefinitionId: 101, isActive: false },
        ],
        total: 2,
      }),
    );
    const { el } = await open(detail({ usage: usage(2) }), 'used-by', { workflows });
    expect(el.querySelector('[role=tab][data-tab="used-by"]')?.textContent).toContain('(1)');
    expect(el.querySelectorAll('[data-used-inactive]')).toHaveLength(1);
    expect(el.querySelector('[data-strip-item="used"]')?.textContent).toContain('1');
  });
});

describe('Step page, Inputs tab (#405)', () => {
  it('lists label, type and required of the published inputs', async () => {
    const { el } = await open(detail({ publishedFormVersionId: 7 }), 'inputs', {
      forms: {
        listFormVersions: vi.fn().mockReturnValue(
          of([
            {
              formVersionId: 7,
              versionNo: 2,
              status: FormVersionStatus.Published,
              fieldCount: 2,
            },
          ]),
        ),
      },
    });
    expect(el.querySelector('[data-status-published]')?.textContent).toContain('Published v2');
    const rows = Array.from(el.querySelectorAll('[data-input]')).map((r) =>
      Array.from(r.children).map((c) => c.textContent!.trim()),
    );
    expect(rows).toEqual([
      ['Items in', 'Number', 'Yes'],
      ['QC result', 'Dropdown', 'No'],
    ]);
    expect(el.querySelector('[data-draft-note]')).toBeNull();
    expect(el.querySelector('[data-strip-item="inputs"]')?.textContent).toContain('2 inputs');
  });

  it('says to publish a draft before the step can be published in a workflow', async () => {
    const getFormVersionSchema = vi.fn().mockReturnValue(of({ fields }));
    const { el } = await open(detail({ draftFormFieldCount: 2 }), 'inputs', {
      forms: {
        getFormVersionSchema,
        listFormVersions: vi
          .fn()
          .mockReturnValue(
            of([
              { formVersionId: 8, versionNo: 1, status: FormVersionStatus.Draft, fieldCount: 2 },
            ]),
          ),
      },
    });
    expect(el.querySelector('[data-draft-note]')?.textContent).toContain(
      'Publish them before this step can be published in a workflow.',
    );
    expect(getFormVersionSchema).toHaveBeenCalledWith(8);
    expect(el.querySelectorAll('[data-input]')).toHaveLength(2);
  });

  it('lists the published inputs and names the newer draft', async () => {
    const getFormVersionSchema = vi.fn().mockReturnValue(of({ fields }));
    const { el } = await open(
      detail({ publishedFormVersionId: 7, draftFormFieldCount: 3 }),
      'inputs',
      {
        forms: {
          getFormVersionSchema,
          listFormVersions: vi.fn().mockReturnValue(
            of([
              { formVersionId: 9, versionNo: 2, status: FormVersionStatus.Draft, fieldCount: 3 },
              {
                formVersionId: 7,
                versionNo: 1,
                status: FormVersionStatus.Published,
                fieldCount: 2,
              },
            ]),
          ),
        },
      },
    );
    expect(getFormVersionSchema).toHaveBeenCalledWith(7);
    expect(el.querySelector('[data-newer-draft]')?.textContent).toContain('Draft v2, 3 fields');
  });

  it('says there are no inputs yet', async () => {
    const { el } = await open(detail(), 'inputs');
    expect(el.querySelector('[data-inputs-none]')?.textContent).toContain('no inputs yet');
    expect(el.querySelector('[data-inputs-table]')).toBeNull();
    expect(el.querySelector('[data-open-inputs]')?.textContent).toContain('Edit inputs');
  });

  it('explains instead of failing when reading the form is not allowed, and shows no toast', async () => {
    const denied = () =>
      apiError(403, { status: 403, title: 'Forbidden', code: 'PERMISSION_DENIED' } as never);
    const { el } = await open(detail({ publishedFormVersionId: 7 }), 'inputs', {
      forms: {
        listFormVersions: vi.fn().mockReturnValue(denied()),
        getFormVersionSchema: vi.fn().mockReturnValue(denied()),
      },
    });
    expect(el.querySelector('[data-inputs-denied]')?.textContent).toContain(
      'permission to view tasks',
    );
    expect(el.querySelector('[data-status-published]')?.textContent).toContain('Published');
    expect(el.querySelector('[data-inputs-table]')).toBeNull();
    expect(el.querySelector('[data-inputs-failed]')).toBeNull();
    // The designer reads the form too, so no button leads to a page that would refuse.
    expect(el.querySelector('[data-open-inputs]')).toBeNull();
    expect(el.querySelector('[data-action="edit-inputs"]')).toBeNull();
  });
});

describe('Step page, Deactivate (#406)', () => {
  async function dialogText(step: StepDefinitionDetail): Promise<string> {
    const { fixture } = await open(step, undefined, {
      steps: { deactivateStepDefinition: vi.fn() },
    });
    const menu = await openOverflow(fixture);
    menu!.querySelector<HTMLElement>('[data-action="deactivate"]')!.click();
    await settle(fixture);
    return document.querySelector('[data-impact]')?.textContent ?? '';
  }

  it('names the drafts that keep the step and the published versions that use it', async () => {
    const st = detail({
      usage: [
        {
          workflowDefinitionId: 1,
          workflowName: 'A',
          workflowVersionId: 1,
          versionNo: 2,
          status: WorkflowVersionStatus.Draft,
        },
        {
          workflowDefinitionId: 2,
          workflowName: 'B',
          workflowVersionId: 2,
          versionNo: 1,
          status: WorkflowVersionStatus.Draft,
        },
        {
          workflowDefinitionId: 1,
          workflowName: 'A',
          workflowVersionId: 3,
          versionNo: 1,
          status: WorkflowVersionStatus.Published,
        },
      ],
    });
    expect(await dialogText(st)).toBe(
      '2 workflow drafts contain this step; they keep it. 1 published workflow version uses it and is not changed.',
    );
  });

  it('says so when nothing uses the step', async () => {
    expect(await dialogText(detail({ usage: [] }))).toBe(
      'No workflow draft contains this step. No published workflow version uses it.',
    );
  });

  it('keeps the danger action out of the footer', async () => {
    const { el, fixture } = await open(detail(), undefined);
    const title = el.querySelector<HTMLInputElement>('#step-title')!;
    title.value = 'Changed';
    title.dispatchEvent(new Event('input'));
    await settle(fixture);
    const footer = el.querySelector('[data-footer]')!;
    expect(Array.from(footer.querySelectorAll('button')).map((b) => b.textContent!.trim())).toEqual(
      ['Save changes', 'Cancel'],
    );
  });
});
