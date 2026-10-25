import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { FakeMeApi, profileOf, provideFakeMe } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { PageScope, namesOwnMatters } from './page-scope';

async function pageScope(
  query: Record<string, string>,
  options: { plain?: boolean; own?: string[]; all?: boolean } = {},
) {
  localStorage.clear();
  const params$ = new BehaviorSubject(convertToParamMap(query));
  const navigate = vi.fn(() => Promise.resolve(true));
  TestBed.configureTestingModule({
    providers: [
      provideFakeMe(
        new FakeMeApi(
          profileOf({
            userId: 7,
            permissions: [
              'Matter.View',
              'Matter.BeManager',
              ...(options.all ? (['Matter.AssignManagers'] as const) : []),
            ],
            roles: ['Test'],
          }),
        ),
      ),
      {
        provide: ActivatedRoute,
        useValue: { queryParamMap: params$, snapshot: { queryParamMap: params$.value } },
      },
      { provide: Router, useValue: { navigate } },
    ],
  });
  await TestBed.inject(AuthStore).ensureLoaded();
  const scope = TestBed.runInInjectionContext(
    () =>
      new PageScope(
        'task-queue',
        () => options.plain ?? false,
        () => false,
        options.own ?? [],
      ),
  );
  TestBed.tick();
  return { scope, navigate, params$ };
}

describe('namesOwnMatters', () => {
  it('is true only for the own filter set to true', () => {
    const p = (s: string) => new URLSearchParams(s);
    expect(namesOwnMatters(p('managedByMe=true'), ['managedByMe'])).toBe(true);
    expect(namesOwnMatters(p('managedByMe=TRUE&x=1'), ['managedByMe'])).toBe(true);
    expect(namesOwnMatters(p('managedByMe=false'), ['managedByMe'])).toBe(false);
    expect(namesOwnMatters(p('overdue=true'), ['managedByMe'])).toBe(false);
    expect(namesOwnMatters(p('managedByMe=true'), [])).toBe(false);
  });
});

describe('PageScope: a link that says "on the matters I manage" (#813)', () => {
  afterEach(() => localStorage.clear());

  it('is the mine scope, the address gets scope=mine and loses the page filter', async () => {
    const { scope, navigate } = await pageScope(
      { overdue: 'true', managedByMe: 'true' },
      { own: ['managedByMe'], all: true },
    );
    expect(scope.value()).toBe('mine');
    expect(scope.mine()).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    const call = (navigate.mock.calls[0] as unknown[])[1] as {
      queryParams: Record<string, unknown>;
      replaceUrl: boolean;
    };
    expect(call.queryParams).toEqual({ scope: 'mine', managedByMe: null });
    expect(call.replaceUrl).toBe(true);
  });

  it('a link with other filters and no scope still means all', async () => {
    const { scope, navigate } = await pageScope(
      { overdue: 'true' },
      { own: ['managedByMe'], all: true },
    );
    expect(scope.value()).toBe('all');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('the scope in the address wins over the filter, and choosing a scope clears the filter', async () => {
    const { scope, navigate } = await pageScope(
      { managedByMe: 'true', scope: 'all' },
      { own: ['managedByMe'], all: true },
    );
    expect(scope.value()).toBe('all');
    navigate.mockClear();
    scope.set('mine');
    const call = (navigate.mock.calls[0] as unknown[])[1] as {
      queryParams: Record<string, unknown>;
    };
    expect(call.queryParams).toMatchObject({ scope: 'mine', managedByMe: null });
  });

  it('a page without own filters keeps its old behaviour', async () => {
    const { scope } = await pageScope({ managedByMe: 'true' }, { all: true });
    expect(scope.value()).toBe('all');
  });
});
