import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { WorkflowsClient } from '../../api/generated/api-client';
import { HttpWorkflowLookup } from './workflow-lookup';

describe('HttpWorkflowLookup', () => {
  it('reads every page of /workflows and maps names, published versions and active state', async () => {
    const item = (id: number, extra: object = {}) => ({
      workflowDefinitionId: id,
      name: `Workflow ${id}`,
      isActive: true,
      rowVersion: 'x',
      ...extra,
    });
    const listWorkflows = vi
      .fn()
      .mockReturnValueOnce(
        of({ items: [item(1, { publishedVersionNo: 3 })], total: 2, page: 1, pageSize: 1 }),
      )
      .mockReturnValueOnce(
        of({ items: [item(2, { isActive: false })], total: 2, page: 2, pageSize: 1 }),
      );
    TestBed.configureTestingModule({
      providers: [HttpWorkflowLookup, { provide: WorkflowsClient, useValue: { listWorkflows } }],
    });
    const options = await firstValueFrom(TestBed.inject(HttpWorkflowLookup).list());
    expect(listWorkflows).toHaveBeenCalledTimes(2);
    expect(options).toEqual([
      { id: 1, name: 'Workflow 1', publishedVersionNo: 3, isActive: true },
      { id: 2, name: 'Workflow 2', publishedVersionNo: undefined, isActive: false },
    ]);
  });
});
