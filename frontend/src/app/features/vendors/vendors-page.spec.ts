import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, Observable } from 'rxjs';
import {
  VendorAreasClient,
  VendorServicesClient,
  VendorsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { NotificationService } from '../../core/notify/notification.service';
import { ddOptionTexts, ddSelect } from '../../testing/dropdown-testing.spec-util';
import {
  FakeMeApi,
  apiError,
  fakeQuery,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { aContact, aVendor, anOption, pageOfVendors } from '../../shared/testing/vendors-testing';
import { VendorsPage } from './vendors-page';

describe('VendorsPage', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let query: ReturnType<typeof fakeQuery>;

  const northbridge = aVendor();
  const orion = aVendor({
    vendorId: 8,
    name: 'Orion Review Group',
    website: undefined,
    category: 'BLACKLISTED',
    services: [],
    areas: [],
    techAi: [],
    contactCount: 3,
    doNotHireCount: 1,
    matterCount: 2,
  });

  async function create(
    permissions: Permission[] = ['Vendor.View', 'Vendor.Manage'],
    params: Record<string, string> = {},
    listResult: Observable<unknown> = ok(pageOfVendors(northbridge, orion)),
  ) {
    localStorage.clear();
    api = {
      listVendors: vi.fn().mockReturnValue(listResult),
      deleteVendor: vi.fn(),
      listVendorContacts: vi.fn().mockReturnValue(ok([aContact()])),
      listVendorMatters: vi.fn().mockReturnValue(ok([])),
      updateVendor: vi.fn(),
      createVendor: vi.fn(),
    };
    query = fakeQuery();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: VendorsClient, useValue: api },
        {
          provide: VendorServicesClient,
          useValue: {
            listVendorServices: () =>
              ok([
                anOption(),
                anOption({ id: 2, name: 'Review' }),
                anOption({ id: 3, name: 'Old', isActive: false }),
              ]),
          },
        },
        {
          provide: VendorAreasClient,
          useValue: { listVendorAreas: () => ok([anOption({ id: 10, name: 'Northeast' })]) },
        },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    query.set(params);
    const fixture = TestBed.createComponent(VendorsPage);
    await settle(fixture);
    return fixture;
  }

  const rows = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr'));

  it('shows "-" in the count chip while the list loads and the total once it is there', async () => {
    const loading = await create(['Vendor.View'], {}, NEVER);
    expect(
      (loading.nativeElement as HTMLElement)
        .querySelector('mf-page-header [data-list-count]')!
        .hasAttribute('data-count-pending'),
    ).toBe(true);
    TestBed.resetTestingModule();
    const ready = await create();
    expect(
      (ready.nativeElement as HTMLElement).querySelector('mf-page-header [data-list-count]')!
        .textContent,
    ).toContain('2');
  });

  it('is the Vendors page: header, then a record grid of Vendor, Category, Services, Areas, Contacts, Matters and Updated (Website is optional)', async () => {
    const f = await create();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('h1')!.textContent).toContain('Vendors');
    expect(el.querySelector('mf-page-header')!.textContent).toContain('name, website or service');
    const heads = Array.from(el.querySelectorAll('thead th')).map((h) => h.textContent!.trim());
    expect(heads).toEqual([
      'Vendor',
      'Category',
      'Services',
      'Areas',
      'Contacts',
      'Matters',
      'Updated',
      'Actions',
    ]);
    expect(api['listVendors']).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      50,
      undefined,
    );
    expect(el.querySelector('mf-record-grid')).not.toBeNull();
  });

  it('shows one line per vendor: name button, category chip, services, areas, counts and a Do Not Hire flag', async () => {
    const f = await create();
    const [first, second] = rows(f.nativeElement);
    expect(first.querySelector('[data-vendor-name]')!.className).toContain('mf-btn--name');
    expect(first.querySelector('[data-vendor-name]')!.textContent!.trim()).toBe(
      'Northbridge eDiscovery',
    );
    expect(first.querySelector('[data-vendor-category]')!.textContent).toContain('Preferred');
    expect(first.querySelector('[data-vendor-services]')!.textContent).toContain('Hosting, Review');
    expect(first.querySelector('[data-vendor-areas]')!.textContent).toContain('Northeast');
    expect(first.querySelector('[data-do-not-hire]')).toBeNull();
    expect(second.querySelector('[data-vendor-category]')!.textContent).toContain('Blacklisted');
    expect(second.querySelector('[data-vendor-services]')!.textContent).toContain('None');
    expect(second.querySelector('[data-vendor-contacts]')!.textContent).toContain('3');
    expect(second.querySelector('[data-do-not-hire]')!.getAttribute('aria-label')).toBe(
      '1 contact is marked Do Not Hire',
    );
    expect(second.querySelector('[data-vendor-matters]')!.textContent).toContain('2');
    // Every cell is one line: no cell holds a second line of text under the name (D-44a).
    expect(first.querySelector('[data-vendor-name]')!.parentElement!.children).toHaveLength(1);
  });

  it('searches, filters by category, service and area, and sorts through the API', async () => {
    const f = await create(undefined, {
      q: 'review',
      category: 'BLACKLISTED',
      serviceId: '2',
      areaId: '10',
    });
    expect(api['listVendors']).toHaveBeenCalledWith(
      'review',
      'BLACKLISTED',
      2,
      10,
      1,
      50,
      undefined,
    );
    f.componentRef.setInput('sort', '-updated');
    await settle(f);
    expect(api['listVendors']).toHaveBeenLastCalledWith(
      'review',
      'BLACKLISTED',
      2,
      10,
      1,
      50,
      '-updated',
    );
    const el: HTMLElement = f.nativeElement;
    expect(ddSelect(el, 'Filter by Category').value).toBe('BLACKLISTED');
    expect((el.querySelector('[data-list-search] input') as HTMLInputElement).value).toBe('review');
  });

  it('offers only the active services and areas in the filters', async () => {
    const f = await create();
    const el: HTMLElement = f.nativeElement;
    expect(ddOptionTexts(el, 'Filter by Service')).toEqual(['All Services', 'Hosting', 'Review']);
    expect(ddOptionTexts(el, 'Filter by Area')).toEqual(['All Areas', 'Northeast']);
  });

  describe('permissions', () => {
    it('Vendor.Manage: New Vendor in the header, a "..." menu per row with Edit Vendor and Delete Vendor', async () => {
      const f = await create();
      const el: HTMLElement = f.nativeElement;
      expect(el.querySelector('[data-new-vendor]')).not.toBeNull();
      expect(el.querySelectorAll('[data-row-actions]')).toHaveLength(2);
      el.querySelector<HTMLButtonElement>('[data-overflow]')!.click();
      await settle(f);
      const labels = Array.from(el.querySelectorAll('[role="menuitem"]')).map((m) =>
        m.textContent!.replace(/\s+/g, ' ').trim(),
      );
      expect(labels).toEqual(['Edit Vendor', 'Delete Vendor']);
    });

    it('a vendor linked to matters shows why Delete Vendor is not available', async () => {
      const f = await create();
      const el: HTMLElement = f.nativeElement;
      el.querySelectorAll<HTMLButtonElement>('[data-overflow]')[1].click();
      await settle(f);
      const del = Array.from(el.querySelectorAll('[role="menuitem"]')).find((m) =>
        m.textContent!.includes('Delete Vendor'),
      )!;
      expect(del.getAttribute('aria-disabled')).toBe('true');
      expect(del.textContent).toContain('Linked to 2 matters');
    });

    it('Vendor.View only: no New Vendor, no row menu, the name opens the read-only pop-up', async () => {
      const f = await create(['Vendor.View']);
      const el: HTMLElement = f.nativeElement;
      expect(el.querySelector('[data-new-vendor]')).toBeNull();
      expect(el.querySelector('[data-row-actions]')).toBeNull();
      el.querySelector<HTMLButtonElement>('[data-vendor-name]')!.click();
      await settle(f);
      const dialog = document.body.querySelector('.mf-formdlg')!;
      expect(dialog.querySelector('[data-panel-title]')!.textContent).toContain(
        'Northbridge eDiscovery',
      );
      expect(dialog.querySelector('[data-read-only]')!.textContent).toContain('Vendor.Manage');
      expect(dialog.querySelector('[data-panel-delete]')).toBeNull();
      expect(dialog.querySelector('[data-panel-primary]')).toBeNull();
    });

    it('offers New Vendor in the empty list only with Vendor.Manage', async () => {
      const manage = await create(undefined, {}, ok(pageOfVendors()));
      expect(
        (manage.nativeElement as HTMLElement).querySelector('[data-empty-new-vendor]'),
      ).not.toBeNull();
      TestBed.resetTestingModule();
      const view = await create(['Vendor.View'], {}, ok(pageOfVendors()));
      expect(
        (view.nativeElement as HTMLElement).querySelector('[data-empty-new-vendor]'),
      ).toBeNull();
    });
  });

  it('a click on the name opens the pop-up in view mode with the three tabs', async () => {
    const f = await create();
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-vendor-name]')!
      .click();
    await settle(f);
    const tabs = Array.from(document.body.querySelectorAll('[role="tab"]')).map((t) =>
      t.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(tabs).toEqual(['Overview', 'Contacts (1)', 'Matters (0)']);
    expect(document.body.querySelector('[data-vendor-form]')).toBeNull();
  });

  it('Edit Vendor in the row menu opens the pop-up straight in edit mode', async () => {
    const f = await create();
    const el: HTMLElement = f.nativeElement;
    el.querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    await settle(f);
    el.querySelector<HTMLElement>('[role="menuitem"]')!.click();
    await settle(f);
    expect(document.body.querySelector('[data-panel-title]')!.textContent).toContain('Edit Vendor');
    expect(document.body.querySelector('[data-vendor-form]')).not.toBeNull();
  });

  it('Delete Vendor in the row menu confirms in a small dialog, deletes and reloads', async () => {
    const f = await create();
    const el: HTMLElement = f.nativeElement;
    api['deleteVendor'].mockReturnValue(ok(undefined));
    const notify = vi.spyOn(TestBed.inject(NotificationService), 'success');
    el.querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    await settle(f);
    el.querySelectorAll<HTMLElement>('[role="menuitem"]')[1].click();
    await settle(f);
    expect(document.body.querySelector('[data-delete-text]')!.textContent).toContain(
      'Northbridge eDiscovery',
    );
    const confirm = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent!.trim() === 'Delete Vendor',
    )!;
    confirm.click();
    await settle(f);
    expect(api['deleteVendor']).toHaveBeenCalledWith(7);
    expect(notify).toHaveBeenCalledWith('Vendor deleted', expect.stringContaining('Northbridge'));
    expect(api['listVendors']).toHaveBeenCalledTimes(2);
  });

  it('says the count when the server refuses the delete because matters use the vendor', async () => {
    const f = await create();
    const el: HTMLElement = f.nativeElement;
    api['deleteVendor'].mockReturnValue(
      apiError(409, {
        status: 409,
        code: 'VENDOR_LINKED_TO_MATTERS',
        meta: { matterCount: 3 },
      }),
    );
    el.querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    await settle(f);
    el.querySelectorAll<HTMLElement>('[role="menuitem"]')[1].click();
    await settle(f);
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent!.trim() === 'Delete Vendor')!
      .click();
    await settle(f);
    expect(document.body.textContent).toContain('linked to 3 matters and cannot be deleted');
  });
});
