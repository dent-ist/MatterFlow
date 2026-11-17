import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TaskTypesClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionReset } from '../../core/session/session-reset';
import { SectionTypes } from './section-types';

describe('SectionTypes', () => {
  const api = { listTaskTypes: vi.fn() };
  let roles: string[];
  let userId: number;
  const flush = () => new Promise((r) => setTimeout(r));

  function create() {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthStore,
          useValue: {
            has: () => true,
            profile: () => ({ userId, isSystemAdmin: false, roles }),
          },
        },
        { provide: TaskTypesClient, useValue: api },
      ],
    });
    return TestBed.inject(SectionTypes);
  }

  beforeEach(() => {
    roles = ['Reviewer'];
    userId = 1;
    api.listTaskTypes.mockReset().mockReturnValue(
      of([
        { id: 2, name: 'Review', iconKey: 'cpu-2', isActive: true },
        { id: 1, name: 'Archive', iconKey: 'cpu-2', isActive: false },
      ]),
    );
  });

  it('asks only for the types the person may see, sorted by name', async () => {
    const types = create();
    types.ensure();
    await flush();
    expect(api.listTaskTypes).toHaveBeenCalledWith(undefined, undefined, true);
    expect(types.options().map((o) => o.name)).toEqual(['Archive', 'Review']);
  });

  it('reads once per person and role set; a role change or another person reads again (epic #1397)', async () => {
    const types = create();
    types.ensure();
    types.ensure();
    await flush();
    expect(api.listTaskTypes).toHaveBeenCalledTimes(1);

    roles = [];
    types.ensure();
    await flush();
    expect(api.listTaskTypes).toHaveBeenCalledTimes(2);

    TestBed.inject(SessionReset).run();
    expect(types.options()).toEqual([]);
    userId = 2;
    types.ensure();
    await flush();
    expect(api.listTaskTypes).toHaveBeenCalledTimes(3);
  });
});
