import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MatterVendorResponse,
  MatterVendorsClient,
  VendorsClient,
} from '../../../api/generated/api-client';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { aMatterVendor, aVendor } from '../../../shared/testing/vendors-testing';
import { MatterVendorsPanel, VENDOR_LINK_REASON } from './matter-vendors-panel';

@Component({
  imports: [MatterVendorsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-matter-vendors-panel
    [matterId]="7"
    matterRef="00343-00012"
    matterName="Acme v. Beta"
    [canLink]="canLink()"
  />`,
})
class Host {
  readonly canLink = signal(true);
}

const vendor = (id: number, over: Partial<MatterVendorResponse> = {}) =>
  aMatterVendor({ vendorId: id, name: `Vendor ${id}`, ...over });

describe('MatterVendorsPanel (epic #1373, #1379)', () => {
  let matterVendors: Record<string, ReturnType<typeof vi.fn>>;
  let vendorsApi: Record<string, ReturnType<typeof vi.fn>>;
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const all = (s: string) => Array.from(document.body.querySelectorAll<HTMLElement>(s));

  async function start(rows: MatterVendorResponse[] | 'error', canLink = true) {
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    matterVendors = {
      listMatterVendors: vi
        .fn()
        .mockReturnValue(rows === 'error' ? apiError(500, { code: 'INTERNAL' }) : ok(rows)),
    };
    vendorsApi = {
      getVendor: vi.fn().mockReturnValue(ok(aVendor())),
      lookupVendors: vi.fn().mockReturnValue(ok([])),
    };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions('Matter.View', 'Vendor.View', 'Vendor.Link'))),
        { provide: MatterVendorsClient, useValue: matterVendors },
        { provide: VendorsClient, useValue: vendorsApi },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.canLink.set(canLink);
    await settle(fixture);
    await settle(fixture);
    return fixture;
  }

  it('reads the matter vendors and shows one compact row per vendor: the name button and the category chip', async () => {
    await start([vendor(1, { category: 'NEUTRAL' })]);
    expect(matterVendors['listMatterVendors']).toHaveBeenCalledWith(7);
    expect(q('[data-panel-title]')!.textContent).toBe('Vendors');
    expect(q('[data-panel-count]')!.textContent!.trim()).toBe('1');
    const rows = all('[data-vendor-row]');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('[data-vendor-name]')!.textContent!.trim()).toBe('Vendor 1');
    expect(rows[0].querySelector('[data-vendor-category]')!.textContent).toContain('Neutral');
    expect(q('[data-blacklisted-chip]')).toBeNull();
    expect(q('[data-vendor-edit]')!.getAttribute('aria-label')).toBe('Edit Vendors');
  });

  it('shows three rows and "Show All N"; Show All opens a read-only dialog with every vendor and the Blacklisted banner', async () => {
    const fixture = await start([
      vendor(1, { category: 'BLACKLISTED' }),
      vendor(2),
      vendor(3),
      vendor(4),
      vendor(5),
    ]);
    expect(all('[data-vendor-row]')).toHaveLength(3);
    expect(q('[data-blacklisted-chip]')!.textContent).toContain('1 Blacklisted');
    const showAll = q('[data-vendors-show-all]')!;
    expect(showAll.textContent!.trim()).toBe('Show All 5');
    showAll.click();
    await settle(fixture);
    expect(q('.mf-formdlg [data-panel-title]')!.textContent).toContain('Vendors (5)');
    expect(all('[data-vendor-all-row]')).toHaveLength(5);
    expect(q('[data-vendors-all-banner]')!.textContent).toContain('1 Blacklisted');
    expect(q('[data-panel-primary]')).toBeNull();
  });

  it('folding keeps the count and the red Blacklisted chip', async () => {
    const fixture = await start([vendor(1, { category: 'BLACKLISTED' }), vendor(2)]);
    (q('[data-panel-toggle]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(all('[data-vendor-row]')).toHaveLength(0);
    expect(q('[data-panel-count]')!.textContent!.trim()).toBe('2');
    expect(q('[data-blacklisted-chip]')).not.toBeNull();
  });

  it('flags a vendor that has a Do Not Hire contact', async () => {
    await start([vendor(1, { hasDoNotHireContact: true }), vendor(2)]);
    expect(all('[data-do-not-hire]')).toHaveLength(1);
  });

  it('no vendors is ONE line, "Vendors 0, No vendors linked, + Engage Vendor"', async () => {
    const fixture = await start([]);
    expect(q('[data-panel-empty]')!.textContent).toBe('No vendors linked');
    expect(q('[data-panel-toggle]')).toBeNull();
    expect(q('[data-vendor-engage]')!.textContent).toContain('Engage Vendor');
    expect(q('[data-vendor-engage]')!.textContent).not.toContain('Add Vendor');
    q('[data-vendor-engage]')!.click();
    await settle(fixture);
    expect(q('.mf-formdlg [data-panel-title]')!.textContent).toContain('Edit Vendors');
  });

  it('without Vendor.Link the empty line says "Needs Vendor.Link" instead of the button', async () => {
    await start([], false);
    expect(q('[data-vendor-engage]')).toBeNull();
    expect(q('[data-vendor-reason]')!.textContent).toContain(VENDOR_LINK_REASON);
  });

  it('without Vendor.Link Edit is disabled, the reason is in the panel footer and a click opens nothing', async () => {
    const fixture = await start([vendor(1)], false);
    const edit = q('[data-vendor-edit]') as HTMLButtonElement;
    expect(edit.getAttribute('aria-disabled')).toBe('true');
    expect(edit.getAttribute('aria-describedby')).toBe(q('[data-vendor-reason]')!.id);
    expect(q('[data-vendor-reason]')!.textContent).toContain('Needs Vendor.Link');
    edit.click();
    await settle(fixture);
    expect(q('.mf-formdlg')).toBeNull();
  });

  it('Edit opens the Edit Vendors dialog with Vendor.Link', async () => {
    const fixture = await start([vendor(1)]);
    (q('[data-vendor-edit]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(q('.mf-formdlg [data-panel-title]')!.textContent).toContain('Edit Vendors');
    expect(all('[data-vendor-rows] [data-vendor-row]')).toHaveLength(1);
  });

  it('a vendor name opens the Vendor pop-up with the full record', async () => {
    const fixture = await start([vendor(7)]);
    (q('[data-vendor-name]') as HTMLButtonElement).click();
    await settle(fixture);
    await settle(fixture);
    expect(vendorsApi['getVendor']).toHaveBeenCalledWith(7);
    expect(q('.mf-formdlg [data-panel-title]')!.textContent).toContain('Northbridge eDiscovery');
  });

  it('a failed read is one error block with Retry that asks again', async () => {
    const fixture = await start('error');
    expect(q('[data-vendors-error]')!.textContent).toContain("Couldn't load the vendors.");
    matterVendors['listMatterVendors'].mockReturnValue(ok([vendor(1)]));
    (q('[data-vendors-error] button') as HTMLButtonElement).click();
    await settle(fixture);
    expect(all('[data-vendor-row]')).toHaveLength(1);
    expect(q('[data-vendors-error]')).toBeNull();
  });
});
