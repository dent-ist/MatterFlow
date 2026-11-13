import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  VendorAreasClient,
  VendorResponse,
  VendorServicesClient,
  VendorsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { NotificationService } from '../../core/notify/notification.service';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { aContact, aVendor, aVendorMatter, anOption } from '../../shared/testing/vendors-testing';
import { VendorDialog, websiteHref } from './vendor-dialog';

@Component({
  imports: [VendorDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-vendor-dialog
    [vendor]="vendor()"
    [startInEdit]="edit()"
    [(visible)]="open"
    (saved)="log.push('saved:' + $event.name)"
    (deleted)="log.push('deleted')"
  />`,
})
class Host {
  readonly vendor = signal<VendorResponse | null>(null);
  readonly edit = signal(false);
  readonly open = signal(true);
  readonly log: string[] = [];
}

describe('VendorDialog', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const all = (s: string) => Array.from(document.body.querySelectorAll<HTMLElement>(s));
  const btn = (label: string) =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent!.replace(/\s+/g, ' ').trim() === label,
    );
  const type = (id: string, value: string) => {
    const input = q(`#${id}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  async function start(
    vendor: VendorResponse | null = aVendor(),
    permissions: Permission[] = ['Vendor.View', 'Vendor.Manage', 'Matter.View'],
    edit = false,
  ) {
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    api = {
      createVendor: vi.fn().mockImplementation((b: object) => ok(aVendor({ ...b, vendorId: 99 }))),
      updateVendor: vi
        .fn()
        .mockImplementation((_id: number, b: { name: string }) =>
          ok(aVendor({ name: b.name, rowVersion: 'RV2' })),
        ),
      deleteVendor: vi.fn().mockReturnValue(ok(undefined)),
      listVendorContacts: vi.fn().mockReturnValue(ok([aContact()])),
      listVendorMatters: vi.fn().mockReturnValue(ok([aVendorMatter()])),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: VendorsClient, useValue: api },
        {
          provide: VendorServicesClient,
          useValue: {
            listVendorServices: () => ok([anOption(), anOption({ id: 2, name: 'Review' })]),
          },
        },
        {
          provide: VendorAreasClient,
          useValue: { listVendorAreas: () => ok([anOption({ id: 10, name: 'Northeast' })]) },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    f.componentInstance.vendor.set(vendor);
    f.componentInstance.edit.set(edit);
    await settle(f);
    return f;
  }

  describe('view mode', () => {
    it('is a large tabbed dialog: name and category in the header, tabs Overview, Contacts (n) and Matters (n)', async () => {
      await start();
      expect(q('[data-panel-title]')!.textContent).toContain('Northbridge eDiscovery');
      expect(q('[data-panel-title]')!.textContent).toContain('Preferred');
      expect(q('.mf-formdlg')!.classList).toContain('mf-formdlg--tabbed');
      expect(q('.mf-formdlg')!.getAttribute('style')).toContain('--mf-dialog-w-lg');
      const tabs = all('[role="tab"]').map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
      expect(tabs).toEqual(['Overview', 'Contacts (1)', 'Matters (0)']);
      expect(all('[role="tab"]')[0].getAttribute('aria-selected')).toBe('true');
    });

    it('Overview: category chip, website link, services, areas, Tech AI, note and last updated', async () => {
      await start();
      const facts = q('[data-vendor-facts]')!.textContent!;
      expect(facts).toContain('Preferred');
      expect(facts).toContain('Hosting');
      expect(facts).toContain('Review');
      expect(facts).toContain('Northeast');
      expect(facts).toContain('Relativity aiR');
      expect(facts).toContain('Fast turnaround on large reviews.');
      const link = q('[data-fact-website] a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('https://northbridge.example');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(q('[data-blacklisted-banner]')).toBeNull();
    });

    it('a Blacklisted vendor carries the warning banner on Overview', async () => {
      await start(aVendor({ category: 'BLACKLISTED' }));
      expect(q('[data-blacklisted-banner]')!.textContent).toContain('Blacklisted.');
      expect(q('[data-panel-title]')!.textContent).toContain('Blacklisted');
    });

    it('a Neutral vendor shows a plain grey chip and no warning banner', async () => {
      await start(aVendor({ category: 'NEUTRAL' }));
      expect(q('[data-vendor-facts] [data-vendor-category]')!.textContent).toContain('Neutral');
      expect(q('[data-vendor-facts] mf-badge .badge')!.getAttribute('data-tone')).toBe('neutral');
      expect(q('[data-blacklisted-banner]')).toBeNull();
      expect(q('[data-panel-title]')!.textContent).toContain('Neutral');
    });

    it('the footer has Delete Vendor at the left, Close and Edit Vendor at the right', async () => {
      await start();
      expect(q('[data-panel-delete]')!.textContent).toContain('Delete Vendor');
      expect(q('[data-panel-cancel]')!.textContent).toContain('Close');
      expect(q('[data-panel-primary]')!.textContent).toContain('Edit Vendor');
    });

    it('Contacts and Matters open their own tabs and show their lists', async () => {
      const f = await start();
      all('[role="tab"]')[1].click();
      await settle(f);
      expect(api['listVendorContacts']).toHaveBeenCalledWith(7);
      expect(q('[data-contact-list]')!.textContent).toContain('Laura Whitfield');
      all('[role="tab"]')[2].click();
      await settle(f);
      expect(api['listVendorMatters']).toHaveBeenCalledWith(7);
      expect(q('[data-matter-ref]')!.textContent).toContain('00343-00012');
    });
  });

  describe('edit in place', () => {
    it('Edit Vendor turns Overview into the two-column form, disables the other tabs and offers Cancel and Save Changes', async () => {
      const f = await start();
      (q('[data-panel-primary] button, button[data-panel-primary]') as HTMLButtonElement).click();
      await settle(f);
      expect(q('[data-panel-title]')!.textContent).toContain('Edit Vendor');
      expect(q('[data-vendor-form]')).not.toBeNull();
      expect((q('#vendor-name') as HTMLInputElement).value).toBe('Northbridge eDiscovery');
      const tabs = all('[role="tab"]');
      expect(tabs[1].getAttribute('aria-disabled')).toBe('true');
      expect(tabs[2].getAttribute('aria-disabled')).toBe('true');
      expect(q('[data-panel-primary]')!.textContent).toContain('Save Changes');
      expect(q('[data-panel-cancel]')!.textContent).toContain('Cancel');
      expect(q('[data-panel-delete]')).toBeNull();
    });

    it('saves through PUT with the row version, shows the result in view mode and tells the page', async () => {
      const f = await start(aVendor(), undefined, true);
      const notify = vi.spyOn(TestBed.inject(NotificationService), 'success');
      type('vendor-name', 'Northbridge Legal Tech');
      await settle(f);
      (q('[data-panel-primary] button, button[data-panel-primary]') as HTMLButtonElement).click();
      await settle(f);
      expect(api['updateVendor']).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          name: 'Northbridge Legal Tech',
          category: 'PREFERRED',
          serviceIds: [1, 2],
          areaIds: [10],
          techAi: ['Relativity aiR'],
          rowVersion: 'RV1',
        }),
      );
      expect(notify).toHaveBeenCalledWith('Vendor updated', 'Northbridge Legal Tech.');
      expect(f.componentInstance.log).toEqual(['saved:Northbridge Legal Tech']);
      expect(q('[data-vendor-form]')).toBeNull();
      expect(q('[data-panel-title]')!.textContent).toContain('Northbridge Legal Tech');
    });

    it('asks for the name before it saves', async () => {
      const f = await start(aVendor(), undefined, true);
      type('vendor-name', '   ');
      await settle(f);
      (q('[data-panel-primary] button, button[data-panel-primary]') as HTMLButtonElement).click();
      await settle(f);
      expect(api['updateVendor']).not.toHaveBeenCalled();
      expect(q('#vendor-name-error')!.textContent).toContain('Enter the vendor name.');
    });

    it('Cancel with typed text asks "You have unsaved changes. Discard them?" in the footer, then returns to the view', async () => {
      const f = await start(aVendor(), undefined, true);
      type('vendor-name', 'Changed');
      await settle(f);
      (q('[data-panel-cancel] button, button[data-panel-cancel]') as HTMLButtonElement).click();
      await settle(f);
      expect(q('[data-discard-ask]')!.textContent).toContain(
        'You have unsaved changes. Discard them?',
      );
      (q('[data-guard-discard] button, button[data-guard-discard]') as HTMLButtonElement).click();
      await settle(f);
      expect(q('[data-vendor-form]')).toBeNull();
      expect(q('[data-panel-title]')!.textContent).toContain('Northbridge eDiscovery');
    });

    it('Cancel without a change goes straight back to the view', async () => {
      const f = await start(aVendor(), undefined, true);
      (q('[data-panel-cancel] button, button[data-panel-cancel]') as HTMLButtonElement).click();
      await settle(f);
      expect(q('[data-discard-ask]')).toBeNull();
      expect(q('[data-vendor-form]')).toBeNull();
    });

    it('maps a duplicate name from the server onto the Name field', async () => {
      const f = await start(aVendor(), undefined, true);
      api['updateVendor'].mockReturnValue(
        apiError(409, {
          status: 409,
          code: 'DUPLICATE_NAME',
          errors: {
            name: [{ code: 'DUPLICATE_NAME', message: "A vendor named 'X' already exists." }],
          },
        }),
      );
      type('vendor-name', 'X');
      await settle(f);
      (q('[data-panel-primary] button, button[data-panel-primary]') as HTMLButtonElement).click();
      await settle(f);
      expect(q('#vendor-name-error')!.textContent).toContain('already exists');
    });

    it('adds and removes Tech AI entries and refuses a duplicate', async () => {
      const f = await start(aVendor(), undefined, true);
      type('vendor-ai-new', 'Everlaw Assistant');
      await settle(f);
      q('[data-add-tech-ai]')!.click();
      await settle(f);
      expect(all('[data-tech-ai-list] li').map((l) => l.textContent!.trim())).toEqual([
        'Relativity aiR',
        'Everlaw Assistant',
      ]);
      type('vendor-ai-new', 'relativity air');
      await settle(f);
      q('[data-add-tech-ai]')!.click();
      await settle(f);
      expect(q('#vendor-ai-new-error')!.textContent).toContain('already in the list');
    });
  });

  describe('New Vendor', () => {
    it('is the same form in its own dialog, no tabs, Cancel and Create Vendor', async () => {
      await start(null);
      expect(q('[data-panel-title]')!.textContent).toContain('New Vendor');
      expect(all('[role="tab"]')).toHaveLength(0);
      expect(q('.mf-formdlg')!.classList).not.toContain('mf-formdlg--tabbed');
      expect(q('[data-panel-primary]')!.textContent).toContain('Create Vendor');
      expect(q('[data-category="NEUTRAL"]')!.getAttribute('aria-pressed')).toBe('true');
      expect(all('[data-vendor-category-switch] button').map((b) => b.textContent!.trim())).toEqual(
        ['Preferred', 'Neutral', 'Blacklisted'],
      );
    });

    it('creates through POST and closes', async () => {
      const f = await start(null);
      type('vendor-name', 'Fresh Vendor');
      type('vendor-website', 'fresh.example');
      q('[data-category="BLACKLISTED"]')!.click();
      await settle(f);
      (q('[data-panel-primary] button, button[data-panel-primary]') as HTMLButtonElement).click();
      await settle(f);
      expect(api['createVendor']).toHaveBeenCalledWith({
        name: 'Fresh Vendor',
        website: 'fresh.example',
        category: 'BLACKLISTED',
        note: undefined,
        serviceIds: [],
        areaIds: [],
        techAi: [],
      });
      expect(f.componentInstance.open()).toBe(false);
      expect(f.componentInstance.log).toEqual(['saved:Fresh Vendor']);
    });
  });

  describe('read only (Vendor.View)', () => {
    it('is the same dialog without Edit, Delete or any change button, and the footer says why', async () => {
      await start(aVendor(), ['Vendor.View', 'Matter.View']);
      expect(q('[data-panel-delete]')).toBeNull();
      expect(q('[data-panel-primary]')).toBeNull();
      expect(q('[data-read-only]')!.textContent).toContain('Vendor.Manage');
      expect(all('[role="tab"]')).toHaveLength(3);
    });

    it('never opens in edit mode, even when asked', async () => {
      await start(aVendor(), ['Vendor.View'], true);
      expect(q('[data-vendor-form]')).toBeNull();
    });
  });

  describe('delete', () => {
    it('asks in the footer, deletes, tells the page and closes', async () => {
      const f = await start();
      const notify = vi.spyOn(TestBed.inject(NotificationService), 'success');
      (q('[data-panel-delete] button, button[data-panel-delete]') as HTMLButtonElement).click();
      await settle(f);
      expect(q('[data-delete-ask]')!.textContent).toContain('Delete Northbridge eDiscovery?');
      expect(btn('Keep Vendor')).toBeDefined();
      btn('Delete Vendor')!.click();
      await settle(f);
      expect(api['deleteVendor']).toHaveBeenCalledWith(7);
      expect(notify).toHaveBeenCalled();
      expect(f.componentInstance.log).toEqual(['deleted']);
      expect(f.componentInstance.open()).toBe(false);
    });

    it('Keep Vendor returns to the normal footer', async () => {
      const f = await start();
      (q('[data-panel-delete] button, button[data-panel-delete]') as HTMLButtonElement).click();
      await settle(f);
      btn('Keep Vendor')!.click();
      await settle(f);
      expect(q('[data-delete-ask]')).toBeNull();
      expect(q('[data-panel-delete]')).not.toBeNull();
    });

    it('a vendor the list says is linked to matters shows the block with the count and only Close', async () => {
      const f = await start(aVendor({ matterCount: 2 }));
      (q('[data-panel-delete] button, button[data-panel-delete]') as HTMLButtonElement).click();
      await settle(f);
      const block = q('[data-delete-blocked]')!.textContent!;
      expect(block).toContain("can't be deleted");
      expect(block).toContain('linked to 2 matters');
      expect(btn('Delete Vendor')).toBeUndefined();
      expect(q('[data-delete-blocked]')!.parentElement!.textContent).toContain('Keep Vendor');
      expect(api['deleteVendor']).not.toHaveBeenCalled();
    });

    it('409 VENDOR_LINKED_TO_MATTERS from the server shows the same block with the count it sent', async () => {
      const f = await start();
      api['deleteVendor'].mockReturnValue(
        apiError(409, { status: 409, code: 'VENDOR_LINKED_TO_MATTERS', meta: { matterCount: 1 } }),
      );
      (q('[data-panel-delete] button, button[data-panel-delete]') as HTMLButtonElement).click();
      await settle(f);
      btn('Delete Vendor')!.click();
      await settle(f);
      expect(q('[data-delete-blocked]')!.textContent).toContain('linked to 1 matter and');
      expect(f.componentInstance.open()).toBe(true);
    });
  });
});

describe('websiteHref', () => {
  it('links only http and https; an address without a scheme gets https', () => {
    expect(websiteHref('https://a.example')).toBe('https://a.example');
    expect(websiteHref('http://a.example/x')).toBe('http://a.example/x');
    expect(websiteHref('a.example')).toBe('https://a.example');
    expect(websiteHref('javascript:alert(1)')).toBeNull();
    expect(websiteHref('mailto:x@y.example')).toBeNull();
    expect(websiteHref('  ')).toBeNull();
    expect(websiteHref(undefined)).toBeNull();
  });
});
