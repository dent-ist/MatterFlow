import { onlyWorkflowOf } from './workflow-impact';

const type = (name: string, ids: number[], isActive = true) => ({
  name,
  isActive,
  eligibleWorkflowIds: ids,
});

describe('onlyWorkflowOf', () => {
  const workflows = [
    { id: 1, name: 'This', publishedVersionNo: 2, isActive: true },
    { id: 2, name: 'Other published', publishedVersionNo: 1, isActive: true },
    { id: 3, name: 'Other draft only', isActive: true },
    { id: 4, name: 'Other inactive', publishedVersionNo: 1, isActive: false },
  ];

  it('lists the active task types that have no other published, active workflow, by name', () => {
    const names = onlyWorkflowOf(
      1,
      [
        type('Billing request 02', [1]),
        type('Has another', [1, 2]),
        type('Other is a draft', [1, 3]),
        type('Other is inactive', [1, 4]),
        type('Inactive type', [1], false),
        type('A first', [1]),
      ],
      workflows,
    );
    expect(names).toEqual([
      'A first',
      'Billing request 02',
      'Other is a draft',
      'Other is inactive',
    ]);
  });

  it('lists nothing when every type has another workflow', () => {
    expect(onlyWorkflowOf(1, [type('X', [1, 2])], workflows)).toEqual([]);
  });
});
