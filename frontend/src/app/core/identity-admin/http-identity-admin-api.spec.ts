import { TestBed } from '@angular/core/testing';
import { Observable, firstValueFrom, of } from 'rxjs';
import { PagedResultOfPodSummary, PodsClient } from '../../api/generated/api-client';
import { HttpIdentityAdminApi } from './http-identity-admin-api';

/** A pods endpoint that pages at 100 like the real one, over `count` active pods named P001, P002, ... */
class FakePods {
  calls: { page?: number; pageSize?: number; active?: boolean; sort?: string }[] = [];
  count = 0;

  listPods(
    _q?: string,
    _name?: string,
    active?: boolean,
    page = 1,
    pageSize = 25,
    sort?: string,
  ): Observable<PagedResultOfPodSummary> {
    this.calls.push({ page, pageSize, active, sort });
    const all = Array.from({ length: this.count }, (_, i) => ({
      podId: i + 1,
      name: `P${String(i + 1).padStart(3, '0')}`,
    }));
    const size = Math.min(pageSize, 100);
    return of({
      items: all.slice((page - 1) * size, page * size),
      total: all.length,
      page,
      pageSize: size,
    } as unknown as PagedResultOfPodSummary);
  }
}

describe('HttpIdentityAdminApi.listActivePods', () => {
  let pods: FakePods;
  let api: HttpIdentityAdminApi;

  beforeEach(() => {
    pods = new FakePods();
    TestBed.configureTestingModule({
      providers: [{ provide: PodsClient, useValue: pods }, HttpIdentityAdminApi],
    });
    api = TestBed.inject(HttpIdentityAdminApi);
  });

  it('reads every page, so a pod beyond the first hundred can still be offered', async () => {
    pods.count = 250;
    const list = await firstValueFrom(api.listActivePods());
    expect(list).toHaveLength(250);
    expect(list[0].name).toBe('P001');
    expect(list[249].name).toBe('P250');
    expect(pods.calls.map((c) => c.page)).toEqual([1, 2, 3]);
    expect(pods.calls.every((c) => c.active === true && c.sort === 'name')).toBe(true);
  });

  it('stops after one request when everything fits in the first page, and for no pods at all', async () => {
    pods.count = 100;
    expect(await firstValueFrom(api.listActivePods())).toHaveLength(100);
    expect(pods.calls).toHaveLength(1);
    pods.calls = [];
    pods.count = 0;
    expect(await firstValueFrom(api.listActivePods())).toEqual([]);
    expect(pods.calls).toHaveLength(1);
  });
});
