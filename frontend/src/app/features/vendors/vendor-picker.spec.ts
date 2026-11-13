import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VendorsClient } from '../../api/generated/api-client';
import { apiError, ok, settle } from '../../shared/testing/org-testing';
import { aVendorLookup } from '../../shared/testing/vendors-testing';
import { VENDOR_PICKER_MESSAGES, VendorPicker } from './vendor-picker';

@Component({
  imports: [VendorPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-vendor-picker
    inputId="pick"
    label="Vendor"
    [debounceMs]="0"
    [taken]="taken()"
    (picked)="log.push('picked ' + $event.name)"
    (draftChange)="draft.set($event)"
  />`,
})
class Host {
  readonly taken = signal<number[]>([]);
  readonly draft = signal('');
  readonly log: string[] = [];
}

describe('VendorPicker (epic #1373, #1379)', () => {
  let api: { lookupVendors: ReturnType<typeof vi.fn> };
  const north = aVendorLookup();
  const orion = aVendorLookup({
    vendorId: 8,
    name: 'Orion Review Group',
    category: 'BLACKLISTED',
    services: ['Review'],
    hasDoNotHireContact: true,
  });

  async function start(result: unknown = ok([north, orion])) {
    api = { lookupVendors: vi.fn().mockReturnValue(result) };
    TestBed.configureTestingModule({ providers: [{ provide: VendorsClient, useValue: api }] });
    const f = TestBed.createComponent(Host);
    await settle(f);
    return f;
  }
  const input = (f: { nativeElement: unknown }) =>
    (f.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#pick')!;
  async function type(f: Awaited<ReturnType<typeof start>>, value: string) {
    const box = input(f);
    box.focus();
    box.value = value;
    box.dispatchEvent(new Event('input'));
    await settle(f);
  }
  async function key(f: Awaited<ReturnType<typeof start>>, k: string) {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    input(f).dispatchEvent(ev);
    await settle(f);
    return ev;
  }
  const options = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role=option]'));

  it('is a named combobox that searches the vendors as the person types', async () => {
    const f = await start();
    const box = input(f);
    expect(box.getAttribute('role')).toBe('combobox');
    expect(box.getAttribute('aria-expanded')).toBe('false');
    await type(f, 'nor');
    expect(api.lookupVendors).toHaveBeenCalledWith('nor');
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(box.getAttribute('aria-controls')).toBe('pick-list');
  });

  it('draws single-line options in the body: the name, the services and the category chip (Blacklisted in red)', async () => {
    const f = await start();
    await type(f, 'a');
    const list = document.body.querySelector<HTMLElement>('[data-vendor-panel-list]')!;
    expect(list.parentElement).toBe(document.body);
    const [first, second] = options();
    expect(first.textContent).toContain('Northbridge eDiscovery');
    expect(first.textContent).toContain('Hosting, Review');
    expect(first.querySelector('[data-vendor-category]')!.textContent).toContain('Preferred');
    expect(second.querySelector('[data-vendor-category]')!.textContent).toContain('Blacklisted');
    for (const o of options()) expect(o.querySelectorAll('br, [data-second-line]')).toHaveLength(0);
  });

  it('picks with the standard keys only and the box empties itself; Escape closes the list', async () => {
    const f = await start();
    await type(f, 'a');
    await key(f, 'ArrowDown');
    expect(input(f).getAttribute('aria-activedescendant')).toBe('pick-opt-0');
    await key(f, 'ArrowDown');
    await key(f, 'ArrowUp');
    const escape = await key(f, 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(document.body.querySelector('[role=listbox]')).toBeNull();
    await key(f, 'ArrowDown');
    await key(f, 'ArrowDown');
    await key(f, 'Enter');
    expect(f.componentInstance.log).toEqual(['picked Northbridge eDiscovery']);
    expect(input(f).value).toBe('');
  });

  it('picks with a click', async () => {
    const f = await start();
    await type(f, 'a');
    options()[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await settle(f);
    expect(f.componentInstance.log).toEqual(['picked Orion Review Group']);
  });

  it('never accepts free text: typing without picking reports the draft and picks nothing', async () => {
    const f = await start();
    await type(f, 'Someone Else');
    input(f).dispatchEvent(new Event('blur'));
    await key(f, 'Enter');
    expect(f.componentInstance.log).toEqual([]);
    expect(f.componentInstance.draft()).toBe('Someone Else');
    expect(VENDOR_PICKER_MESSAGES.pick).toBe('Choose a vendor from the list.');
  });

  it('shows a vendor that is already on the list as disabled, with the word, and does not pick it', async () => {
    const f = await start();
    f.componentInstance.taken.set([7]);
    await settle(f);
    await type(f, 'a');
    const [first] = options();
    expect(first.getAttribute('aria-disabled')).toBe('true');
    expect(first.textContent).toContain('On the List');
    await key(f, 'ArrowDown');
    await key(f, 'Enter');
    expect(f.componentInstance.log).toEqual([]);
  });

  it('says so when nothing matches, pointing to the Vendors page (there is no Create option)', async () => {
    const f = await start(ok([]));
    await type(f, 'zzz');
    const note = document.body.querySelector('[data-vendor-note]')!;
    expect(note.textContent).toContain('No vendor matches "zzz"');
    expect(note.textContent).toContain('Vendors page');
    expect(options()).toHaveLength(0);
  });

  it('a failed search says so', async () => {
    const f = await start(apiError(500, { code: 'INTERNAL' }));
    await type(f, 'a');
    expect(document.body.querySelector('[data-vendor-note]')!.textContent).toContain(
      VENDOR_PICKER_MESSAGES.failed,
    );
  });
});
