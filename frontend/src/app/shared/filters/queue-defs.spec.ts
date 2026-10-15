import { convertToParamMap } from '@angular/router';
import { parseQueueState } from '../work-queue/queue-filters';
import { parseFilters, serializeFilters } from './filter-def';
import { queueFilterDefs } from './queue-defs';

/**
 * Link contract: the shared filters read every deep link the app generates (dashboard tiles and breakdowns, trend legends, the
 * swimlane's "Open in queue", Advanced search) to the same filters as `QueueFilters`, and write the same parameters back. This is what
 * allows the work lists to move to `ListFilters` one screen at a time.
 */
describe('work list filters on the shared definitions', () => {
  const defs = queueFilterDefs();
  const LINKS: Record<string, Record<string, string | string[]>> = {
    'overdue tile': { overdue: 'true', status: ['NEW', 'IN_PROGRESS'] },
    'unassigned tile': { unassigned: 'true', status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] },
    'assignee and priority': { assignee: ['7', '9'], priority: '2' },
    'my pod': { pod: '3', status: 'NEW' },
    'no pod': { noPod: 'true', status: ['NEW', 'ON_HOLD'] },
    'created in a period': { createdFrom: '2026-10-01', createdTo: '2026-10-07' },
    'completed in a period': { status: 'COMPLETED', completedFrom: '2026-09-15' },
    'due window': { dueFrom: '2026-10-12', dueTo: '2026-10-18', asap: 'false' },
    'client, matter, project': { client: '4', matter: '12', project: '3' },
    'type, workflow, creator, requestor': {
      type: ['5', '6'],
      workflow: '2',
      creator: '8',
      requestor: 'Smith',
    },
    search: { q: 'merger' },
    'status given in lower case': { status: 'new' },
  };

  for (const [name, link] of Object.entries(LINKS)) {
    it(`reads "${name}" like QueueFilters and writes it back unchanged`, () => {
      const params = convertToParamMap(link);
      const queue = parseQueueState(params).filters;
      const values = parseFilters(defs, params);

      expect(values['status']).toEqual(queue.status);
      expect(values['priority']).toEqual(queue.priority.map(String));
      const pod = values['pod'] as string[];
      expect(pod.filter((v) => v !== 'none')).toEqual(queue.pod.map(String));
      expect(pod.includes('none')).toBe(queue.noPod);
      const assignee = values['assignee'] as string[];
      expect(assignee.filter((v) => v !== 'unassigned')).toEqual(queue.assignee.map(String));
      expect(assignee.includes('unassigned')).toBe(queue.unassigned);
      expect(values['creator']).toEqual(queue.creator.map(String));
      expect(values['type']).toEqual(queue.type.map(String));
      expect(values['workflow']).toEqual(queue.workflow.map(String));
      expect(values['client']).toBe(queue.client === null ? '' : String(queue.client));
      expect(values['matter']).toBe(queue.matter === null ? '' : String(queue.matter));
      expect(values['project']).toBe(queue.project === null ? '' : String(queue.project));
      expect(values['q']).toBe(queue.q);
      expect(values['requestor']).toBe(queue.requestor);
      expect(values['due']).toEqual({ from: queue.dueFrom ?? '', to: queue.dueTo ?? '' });
      expect(values['created']).toEqual({
        from: queue.createdFrom ?? '',
        to: queue.createdTo ?? '',
      });
      expect(values['completed']).toEqual({
        from: queue.completedFrom ?? '',
        to: queue.completedTo ?? '',
      });
      expect(values['asap']).toBe(queue.asap === null ? '' : String(queue.asap));
      expect(values['overdue']).toBe(queue.overdue === null ? '' : String(queue.overdue));

      // And back: the same parameters (status codes upper-cased, as QueueFilters writes them).
      const written = Object.fromEntries(
        Object.entries(serializeFilters(defs, values)).filter(([, v]) => v !== null),
      );
      const expected = Object.fromEntries(
        Object.entries(link).map(([k, v]) => [
          k,
          k === 'status' ? [v].flat().map((s) => s.toUpperCase()) : v,
        ]),
      );
      const norm = (o: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [v].flat().map(String)]));
      expect(norm(written)).toEqual(norm(expected));
    });
  }

  it('drops malformed ids and unknown status codes like QueueFilters does', () => {
    const params = convertToParamMap({
      priority: ['x', '3'],
      status: ['BOGUS', 'NEW'],
      client: '-2',
    });
    const values = parseFilters(defs, params);
    expect(values['priority']).toEqual(['3']);
    expect(values['status']).toEqual(['NEW']);
    expect(values['client']).toBe('');
    expect(parseQueueState(params).filters.priority).toEqual([3]);
  });
});
