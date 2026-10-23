import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { UsersLookupClient } from '../../api/generated/api-client';
import { USER_TIME_ZONE } from '../../core/time/clock';
import {
  AssigneeContext,
  AssigneeLists,
  POD_COUNT,
  SEARCH_COUNT,
  SUGGESTION_COUNT,
} from './assignee-list';
import { aLookupItem } from './assignee-testing';

describe('AssigneeList (the one logic behind the three assignee pickers)', () => {
  let lookup: ReturnType<typeof vi.fn>;
  let context: AssigneeContext;

  const make = () => TestBed.inject(AssigneeLists).create(() => context);

  beforeEach(() => {
    context = { podId: null, taskTypeId: 7 };
    lookup = vi.fn(() => of([]));
    TestBed.configureTestingModule({
      providers: [
        { provide: UsersLookupClient, useValue: { lookupUsers: lookup } },
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
      ],
    });
  });

  it('a Task without a Pod opens on the Suggested list: top few, asked for as suggestions with the Task Type', async () => {
    lookup.mockReturnValue(
      of([
        aLookupItem({ userId: 2, displayName: 'Bea', openTaskCount: 1 }),
        aLookupItem({ userId: 1, displayName: 'Al', openTaskCount: 4 }),
      ]),
    );
    const list = make();
    await list.open();
    expect(lookup).toHaveBeenCalledWith(undefined, SUGGESTION_COUNT, undefined, 7, true);
    expect(list.mode()).toBe('suggested');
    expect(list.heading()).toBe('Suggested');
    expect(list.canSearchAll()).toBe(false);
    // The server's order is kept (Bea before Al although Al sorts first by name); the hint is the open count.
    expect(list.items().map((p) => [p.id, p.hint])).toEqual([
      [2, '1 open'],
      [1, '4 open'],
    ]);
  });

  it('a Task in a Pod opens on the Pod members, ranked by the server, with a way to search everyone', async () => {
    context = { podId: 5, taskTypeId: 7 };
    lookup.mockReturnValue(of([aLookupItem({ userId: 3, openTaskCount: 0 })]));
    const list = make();
    await list.open();
    expect(lookup).toHaveBeenCalledWith(undefined, POD_COUNT, 5, 7, undefined);
    expect(list.mode()).toBe('pod');
    expect(list.heading()).toBeNull();
    expect(list.canSearchAll()).toBe(true);

    lookup.mockReturnValue(of([aLookupItem({ userId: 9 })]));
    await list.search(' sam ');
    expect(lookup).toHaveBeenLastCalledWith('sam', POD_COUNT, 5, 7, undefined);
    expect(list.mode()).toBe('pod');

    await list.searchAll();
    expect(lookup).toHaveBeenLastCalledWith(undefined, SUGGESTION_COUNT, undefined, 7, true);
    expect(list.mode()).toBe('suggested');
    expect(list.canSearchAll()).toBe(false);

    await list.search('User 1');
    expect(lookup).toHaveBeenLastCalledWith('User 1', SEARCH_COUNT, undefined, 7, undefined);
    expect(list.mode()).toBe('search');
    expect(list.heading()).toBeNull();

    // Emptying the box goes back to Suggested, not to the Pod: the person chose to leave it.
    await list.search('');
    expect(list.mode()).toBe('suggested');
  });

  it('opening again starts from the Pod again', async () => {
    context = { podId: 5 };
    lookup.mockReturnValue(of([aLookupItem({ userId: 3 })]));
    const list = make();
    await list.open();
    await list.searchAll();
    await list.open();
    expect(list.mode()).toBe('pod');
  });

  it('a Pod with nobody to offer falls back to Suggested instead of an empty menu', async () => {
    context = { podId: 5 };
    lookup.mockImplementation((_q?: string, _l?: number, podId?: number) =>
      of(podId ? [] : [aLookupItem({ userId: 4 })]),
    );
    const list = make();
    await list.open();
    expect(list.mode()).toBe('suggested');
    expect(list.items().map((p) => p.id)).toEqual([4]);
  });

  it('marks people who are out of office with the return date and keeps them selectable', async () => {
    lookup.mockReturnValue(
      of([
        aLookupItem({
          userId: 4,
          availability: { state: 'OUT_OF_OFFICE', outUntil: '2099-03-21T12:00:00Z' },
        }),
      ]),
    );
    const list = make();
    await list.search('x');
    expect(list.items()[0].flag).toMatch(/^Out of office until Mar 2[01], 2099$/);
  });

  it('only the answer to the latest request is shown, and a failed lookup shows an empty list', async () => {
    const slow = new Subject<unknown[]>();
    lookup.mockReturnValueOnce(slow);
    const list = make();
    const first = list.search('a');
    lookup.mockReturnValue(of([aLookupItem({ userId: 2 })]));
    await list.search('ab');
    slow.next([aLookupItem({ userId: 1 })]);
    slow.complete();
    await first;
    expect(list.items().map((p) => p.id)).toEqual([2]);

    lookup.mockReturnValue(throwError(() => new Error('500')));
    await list.search('abc');
    expect(list.items()).toEqual([]);
    expect(list.loading()).toBe(false);
  });
});
