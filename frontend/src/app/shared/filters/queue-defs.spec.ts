import { convertToParamMap } from '@angular/router';
import { parseQueueState } from '../work-queue/queue-filters';
import { parseFilters, serializeFilters } from './filter-def';
import { builtInFilters, emptyFilters } from '../work-queue/queue-filters';
import {
  QUEUE_FILTER_PARAMS,
  filtersToValues,
  queueFilterDefs,
  withoutFilters,
} from './queue-defs';

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

describe('work list definitions for the column filters', () => {
  it('puts every filter on the column of the same name, Title or Ref across Ref and Title', () => {
    const defs = queueFilterDefs();
    const column = (key: string) => defs.find((d) => d.key === key)?.column;
    expect(column('q')).toBe('ref');
    expect(defs.find((d) => d.key === 'q')?.span).toBe(2);
    expect(
      Object.fromEntries(
        [
          'matterText',
          'clientText',
          'projectText',
          'type',
          'workflow',
          'priority',
          'pod',
          'assignee',
          'creator',
          'requestor',
          'due',
          'status',
          'created',
          'updated',
        ].map((k) => [k, column(k)]),
      ),
    ).toEqual({
      matterText: 'matter',
      clientText: 'client',
      projectText: 'project',
      type: 'type',
      workflow: 'workflow',
      priority: 'priority',
      pod: 'pod',
      assignee: 'assignee',
      creator: 'creator',
      requestor: 'requestor',
      due: 'due',
      status: 'status',
      created: 'created',
      updated: 'updated',
    });
    // ASAP, Overdue and Closed have no column: they are in More filters. The id parameters of links have no control at all.
    for (const key of ['asap', 'overdue', 'completed']) expect(column(key)).toBeUndefined();
    for (const key of ['client', 'matter', 'project'])
      expect(defs.find((d) => d.key === key)?.noControl).toBe(true);
  });

  it('keeps the parameter names of the API, new ones included', () => {
    expect([...QUEUE_FILTER_PARAMS].sort()).toEqual(
      [
        'q',
        'status',
        'matterText',
        'clientText',
        'projectText',
        'type',
        'workflow',
        'priority',
        'pod',
        'noPod',
        'assignee',
        'unassigned',
        'creator',
        'requestor',
        'dueFrom',
        'dueTo',
        'createdFrom',
        'createdTo',
        'updatedFrom',
        'updatedTo',
        'completedFrom',
        'completedTo',
        'asap',
        'overdue',
        'client',
        'matter',
        'project',
      ].sort(),
    );
  });

  it('reads the new text and updated parameters', () => {
    const defs = queueFilterDefs();
    const values = parseFilters(
      defs,
      convertToParamMap({
        matterText: '343-12',
        clientText: 'Acme',
        projectText: 'Phase',
        updatedFrom: '2026-10-01',
      }),
    );
    expect(values['matterText']).toBe('343-12');
    expect(values['clientText']).toBe('Acme');
    expect(values['projectText']).toBe('Phase');
    expect(values['updated']).toEqual({ from: '2026-10-01', to: '' });
  });

  it('leaves out what a page does not filter (Pod Work has no Pod) and disables what a tab owns', () => {
    const noPod = queueFilterDefs({}, { omit: ['pod'] });
    expect(noPod.some((d) => d.key === 'pod')).toBe(false);

    const defs = queueFilterDefs(
      {},
      {
        disabled: { assignee: () => 'This tab lists the tasks assigned to you.', due: () => 'Tab' },
      },
    );
    expect(defs.find((d) => d.key === 'assignee')?.disabledReason?.()).toContain('assigned to you');
    // ASAP and Overdue follow Due.
    expect(defs.find((d) => d.key === 'asap')?.disabledReason?.()).toBe('Tab');
    expect(defs.find((d) => d.key === 'overdue')?.disabledReason?.()).toBe('Tab');
    expect(defs.find((d) => d.key === 'priority')?.disabledReason).toBeUndefined();
  });

  it('gives a screen a default status for a plain link only', () => {
    const status = queueFilterDefs({}, { defaultStatus: ['NEW', 'ON_HOLD'] }).find(
      (d) => d.key === 'status',
    )!;
    expect(status.default).toEqual(['NEW', 'ON_HOLD']);
    expect(status.defaultOnlyBare).toBe(true);
    expect(queueFilterDefs().find((d) => d.key === 'status')?.default).toBeUndefined();
  });

  it('turns the filters a tab owns into nothing before they reach the API', () => {
    const f = {
      ...emptyFilters(),
      assignee: [3],
      unassigned: true,
      creator: [4],
      dueFrom: '2026-10-01',
      asap: true,
      overdue: false,
      pod: [1],
      noPod: true,
      priority: [2],
      status: ['NEW'],
    };
    const out = withoutFilters(f, ['assignee', 'due', 'asap', 'overdue', 'pod', 'status']);
    expect(out.assignee).toEqual([]);
    expect(out.unassigned).toBe(false);
    expect(out.dueFrom).toBeNull();
    expect(out.asap).toBeNull();
    expect(out.overdue).toBeNull();
    expect(out.pod).toEqual([]);
    expect(out.noPod).toBe(false);
    expect(out.status).toEqual([]);
    expect(out.creator).toEqual([4]);
    expect(out.priority).toEqual([2]);
  });

  it('turns the quick views into filter values and back into the same parameters', () => {
    const defs = queueFilterDefs({}, { defaultStatus: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] });
    const ctx = { userId: 9, primaryPodId: 5, recentFrom: '2026-09-14' };
    const view = (key: Parameters<typeof builtInFilters>[0]) =>
      serializeFilters(defs, filtersToValues(builtInFilters(key, ctx)));
    const set = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => v !== null);

    expect(set(view('allOpen'))).toEqual([]);
    expect(Object.fromEntries(set(view('unassigned')))).toEqual({ unassigned: 'true' });
    expect(Object.fromEntries(set(view('overdue')))).toEqual({ overdue: 'true' });
    expect(Object.fromEntries(set(view('myPod')))).toEqual({ pod: ['5'] });
    expect(Object.fromEntries(set(view('createdByMe')))).toEqual({ creator: ['9'], status: '' });
    expect(Object.fromEntries(set(view('recentlyCompleted')))).toEqual({
      status: ['COMPLETED'],
      completedFrom: '2026-09-14',
    });
  });
});
