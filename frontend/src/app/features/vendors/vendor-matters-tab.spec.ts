import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { VendorsClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { aVendorMatter } from '../../shared/testing/vendors-testing';
import { VendorMattersTab } from './vendor-matters-tab';

@Component({
  imports: [VendorMattersTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-vendor-matters-tab [vendorId]="7" (countChange)="counts.push($event)" />`,
})
class Host {
  readonly counts: number[] = [];
}

describe('VendorMattersTab', () => {
  async function start(
    result: ReturnType<typeof ok> | ReturnType<typeof apiError> = ok([
      aVendorMatter(),
      aVendorMatter({
        matterId: 302,
        matterRef: '00343-00013',
        matterName: 'Orion audit',
        clientName: undefined,
      }),
    ]),
    permissions: Permission[] = ['Vendor.View', 'Matter.View'],
  ) {
    const api = { listVendorMatters: vi.fn().mockReturnValue(result) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: VendorsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    await settle(f);
    return { f, api, el: f.nativeElement as HTMLElement };
  }

  it('lists the linked matters in the shared read-only grid: CM Number as a link, Matter, Client, Linked and Linked By', async () => {
    const { f, api, el } = await start();
    expect(api.listVendorMatters).toHaveBeenCalledWith(7);
    expect(el.querySelector('mf-record-grid')).not.toBeNull();
    expect(Array.from(el.querySelectorAll('thead th')).map((h) => h.textContent!.trim())).toEqual([
      'CM Number',
      'Matter',
      'Client',
      'Linked',
      'Linked By',
    ]);
    const first = el.querySelector('tbody tr')!;
    expect(first.querySelector('a.mf-ref')!.getAttribute('href')).toBe('/matters/301');
    expect(first.textContent).toContain('Acme v. Orion');
    expect(first.textContent).toContain('Acme Corp');
    expect(first.textContent).toContain('11/02');
    expect(first.textContent).toContain('Maria Alvarez');
    expect(f.componentInstance.counts).toEqual([2]);
    expect(el.querySelectorAll('[data-matter-ref]')).toHaveLength(2);
  });

  it('says so when the vendor is linked to no matter', async () => {
    const { el } = await start(ok([]));
    expect(el.querySelector('[data-matters-empty]')!.textContent).toContain(
      'Not linked to any matter.',
    );
  });

  it('without Matter.View it says why and does not ask the API', async () => {
    const { api, el } = await start(ok([]), ['Vendor.View']);
    expect(api.listVendorMatters).not.toHaveBeenCalled();
    expect(el.querySelector('[data-matters-forbidden]')!.textContent).toContain(
      "don't have access to Matters",
    );
  });

  it('a 403 from the API reads the same', async () => {
    const { el } = await start(apiError(403, { status: 403 }));
    expect(el.querySelector('[data-matters-forbidden]')).not.toBeNull();
  });

  it('says so, with Retry, when the matters cannot be loaded', async () => {
    const { el } = await start(apiError(500, { status: 500 }));
    expect(el.textContent).toContain("Couldn't load the matters.");
  });
});
