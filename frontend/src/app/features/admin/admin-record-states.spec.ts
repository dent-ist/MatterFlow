import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { Observable, throwError } from 'rxjs';
import {
  FormsClient,
  StepDefinitionDetail,
  StepDefinitionsClient,
  WorkflowDetail,
  WorkflowsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { StubWorkflowLookup, WorkflowLookup } from '../../core/lookups/workflow-lookup';
import {
  FakeMeApi,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { apiError } from '../../core/lookups/lookups-testing';
import { FormDesignerApi, FormOwner } from './task-types/form-designer-api';
import { InMemoryFormDesignerApi } from './task-types/in-memory-form-designer-api';
import { InMemoryTaskTypesApi } from './task-types/in-memory-task-types-api';
import { TaskTypeEditPage } from './task-types/task-type-edit-page';
import { TaskTypeFormPage } from './task-types/task-type-form-page';
import { TaskTypesApi } from './task-types/task-types-api';
import { StepEditPage } from './steps/step-edit-page';
import { WorkflowEditPage } from './workflows/workflow-edit-page';
import { WorkflowVersionPage } from './workflows/workflow-version-page';

/** The Administration record pages answer a missing, forbidden or failing record with the shared record state (#353). */

interface Failure {
  status: number;
  what: 'notFound' | 'forbidden' | 'error';
}
const FAILURES: Failure[] = [
  { status: 404, what: 'notFound' },
  { status: 403, what: 'forbidden' },
  { status: 500, what: 'error' },
];

interface Case {
  name: string;
  noun: string;
  title: Record<Failure['what'], string>;
  crumbs: string[];
  permission: Permission;
  inputs: Record<string, unknown>;
  page: Type<unknown>;
  /** Providers that make the record's request fail with `error`, then succeed once `works` is set. */
  setup: (fail: () => Observable<never> | null) => unknown[];
}

const titles = (name: string, noun: string) => ({
  notFound: `${name} not found`,
  forbidden: `No access to this ${noun}`,
  error: `${name} could not be loaded`,
});

const wfDetail: WorkflowDetail = {
  workflow: {
    workflowDefinitionId: 10,
    name: 'Large Production Workflow',
    isActive: true,
    taskTypes: [],
    rowVersion: 'W',
  } as unknown as WorkflowDetail['workflow'],
  versions: [],
};

const stepDetail = {
  stepDefinitionId: 4,
  title: 'Deduplicate',
  isActive: true,
  draftFormFieldCount: 0,
  usage: [],
  tags: [],
  rowVersion: 'S',
} as unknown as StepDefinitionDetail;

class FailingTaskTypes extends InMemoryTaskTypesApi {
  fail: (() => Observable<never> | null) | null = null;
  override get(id: number) {
    return this.fail?.() ?? super.get(id);
  }
}

class FailingForms extends InMemoryFormDesignerApi {
  fail: (() => Observable<never> | null) | null = null;
  override getOwner(id: string): Observable<FormOwner> {
    return this.fail?.() ?? super.getOwner(id);
  }
}

const CASES: Case[] = [
  {
    name: 'Task type page',
    noun: 'task type',
    title: titles('Task type', 'task type'),
    crumbs: ['Administration', 'Task Types', 'Task type'],
    permission: 'TaskType.Manage',
    inputs: { id: '99999' },
    page: TaskTypeEditPage,
    setup: (fail) => {
      const api = new FailingTaskTypes();
      api.fail = fail;
      CURRENT.reset = () => (api.fail = null);
      return [
        { provide: TaskTypesApi, useValue: api },
        { provide: WorkflowLookup, useClass: StubWorkflowLookup },
      ];
    },
  },
  {
    name: 'Task type form page',
    noun: 'task type',
    title: titles('Task type', 'task type'),
    crumbs: ['Administration', 'Task Types', 'Task type'],
    permission: 'TaskType.Manage',
    inputs: { ownerId: '99999', ownerLabel: 'Task Type' },
    page: TaskTypeFormPage,
    setup: (fail) => {
      const api = new FailingForms();
      api.fail = fail;
      CURRENT.reset = () => (api.fail = null);
      return [{ provide: FormDesignerApi, useValue: api }];
    },
  },
  {
    name: 'Step form page',
    noun: 'step',
    title: titles('Step', 'step'),
    crumbs: ['Administration', 'Task Types', 'Workflow Steps', 'Step'],
    permission: 'Workflow.Manage',
    inputs: {
      ownerId: '99999',
      ownerLabel: 'Step',
      heading: 'Workflow Steps',
      sectionPath: '/admin/steps',
    },
    page: TaskTypeFormPage,
    setup: (fail) => {
      const api = new FailingForms();
      api.fail = fail;
      CURRENT.reset = () => (api.fail = null);
      return [{ provide: FormDesignerApi, useValue: api }];
    },
  },
  {
    name: 'Workflow page',
    noun: 'workflow',
    title: titles('Workflow', 'workflow'),
    crumbs: ['Administration', 'Task Types', 'Workflows', 'Workflow'],
    permission: 'Workflow.Manage',
    inputs: { workflowId: '99999' },
    page: WorkflowEditPage,
    setup: (fail) => {
      const client = {
        getWorkflow: vi.fn(() => fail() ?? ok(wfDetail)),
      };
      CURRENT.reset = () => (CURRENT.failing = false);
      return [{ provide: WorkflowsClient, useValue: client }];
    },
  },
  {
    name: 'Workflow version page',
    noun: 'workflow version',
    title: titles('Workflow version', 'workflow version'),
    crumbs: ['Administration', 'Task Types', 'Workflows', 'Large Production Workflow', 'Version'],
    permission: 'Workflow.Manage',
    inputs: { workflowId: '10', versionId: '99999' },
    page: WorkflowVersionPage,
    setup: (fail) => {
      const client = {
        getWorkflow: vi.fn(() => ok(wfDetail)),
        getWorkflowVersion: vi.fn(() => fail() ?? ok({})),
      };
      CURRENT.reset = () => (CURRENT.failing = false);
      return [
        { provide: WorkflowsClient, useValue: client },
        { provide: StepDefinitionsClient, useValue: {} },
        { provide: FormsClient, useValue: {} },
      ];
    },
  },
  {
    name: 'Step page',
    noun: 'step',
    title: titles('Step', 'step'),
    crumbs: ['Administration', 'Task Types', 'Workflow Steps', 'Step'],
    permission: 'Workflow.Manage',
    inputs: { stepId: '99999' },
    page: StepEditPage,
    setup: (fail) => {
      const client = { getStepDefinition: vi.fn(() => fail() ?? ok(stepDetail)) };
      CURRENT.reset = () => (CURRENT.failing = false);
      return [{ provide: StepDefinitionsClient, useValue: client }];
    },
  },
];

const CURRENT: { failing: boolean; reset: () => void } = { failing: true, reset: () => undefined };

describe('Administration record pages: not found, no access and failure (#353)', () => {
  for (const c of CASES) {
    for (const f of FAILURES) {
      it(`${c.name}: ${f.status} shows the shared state${f.what === 'error' ? ' with Retry' : ' without Retry'}`, async () => {
        CURRENT.failing = true;
        let error = apiError(f.status, 'X', 'raw server text 99999');
        const toasts = { add: vi.fn() };
        TestBed.configureTestingModule({
          providers: [
            provideRouter([]),
            { provide: MessageService, useValue: toasts },
            provideFakeMe(new FakeMeApi(withPermissions(c.permission, 'Workflow.Manage'))),
            ...(c.setup(() => (CURRENT.failing ? throwError(() => error) : null)) as never[]),
          ],
        });
        await TestBed.inject(AuthStore).ensureLoaded();
        const fixture: ComponentFixture<unknown> = TestBed.createComponent(c.page);
        for (const [k, v] of Object.entries(c.inputs)) fixture.componentRef.setInput(k, v);
        await settle(fixture);
        const el = fixture.nativeElement as HTMLElement;

        const state = el.querySelector('mf-record-state');
        expect(state).not.toBeNull();
        expect(el.querySelector('[data-record-state]')!.getAttribute('data-record-state')).toBe(
          f.what,
        );
        const heading = el.querySelector('h1')!.textContent!.trim();
        const text = {
          notFound: `We couldn't find that ${c.noun}.`,
          forbidden: `You don't have access to this ${c.noun}.`,
          error: `Couldn't load this ${c.noun}.`,
        }[f.what];
        expect(heading).toBe(text);
        // The raw id and the server's own text never reach the person.
        expect(el.textContent).not.toContain('99999');
        expect(el.textContent).not.toContain('raw server text');
        // Retry only when trying again can help.
        expect(el.querySelector('[data-retry]') !== null).toBe(f.what === 'error');
        expect(el.querySelector('[data-back-link]') !== null).toBe(f.what !== 'error');
        // The breadcrumb (the header) stays.
        const crumbs = Array.from(el.querySelectorAll('nav[aria-label="Breadcrumb"] li')).map(
          (li) => li.textContent!.trim(),
        );
        expect(crumbs).toEqual(c.crumbs);
        // The tab title names the state; one message only, no toast.
        expect(TestBed.inject(Title).getTitle()).toBe(`${c.title[f.what]} - MatterFlow`);
        expect(toasts.add).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(el.querySelector('h1'));

        if (f.what === 'error') {
          // Retry keeps the state on screen until the answer arrives, then shows the page.
          error = apiError(500, 'X', 'again');
          CURRENT.reset();
          el.querySelector<HTMLButtonElement>('[data-retry] button, button[data-retry]')!.click();
          await settle(fixture);
          if (c.page === TaskTypeEditPage) {
            // The in-memory stub has no record 99999: the retry reached it and got its real answer, a 404.
            expect(el.querySelector('[data-record-state]')!.getAttribute('data-record-state')).toBe(
              'notFound',
            );
          } else if (c.page !== WorkflowVersionPage && c.page !== TaskTypeFormPage) {
            expect(el.querySelector('mf-record-state')).toBeNull();
          }
        }
      });
    }
  }

  it('Workflow version page: a missing version keeps the workflow link in the crumb; a missing workflow shows none', async () => {
    const wf = { getWorkflow: vi.fn(() => throwError(() => apiError(404, 'X', 'x'))) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions('Workflow.Manage'))),
        {
          provide: WorkflowsClient,
          useValue: { ...wf, getWorkflowVersion: () => throwError(() => apiError(404, 'X', 'x')) },
        },
        { provide: StepDefinitionsClient, useValue: {} },
        { provide: FormsClient, useValue: {} },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(WorkflowVersionPage);
    fixture.componentRef.setInput('workflowId', '99999');
    fixture.componentRef.setInput('versionId', '1');
    await settle(fixture);
    const crumbs = Array.from(fixture.nativeElement.querySelectorAll('nav li')).map((li) =>
      (li as HTMLElement).textContent!.trim(),
    );
    expect(crumbs).toEqual(['Administration', 'Task Types', 'Workflows', 'Version']);
  });
});
