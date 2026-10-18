import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, throwError } from 'rxjs';
import { AssetsClient } from '../../api/generated/api-client';
import { anAsset } from '../../shared/testing/asset-testing';
import { FakeMeApi, ok, provideFakeMe, withPermissions } from '../../shared/testing/org-testing';
import { AuthStore } from '../auth/auth.store';
import { ApiError } from '../http/api-error';
import { QuietRequests } from '../http/interceptors';
import { ReferenceNames } from './reference-names';

describe('ReferenceNames.asset (BUG-1, #289)', () => {
  async function setup(permissions: string[], getAsset: () => Observable<unknown>) {
    const api = { getAsset: vi.fn(getAsset) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AssetsClient, useValue: api },
        provideFakeMe(new FakeMeApi(withPermissions(...(permissions as never[])))),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    return { api, names: TestBed.inject(ReferenceNames) };
  }

  it('does not call the Asset API without Asset.View: the answer is "not available"', async () => {
    const { api, names } = await setup(['Task.View'], () => ok(anAsset()));
    expect(await names.asset(9)).toBeNull();
    expect(await names.asset(10)).toBeNull();
    expect(api.getAsset).not.toHaveBeenCalled();
  });

  it('resolves the name with Asset.View', async () => {
    const { api, names } = await setup(['Asset.View'], () => ok(anAsset()));
    expect((await names.asset(9))?.displayName).toBe('Contract bundle');
    expect(api.getAsset).toHaveBeenCalledTimes(1);
  });

  it('marks the lookup quiet (no toast) and answers null when it still fails', async () => {
    let quietAtRequest: boolean | null = null;
    const quiet = () => TestBed.inject(QuietRequests).active;
    const { names } = await setup(['Asset.View'], () => {
      quietAtRequest = quiet();
      return throwError(() => ApiError.from(new HttpErrorResponse({ status: 403, error: {} })));
    });
    expect(await names.asset(9)).toBeNull();
    expect(quietAtRequest).toBe(true);
    expect(quiet()).toBe(false);
  });
});
