import { FormVersionStatus } from '../../../api/generated/api-client';
import { WorkflowOption } from '../../../core/lookups/workflow-lookup';
import {
  activeWorkflowCount,
  formStateOf,
  formTabFacts,
  noteReasonsOf,
  statusBadgeOf,
  tabOf,
  taskTypeStripItems,
} from './task-type-record';
import { TaskTypeView } from './task-types-api';
import {
  removeWorkflow,
  addWorkflow,
  workflowChoices,
  workflowRows,
} from './task-type-workflows-tab';

const type = (extra: Partial<TaskTypeView> = {}): TaskTypeView => ({
  id: 7,
  name: 'Quick Request',
  description: undefined,
  iconKey: 'file-text',
  isActive: true,
  defaultWorkflowDefinitionId: 1,
  eligibleWorkflowIds: [1, 2],
  formDefinitionId: 7,
  formStatus: FormVersionStatus.Published,
  publishedFormVersionId: 5,
  publishedFormVersionNo: 2,
  draftFormVersionNo: undefined,
  hasFormFields: true,
  isUsable: true,
  usabilityIssues: [],
  rowVersion: 'x',
  openTaskCount: 14,
  ...extra,
});

const wf = (id: number, name: string, extra: Partial<WorkflowOption> = {}): WorkflowOption => ({
  id,
  name,
  publishedVersionNo: 1,
  ...extra,
});

describe('task type record helpers', () => {
  it('reads the tab from the address: Overview unless it names an openable tab', () => {
    expect(tabOf(undefined, false)).toBe('overview');
    expect(tabOf('workflows', false)).toBe('workflows');
    expect(tabOf('form', false)).toBe('form');
    expect(tabOf('form', true)).toBe('overview');
    expect(tabOf('nonsense', false)).toBe('overview');
  });

  it('badges Inactive and Not usable as neutral and Active as success', () => {
    expect(statusBadgeOf({ isActive: false, isUsable: false })).toMatchObject({
      label: 'Inactive',
      tone: 'neutral',
    });
    expect(statusBadgeOf({ isActive: true, isUsable: false })).toMatchObject({
      label: 'Not usable',
      tone: 'neutral',
    });
    expect(statusBadgeOf({ isActive: true, isUsable: true })).toMatchObject({
      label: 'Active',
      tone: 'success',
    });
  });

  it('counts active workflows only; an id the lookup does not know counts', () => {
    const list = [wf(1, 'A'), wf(2, 'B', { isActive: false })];
    expect(activeWorkflowCount([1, 2, 9], list)).toBe(2);
    expect(activeWorkflowCount([1, 2], [])).toBe(2);
  });

  it('words the form state', () => {
    expect(formStateOf(type())).toBe('Published v2');
    expect(formStateOf(type({ formStatus: FormVersionStatus.Draft, draftFormVersionNo: 3 }))).toBe(
      'Draft v3',
    );
    expect(formStateOf(type({ formStatus: undefined }))).toBe('No form');
  });

  it('builds the strip with Open tasks as a link into the Task Queue, absent without a number', () => {
    const items = taskTypeStripItems(type(), [wf(1, 'Standard'), wf(2, 'Other')]);
    expect(items.map((i) => i.key)).toEqual(['form', 'workflows', 'default', 'open', 'status']);
    const open = items.find((i) => i.key === 'open')!;
    expect(open.count).toBe(14);
    expect(open.link).toEqual({
      path: '/tasks',
      queryParams: { type: '7', status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] },
    });
    expect(items.find((i) => i.key === 'default')!.value).toBe('Standard');
    expect(
      taskTypeStripItems(type({ openTaskCount: undefined }), []).some((i) => i.key === 'open'),
    ).toBe(false);
  });

  it('names every reason combination with its fix and nothing for a usable type', () => {
    expect(noteReasonsOf(type())).toEqual([]);
    const reasons = noteReasonsOf(
      type({
        isUsable: false,
        usabilityIssues: ['FORM_NOT_PUBLISHED', 'NO_ELIGIBLE_WORKFLOW'],
      }),
    );
    expect(reasons.map((r) => `${r.text} ${r.fixLabel}`)).toEqual([
      "The request form isn't published. Open the form",
      'No eligible published workflow. Add one',
    ]);
    expect(
      noteReasonsOf(type({ isUsable: false, usabilityIssues: ['INACTIVE'] }))[0],
    ).toMatchObject({ text: 'The task type is inactive.', fix: 'activate' });
  });

  it('gives the Request form tab its facts: none, draft only, published, published and draft', () => {
    const versions = [
      { status: 'PUBLISHED', versionNo: 2, fieldCount: 4, publishedAtUtc: '2026-10-19T10:00:00Z' },
    ];
    expect(formTabFacts(type(), versions).published).toEqual({
      versionNo: 2,
      fields: 4,
      at: '2026-10-19T10:00:00Z',
    });
    const both = formTabFacts(type({ draftFormVersionNo: 3 }), versions);
    expect(both.published?.versionNo).toBe(2);
    expect(both.draftVersionNo).toBe(3);
    const draft = formTabFacts(
      type({
        formStatus: FormVersionStatus.Draft,
        publishedFormVersionNo: undefined,
        draftFormVersionNo: 1,
      }),
      null,
    );
    expect(draft.published).toBeNull();
    expect(draft.draftVersionNo).toBe(1);
    const none = formTabFacts(
      type({ formStatus: undefined, publishedFormVersionNo: undefined }),
      null,
    );
    expect(none).toEqual({ published: null, draftVersionNo: null, retired: false });
  });
});

