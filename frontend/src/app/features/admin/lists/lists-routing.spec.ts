import { TestBed } from '@angular/core/testing';
import { Router, UrlSegment, UrlTree, provideRouter } from '@angular/router';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { MOVED_PARAM, listsGuard, listsMatcher, listsTitle, movedListUrl } from './lists-routing';

describe('Lists routing (UI spec 6)', () => {
  const seg = (...paths: string[]): UrlSegment[] => paths.map((p) => new UrlSegment(p, {}));

  it('matches /lists and /lists/<key> only', () => {
    expect(listsMatcher(seg('lists'))).toEqual({ consumed: seg('lists') });
    const m = listsMatcher(seg('lists', 'priorities'))!;
    expect(m.posParams!['list'].path).toBe('priorities');
    expect(listsMatcher(seg('lists', 'priorities', 'x'))).toBeNull();
    expect(listsMatcher(seg('priorities'))).toBeNull();
    expect(listsMatcher([])).toBeNull();
  });

  it('titles the page "Lists: <List>" and plain "Lists" without a known list', () => {
    const title = (list?: string) =>
      listsTitle({ params: list ? { list } : {} } as unknown as Parameters<typeof listsTitle>[0]);
    expect(title('priorities')).toBe('Lists: Priorities');
    expect(title('on-hold-reasons')).toBe('Lists: On-Hold Reasons');
    expect(title()).toBe('Lists');
    expect(title('nope')).toBe('Lists');
  });

  describe('listsGuard', () => {
    async function run(list: string | undefined, ...permissions: Permission[]): Promise<string> {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        ],
      });
      const result = await TestBed.runInInjectionContext(() =>
        listsGuard({ params: list ? { list } : {} } as never, {} as never),
      );
      return result === true ? 'open' : TestBed.inject(Router).serializeUrl(result as UrlTree);
    }

    it('opens a list the person may manage', async () => {
      expect(await run('priorities', 'Priority.Manage')).toBe('open');
      expect(await run('note-tags', 'StatusLabel.Manage')).toBe('open');
      expect(await run('link-roles', 'AssetType.Manage')).toBe('open');
      expect(await run('team-titles', 'MatterList.Manage')).toBe('open');
    });

    it('sends /admin/lists, an unknown key and a forbidden list to the first permitted one', async () => {
      expect(await run(undefined, 'OnHoldReason.Manage', 'AssetType.Manage')).toBe(
        '/admin/lists/on-hold-reasons',
      );
      expect(await run('nope', 'StatusLabel.Manage')).toBe('/admin/lists/status-labels');
      expect(await run('priorities', 'MatterList.Manage')).toBe('/admin/lists/matter-types');
      expect(await run('link-roles', 'Priority.Manage', 'AssetType.Manage')).toBe('open');
    });

    it('shows the 403 page to a person who manages no list', async () => {
      expect(await run('priorities', 'Task.View')).toBe('/403');
      expect(await run(undefined, 'Audit.View')).toBe('/403');
    });
  });

  it('builds the new address of an old one: only `edit` is kept, with the one-time marker', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(movedListUrl(router, 'priorities', {}))).toBe(
      `/admin/lists/priorities?${MOVED_PARAM}=priorities`,
    );
    expect(
      router.serializeUrl(movedListUrl(router, 'priorities', { edit: '7', tab: 'x', q: 'y' })),
    ).toBe('/admin/lists/priorities?edit=7&moved=priorities');
    expect(router.serializeUrl(movedListUrl(router, 'link-roles', { edit: 'new' }))).toBe(
      '/admin/lists/link-roles?edit=new&moved=link-roles',
    );
  });
});
