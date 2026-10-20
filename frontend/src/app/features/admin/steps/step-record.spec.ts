import {
  FormVersionStatus,
  FormVersionSummary,
  StepDefinitionDetail,
  StepUsage,
  WorkflowVersionStatus,
} from '../../../api/generated/api-client';
import {
  inputRows,
  inputsFacts,
  inputsStripValue,
  stepStripItems,
  stepTabOf,
  usageCounts,
  usedByWorkflows,
  usedWorkflowCount,
} from './step-record';

const use = (
  wf: number,
  name: string,
  version: number,
  vNo: number,
  status: WorkflowVersionStatus,
): StepUsage => ({
  workflowDefinitionId: wf,
  workflowName: name,
  workflowVersionId: version,
  versionNo: vNo,
  status,
});

const usage = [
  use(1, 'Alpha', 11, 2, WorkflowVersionStatus.Draft),
  use(1, 'Alpha', 10, 1, WorkflowVersionStatus.Published),
  use(2, 'Beta', 20, 3, WorkflowVersionStatus.Published),
  use(2, 'Beta', 19, 2, WorkflowVersionStatus.Retired),
];

const version = (status: FormVersionStatus, versionNo: number, fieldCount: number) =>
  ({ formVersionId: 100 + versionNo, versionNo, status, fieldCount }) as FormVersionSummary;

const step = (o: Partial<StepDefinitionDetail> = {}): StepDefinitionDetail => ({
  stepDefinitionId: 4,
  title: 'Deduplicate',
  description: undefined,
  instructions: undefined,
  documentationUrl: undefined,
  isActive: true,
  formDefinitionId: 9,
  publishedFormVersionId: undefined,
  draftFormFieldCount: 0,
  usage: [],
  tags: [],
  rowVersion: 'A',
  ...o,
});

describe('stepTabOf', () => {
  it('knows the three tabs and sends an unsaved step to Details', () => {
    expect(stepTabOf(undefined, false)).toBe('details');
    expect(stepTabOf('inputs', false)).toBe('inputs');
    expect(stepTabOf('used-by', false)).toBe('used-by');
    expect(stepTabOf('nonsense', false)).toBe('details');
    expect(stepTabOf('inputs', true)).toBe('details');
  });
});

describe('usedByWorkflows', () => {
  it('groups the versions by workflow in the order the API sent them and labels each line', () => {
    const groups = usedByWorkflows(usage, null);
    expect(groups.map((g) => g.name)).toEqual(['Alpha', 'Beta']);
    expect(groups[0].versions.map((v) => [v.label, v.status])).toEqual([
      ['Alpha v2', 'Draft'],
      ['Alpha v1', 'Published'],
    ]);
    expect(groups[1].versions[1].status).toBe('Retired');
  });

  it('counts workflows, not versions, and leaves out a workflow known to be deactivated', () => {
    expect(usedWorkflowCount(usedByWorkflows(usage, null))).toBe(2);
    expect(
      usedWorkflowCount(
        usedByWorkflows(
          usage,
          new Map([
            [1, true],
            [2, false],
          ]),
        ),
      ),
    ).toBe(1);
    expect(usedWorkflowCount(usedByWorkflows([], null))).toBe(0);
  });

  it('counts drafts and published versions for the Deactivate dialog', () => {
    expect(usageCounts(usage)).toEqual({ drafts: 1, published: 2 });
    expect(usageCounts([])).toEqual({ drafts: 0, published: 0 });
  });
});

describe('inputsFacts', () => {
  it('tells none, draft, published and published with a newer draft apart', () => {
    expect(inputsFacts(step(), null).state).toBe('none');
    expect(inputsFacts(step({ draftFormFieldCount: 3 }), null).state).toBe('draft');
    expect(inputsFacts(step({ publishedFormVersionId: 7 }), null).state).toBe('published');
    expect(
      inputsFacts(step({ publishedFormVersionId: 7, draftFormFieldCount: 2 }), null).state,
    ).toBe('both');
  });

  it('adds version numbers and the published field count once the versions are known', () => {
    const versions = [
      version(FormVersionStatus.Draft, 3, 5),
      version(FormVersionStatus.Published, 2, 4),
    ];
    const f = inputsFacts(step({ publishedFormVersionId: 7, draftFormFieldCount: 5 }), versions);
    expect(f.published).toEqual({ versionNo: 2, fieldCount: 4 });
    expect(f.draft).toEqual({ versionNo: 3, fieldCount: 5 });
  });

  it('never invents a number the API did not return', () => {
    const f = inputsFacts(step({ publishedFormVersionId: 7 }), null);
    expect(f.published).toBeNull();
    expect(inputsStripValue(f)).toBe('Published');
  });
});

describe('inputsStripValue and the strip', () => {
  it('reads None, n inputs, Draft with its count, and a newer draft', () => {
    expect(inputsStripValue(inputsFacts(step(), null))).toBe('None');
    expect(inputsStripValue(inputsFacts(step({ draftFormFieldCount: 1 }), null))).toBe(
      'Draft, 1 input',
    );
    const versions = [version(FormVersionStatus.Published, 1, 4)];
    expect(inputsStripValue(inputsFacts(step({ publishedFormVersionId: 7 }), versions))).toBe(
      '4 inputs',
    );
    expect(
      inputsStripValue(
        inputsFacts(step({ publishedFormVersionId: 7, draftFormFieldCount: 2 }), versions),
      ),
    ).toBe('4 inputs, newer draft');
  });

  it('shows Status, Used in workflows (Not used at zero, -- while unknown), Inputs and Tags', () => {
    const s = step({ tags: ['Relativity', 'QC'] });
    const items = stepStripItems(s, 3, inputsFacts(s, null));
    expect(items.map((i) => i.key)).toEqual(['status', 'used', 'inputs', 'tags']);
    expect(items[0].value).toBe('Active');
    expect(items[1].count).toBe(3);
    expect(items[1].hint).toBe('Used in 3 workflows');
    expect(items[3].value).toBe('Relativity, QC');
    expect(stepStripItems(s, 0, inputsFacts(s, null))[1].value).toBe('Not used');
    expect(stepStripItems(s, null, inputsFacts(s, null))[1].count).toBeNull();
    expect(stepStripItems(step({ isActive: false }), 1, inputsFacts(s, null))[0].value).toBe(
      'Inactive',
    );
    expect(stepStripItems(step(), 1, inputsFacts(step(), null))[3].value).toBe('None');
  });
});

describe('inputRows', () => {
  it('keeps label, control and required in form order', () => {
    expect(
      inputRows([
        { key: 'a', label: 'Items in', control: 'NUMBER', required: true },
        { key: 'b', label: 'Notes', control: 'TEXTAREA' },
      ]),
    ).toEqual([
      { key: 'a', label: 'Items in', control: 'NUMBER', required: true },
      { key: 'b', label: 'Notes', control: 'TEXTAREA', required: false },
    ]);
  });
});
