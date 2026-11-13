import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  MatterVendorResponse,
  MatterVendorsClient,
  VendorLookupItem,
  VendorsClient,
} from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import {
  FakeMeApi,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { aMatterVendor, aVendor, aVendorLookup } from '../../../shared/testing/vendors-testing';
import { MatterVendorsDialog, VENDORS_DIALOG_MESSAGES } from './matter-vendors-dialog';

@Component({
  imports: [MatterVendorsDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-matter-vendors-dialog
    matterRef="00343-00012"
    matterName="Acme v. Beta"
    [matterId]="7"
    [vendors]="vendors()"
    [(visible)]="open"
    (changed)="changes = changes + 1"
  />`,
})
class Host {
  readonly vendors = signal<MatterVendorResponse[]>([]);
  readonly open = signal(true);
  changes = 0;
}

/** The dialog's own state, which a spec drives without a typed search (the vendor combobox has its own specs). */
interface Inner {
  add(v: VendorLookupItem): void;
  remove(key: number): void;
  setAck(key: number, value: boolean): void;
  draftChanged(text: string): void;
  save(): Promise<void>;
  rows(): { key: number; vendorId: number; link: unknown; reason: string | null }[];
  canSave(): boolean;
  summary(): string;
  pickError(): string | null;
}

describe('MatterVendorsDialog (epic #1373, #1379)', () => {
  let matterVendors: Record<string, ReturnType<typeof vi.fn>>;
  let vendorsApi: Record<string, ReturnType<typeof vi.fn>>;
  let notify: { success: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const all = (s: string) => Array.from(document.body.querySelectorAll<HTMLElement>(s));

  async function start(vendors: MatterVendorResponse[]) {
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    matterVendors = {
      linkVendorToMatter: vi.fn().mockReturnValue(of(aMatterVendor())),
      unlinkVendorFromMatter: vi.fn().mockReturnValue(of(undefined)),
    };
    vendorsApi = {
      getVendor: vi.fn().mockReturnValue(ok(aVendor({ note: 'Missed two deadlines.' }))),
      lookupVendors: vi.fn().mockReturnValue(ok([])),
    };
    notify = { success: vi.fn(), warn: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions('Matter.View', 'Vendor.View', 'Vendor.Link'))),
        { provide: MatterVendorsClient, useValue: matterVendors },
        { provide: VendorsClient, useValue: vendorsApi },
        { provide: NotificationService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.vendors.set(vendors);
    await settle(fixture);
    await settle(fixture);
    const inner = fixture.debugElement.children[0].componentInstance as unknown as Inner;
    return { fixture, host: fixture.componentInstance, inner };
  }

  it('opens as a large Edit Vendors dialog with the linked vendors as rows and the empty combobox row under them', async () => {
    await start([
      aMatterVendor({ vendorId: 1, name: 'Ann Review' }),
      aMatterVendor({ vendorId: 2, name: 'Ben Hosting' }),
    ]);
    expect(q('[data-panel-title]')!.textContent).toContain('Edit Vendors');
    expect(all('[data-vendor-rows] [data-vendor-row]')).toHaveLength(2);
    expect(all('[data-row-name]').map((e) => e.textContent!.trim())).toEqual([
      'Ann Review',
      'Ben Hosting',
    ]);
    expect(q('#vendor-add')).not.toBeNull();
    expect(q('[data-vendors-summary]')!.textContent).toContain('No changes yet.');
    expect(q('[data-panel-primary]')!.getAttribute('aria-disabled')).toBe('true');
    expect(q('[data-vendors-intro]')!.textContent).toBe(VENDORS_DIALOG_MESSAGES.intro);
    expect(all('[data-remove-row]').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove Ann Review',
      'Remove Ben Hosting',
    ]);
  });

  it('a picked vendor joins the list and Save links it without the confirmation', async () => {
    const { fixture, host, inner } = await start([]);
    inner.add(aVendorLookup({ vendorId: 9, name: 'Fresh Vendor', category: 'NEUTRAL' }));
    await settle(fixture);
    expect(all('[data-vendor-row][data-added]')).toHaveLength(1);
    expect(q('[data-blacklisted-warning]')).toBeNull();
    expect(inner.summary()).toBe('1 added.');
    expect(inner.canSave()).toBe(true);
    await inner.save();
    expect(matterVendors['linkVendorToMatter']).toHaveBeenCalledWith(7, {
      vendorId: 9,
      confirmBlacklisted: false,
    });
    expect(host.changes).toBe(1);
    expect(host.open()).toBe(false);
    expect(notify.success).toHaveBeenCalledWith('Vendors saved', '1 added.');
  });

  it('a Blacklisted vendor shows its reason and needs the tick before Save; the link then carries confirmBlacklisted', async () => {
    const { fixture, inner } = await start([]);
    inner.add(aVendorLookup({ vendorId: 4, name: 'Bad Vendor', category: 'BLACKLISTED' }));
    await settle(fixture);
    await settle(fixture);
    expect(vendorsApi['getVendor']).toHaveBeenCalledWith(4);
    expect(q('[data-blacklisted-warning]')!.textContent).toContain('Blacklisted.');
    expect(q('[data-blacklisted-reason]')!.textContent).toBe('Missed two deadlines.');
    expect(q('[data-blacklisted-warning]')!.textContent).toContain(
      'I have read this and still want to link it',
    );
    expect(inner.canSave()).toBe(false);
    expect(inner.summary()).toBe(`1 added. ${VENDORS_DIALOG_MESSAGES.needTick}`);

    const tick = q('[data-blacklisted-tick]') as HTMLInputElement;
    tick.click();
    await settle(fixture);
    expect(inner.canSave()).toBe(true);
    await inner.save();
    expect(matterVendors['linkVendorToMatter']).toHaveBeenCalledWith(7, {
      vendorId: 4,
      confirmBlacklisted: true,
    });
  });

  it('a Blacklisted vendor that is already linked needs no tick', async () => {
    const { fixture, inner } = await start([
      aMatterVendor({ vendorId: 3, name: 'Old Bad', category: 'BLACKLISTED' }),
    ]);
    expect(q('[data-blacklisted-warning]')).toBeNull();
    inner.add(aVendorLookup({ vendorId: 9, name: 'Other', category: 'PREFERRED' }));
    await settle(fixture);
    expect(inner.canSave()).toBe(true);
  });

  it('says so when the vendor has no note', async () => {
    const { fixture, inner } = await start([]);
    vendorsApi['getVendor'].mockReturnValue(ok(aVendor({ note: undefined })));
    inner.add(aVendorLookup({ vendorId: 4, name: 'Bad Vendor', category: 'BLACKLISTED' }));
    await settle(fixture);
    await settle(fixture);
    expect(q('[data-blacklisted-reason]')!.textContent).toBe(VENDORS_DIALOG_MESSAGES.noReason);
  });

  it('removes a saved vendor on Save (unlink), and picking it again undoes the removal', async () => {
    const { fixture, inner } = await start([aMatterVendor({ vendorId: 1, name: 'Ann Review' })]);
    inner.remove(inner.rows()[0].key);
    await settle(fixture);
    expect(inner.summary()).toBe('1 removed.');
    inner.add(aVendorLookup({ vendorId: 1, name: 'Ann Review' }));
    await settle(fixture);
    expect(inner.summary()).toBe('No changes yet.');
    expect(inner.rows()[0].link).not.toBeNull();

    inner.remove(inner.rows()[0].key);
    await settle(fixture);
    await inner.save();
    expect(matterVendors['unlinkVendorFromMatter']).toHaveBeenCalledWith(7, 1);
    expect(matterVendors['linkVendorToMatter']).not.toHaveBeenCalled();
  });

  it('a vendor that is already on the list is not added twice', async () => {
    const { inner } = await start([aMatterVendor({ vendorId: 1 })]);
    inner.add(aVendorLookup({ vendorId: 1 }));
    expect(inner.rows()).toHaveLength(1);
  });

  it('text typed in the empty row and not picked refuses the save', async () => {
    const { fixture, inner } = await start([aMatterVendor({ vendorId: 1 })]);
    inner.remove(inner.rows()[0].key);
    inner.draftChanged('Somebody');
    await settle(fixture);
    await inner.save();
    expect(inner.pickError()).toBe('Choose a vendor from the list.');
    expect(matterVendors['unlinkVendorFromMatter']).not.toHaveBeenCalled();
  });

  it('a failed step closes the dialog, asks the panel to reload and warns that the save was partial', async () => {
    const { fixture, host, inner } = await start([aMatterVendor({ vendorId: 1 })]);
    matterVendors['linkVendorToMatter'].mockReturnValue(throwError(() => new Error('409')));
    inner.remove(inner.rows()[0].key);
    inner.add(aVendorLookup({ vendorId: 9, name: 'New One', category: 'PREFERRED' }));
    await settle(fixture);
    await inner.save();
    expect(matterVendors['unlinkVendorFromMatter']).toHaveBeenCalled();
    expect(host.changes).toBe(1);
    expect(host.open()).toBe(false);
    expect(notify.warn).toHaveBeenCalledWith('Vendors partly saved', expect.any(String));
    expect(notify.success).not.toHaveBeenCalled();
  });
});
