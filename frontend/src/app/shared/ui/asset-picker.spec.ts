import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MF_ASSET_PICKER, ReferencePickerHost } from 'form-engine';
import { AssetsClient } from '../../api/generated/api-client';
import { aLookupItem, anAsset } from '../testing/asset-testing';
import { ok, settle } from '../testing/org-testing';
import { AssetPicker, AssetPickerContext } from './asset-picker';

describe('AssetPicker', () => {
  let api: { lookupAssets: ReturnType<typeof vi.fn>; getAsset: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<AssetPicker>;
  const el = (): HTMLElement => fixture.nativeElement;

  function configure(extra: unknown[] = []): void {
    api = {
      lookupAssets: vi
        .fn()
        .mockReturnValue(
          ok([
            aLookupItem(),
            aLookupItem({ assetId: 10, displayName: 'Old room', isActive: false }),
          ]),
        ),
      getAsset: vi.fn().mockReturnValue(ok(anAsset())),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AssetsClient, useValue: api }, ...(extra as never[])],
    });
  }

  async function create(inputs: Record<string, unknown> = {}): Promise<void> {
    fixture = TestBed.createComponent(AssetPicker);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.componentRef.setInput('debounceMs', 0);
    await settle(fixture);
  }

  const box = (): HTMLInputElement => el().querySelector<HTMLInputElement>('input[role=combobox]')!;

  it('searches only the assets of the given matter and selects one', async () => {
    configure();
    await create({ matterId: 7, inputId: 'src' });
    const changes: (number | null)[] = [];
    fixture.componentInstance.value.subscribe((v) => changes.push(v));

    box().focus();
    box().dispatchEvent(new Event('focus'));
    await settle(fixture);
    expect(api.lookupAssets).toHaveBeenCalledWith(7, undefined, undefined, 20);

    box().value = 'contract';
    box().dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(api.lookupAssets).toHaveBeenLastCalledWith(7, 'contract', undefined, 20);
    const options = Array.from(el().querySelectorAll('[role=option]'));
    expect(options.map((o) => o.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Contract bundle Document Set',
      'Old room Document Setinactive',
    ]);

    options[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle(fixture);
    expect(changes).toEqual([9]);
    expect(el().querySelector('[data-chosen]')?.textContent).toContain('Contract bundle');
  });

  it('clears the selection with Change and reports null', async () => {
    configure();
    await create({ matterId: 7, value: 9 });
    const changes: (number | null)[] = [];
    fixture.componentInstance.value.subscribe((v) => changes.push(v));
    expect(api.getAsset).toHaveBeenCalledWith(9);
    expect(el().querySelector('[data-chosen]')?.textContent).toContain('Contract bundle');

    el().querySelector<HTMLButtonElement>('.ap__change')!.click();
    await settle(fixture);

    expect(changes).toEqual([null]);
    expect(box()).not.toBeNull();
  });

  it('is read-only (no input, just the name) and has no Change action when disabled', async () => {
    configure();
    await create({ matterId: 7, value: 9, readOnly: true });
    expect(el().querySelector('[data-readonly]')?.textContent).toContain('Contract bundle');
    expect(box()).toBeNull();

    TestBed.resetTestingModule();
    configure();
    await create({ matterId: 7, value: 9, disabled: true });
    expect(el().querySelector('.ap__change')).toBeNull();
  });

  it('links the read-only name to the asset and shows type and external reference (UAT2-01, UAT2-12)', async () => {
    configure();
    api.getAsset.mockReturnValue(ok(anAsset({ externalReference: 'REL-77' })));
    await create({ matterId: 7, value: 9, readOnly: true });
    const link = el().querySelector<HTMLAnchorElement>('[data-readonly] a')!;
    expect(link.textContent).toContain('Contract bundle');
    expect(link.getAttribute('href')).toBe('/assets/9');
    expect(el().querySelector('[data-readonly]')!.textContent).toContain('REL-77');
  });

  it('says so when no asset matches and shows the type and reference of each option', async () => {
    configure();
    await create({ matterId: 7 });
    api.lookupAssets.mockReturnValue(ok([aLookupItem({ externalReference: 'EXT-1' })]));
    box().dispatchEvent(new Event('focus'));
    await settle(fixture);
    expect(el().querySelector('[role=option]')!.textContent).toContain('EXT-1');
    expect(el().querySelector('[role=option]')!.textContent).toContain('Document Set');

    api.lookupAssets.mockReturnValue(ok([]));
    box().value = 'zzz';
    box().dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(el().querySelector('[role=status]')?.textContent).toContain('No assets match');
  });

  it('takes the matter from the host page context when no input is given', async () => {
    const context = new AssetPickerContext();
    configure([{ provide: AssetPickerContext, useValue: context }]);
    await create();
    expect(box().disabled).toBe(true);
    expect(box().placeholder).toBe('Choose a matter first');

    context.matterId.set(12);
    await settle(fixture);
    box().dispatchEvent(new Event('focus'));
    await settle(fixture);

    expect(box().disabled).toBe(false);
    expect(api.lookupAssets).toHaveBeenCalledWith(12, undefined, undefined, 20);
  });

  it('marks the input invalid and supports the keyboard', async () => {
    configure();
    await create({ matterId: 7, invalid: true });
    expect(box().getAttribute('aria-invalid')).toBe('true');

    box().dispatchEvent(new Event('focus'));
    await settle(fixture);
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle(fixture);

    expect(fixture.componentInstance.value()).toBe(9);
  });
});

@Component({
  imports: [ReferencePickerHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-container
    [mfPickerHost]="picker"
    [value]="value()"
    (valueChange)="value.set($event)"
  />`,
})
class Host {
  protected readonly picker = AssetPicker;
  readonly value = signal<number | null>(null);
}

describe('AssetPicker as the form engine picker', () => {
  it('is hosted through MF_ASSET_PICKER and reports the chosen asset id', async () => {
    const api = {
      lookupAssets: vi.fn().mockReturnValue(ok([aLookupItem()])),
      getAsset: vi.fn().mockReturnValue(ok(anAsset())),
    };
    const context = new AssetPickerContext();
    context.matterId.set(7);
    TestBed.configureTestingModule({
      providers: [
        { provide: AssetsClient, useValue: api },
        { provide: AssetPickerContext, useValue: context },
        { provide: MF_ASSET_PICKER, useValue: AssetPicker },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[role=combobox]',
    )!;
    input.dispatchEvent(new Event('focus'));
    await settle(fixture);
    (fixture.nativeElement as HTMLElement)
      .querySelector('[role=option]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle(fixture);

    expect(fixture.componentInstance.value()).toBe(9);
    expect(api.lookupAssets).toHaveBeenCalledWith(7, undefined, undefined, 20);
  });
});
