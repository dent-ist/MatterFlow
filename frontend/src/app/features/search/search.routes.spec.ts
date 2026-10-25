import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SEARCH_ROUTES } from './search.routes';

describe('/search/advanced redirect (#477)', () => {
  async function open(url: string): Promise<string> {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'search', children: SEARCH_ROUTES }])],
    });
    // The results route is lazy and guarded; only the redirect itself is under test, so ask the router where the address resolves to.
    const router = TestBed.inject(Router);
    const tree = router.parseUrl(url);
    const route = SEARCH_ROUTES.find((r) => r.path === 'advanced')!;
    const redirect = route.redirectTo as (r: { queryParams: Record<string, string> }) => unknown;
    return TestBed.runInInjectionContext(() =>
      router.serializeUrl(redirect({ queryParams: tree.queryParams }) as never),
    );
  }

  it.each([
    ['client', '/search/advanced?type=client&q=acme&active=false'],
    ['matter', '/search/advanced?type=matter&q=merger&client=3&sensitive=true'],
    ['project', '/search/advanced?type=project&q=p&matter=4'],
    ['task', '/search/advanced?type=task&q=x&status=NEW&status=ON_HOLD&requestor=pat&page=2'],
    ['asset', '/search/advanced?type=asset&q=review&client=3&assetType=7'],
  ])('keeps every old key for %s and opens the Filters panel', async (type, url) => {
    const target = await open(url);
    const redirected = new URL(target, 'http://x');
    const source = new URL(url, 'http://x');
    expect(redirected.pathname).toBe('/search');
    for (const [k, v] of source.searchParams)
      expect(redirected.searchParams.getAll(k)).toContain(v);
    expect(redirected.searchParams.get('type')).toBe(type);
    expect(redirected.searchParams.get('filters')).toBe('open');
  });

  it('opens the All tab without a type and keeps page and page size', async () => {
    const target = new URL(await open('/search/advanced?q=x&page=3&pageSize=50'), 'http://x');
    expect(target.pathname).toBe('/search');
    expect(target.searchParams.has('type')).toBe(false);
    expect(target.searchParams.has('filters')).toBe(false);
    expect(target.searchParams.get('page')).toBe('3');
    expect(target.searchParams.get('pageSize')).toBe('50');
  });
});