describe('Workflows tab rules', () => {
  const list = [
    wf(1, 'Standard'),
    wf(2, 'Alpha'),
    wf(3, 'Draft only', { publishedVersionNo: undefined, hasDraft: true }),
    wf(4, 'Retired one', { isActive: false }),
    wf(5, 'Beta'),
  ];

  it('orders rows by name with unknown ids last', () => {
    expect(workflowRows([1, 2, 99], list).map((r) => r.name)).toEqual([
      'Alpha',
      'Standard',
      'Workflow 99',
    ]);
    expect(workflowRows([99], list)[0].known).toBe(false);
  });

  it('lists addable workflows first and the others disabled with their reason, hiding added ones', () => {
    const choices = workflowChoices([1], list, '');
    expect(choices.map((c) => [c.name, c.reason])).toEqual([
      ['Alpha', null],
      ['Beta', null],
      ['Draft only', 'No published version'],
      ['Retired one', 'Inactive'],
    ]);
    expect(workflowChoices([], list, ' BE ').map((c) => c.name)).toEqual(['Beta']);
  });

  it('adds: the first added becomes the default, later ones do not', () => {
    expect(addWorkflow([], null, { id: 2, name: 'Alpha' })).toMatchObject({
      eligible: [2],
      defaultId: 2,
    });
    expect(addWorkflow([2], 2, { id: 5, name: 'Beta' })).toMatchObject({
      eligible: [2, 5],
      defaultId: 2,
      message: 'Beta added.',
    });
  });

  it('removes: removing the default moves it to the next row, else the previous, else none', () => {
    const rows = workflowRows([1, 2, 5], list); // Alpha (2), Beta (5), Standard (1)
    // The first row is the default: the next row takes over.
    const first = removeWorkflow(rows, [1, 2, 5], 2, rows[0]);
    expect(first).toMatchObject({ eligible: [1, 5], defaultId: 5 });
    expect(first.message).toBe('Alpha removed. Beta is now the default workflow.');
    // The last row is the default: the previous row takes over.
    const last = removeWorkflow(rows, [1, 2, 5], 1, rows[2]);
    expect(last).toMatchObject({ eligible: [2, 5], defaultId: 5 });
    // A row that is not the default leaves the default alone.
    expect(removeWorkflow(rows, [1, 2, 5], 2, rows[1])).toMatchObject({
      eligible: [1, 2],
      defaultId: 2,
      message: 'Beta removed.',
    });
    const only = workflowRows([1], list);
    expect(removeWorkflow(only, [1], 1, only[0])).toMatchObject({
      eligible: [],
      defaultId: null,
      message: 'Standard removed. There is no default workflow.',
    });
  });
});
