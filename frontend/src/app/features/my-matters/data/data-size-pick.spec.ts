import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AssetDataTypeRow } from '../../../api/generated/api-client';
import { SizeChoice } from '../data-selection';
import { DataSizePick, sizeGroups } from './data-size-pick';

const row = (id: number, name: string, fields: [string, boolean][]): AssetDataTypeRow =>
  ({
    assetTypeId: id,
    name,
    counts: {},
    query: '',
    measures: [],
    dispositionSizes: [],
    numberFields: fields.map(([key, isDefault]) => ({
      key,
      label: key === 'size_gb' ? 'Size (GB)' : 'Documents',
      isDefault,
      unit: isDefault ? 'GB' : undefined,
    })),
  }) as unknown as AssetDataTypeRow;

@Component({
  imports: [DataSizePick],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-data-size-pick
    [types]="types"
    [choices]="choices()"
    (changed)="choices.set($event)"
  />`,
})
class Host {
  types = [
    row(3, 'Workspace', [
      ['size_gb', true],
      ['docs', false],
    ]),
    row(4, 'Plain', [['pages', true]]),
  ];
  choices = signal<SizeChoice[]>([]);
}

describe('DataSizePick', () => {
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const box = (key: string) => el().querySelector<HTMLInputElement>(`[data-size-field="${key}"]`)!;

  async function change(input: HTMLInputElement | HTMLSelectElement, value?: string) {
    if (value !== undefined) (input as HTMLSelectElement).value = value;
    else input.click();
    if (value !== undefined) input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('offers only the asset types that have a field besides their default', () => {
    expect(sizeGroups(fixture.componentInstance.types).map((g) => g.name)).toEqual(['Workspace']);
    expect(el().querySelectorAll('[data-size-type]')).toHaveLength(1);
    expect(el().querySelector('summary')!.textContent).toContain('Default');
  });

  it('ticks the default field when nothing is chosen, and never lets the last tick go', async () => {
    expect(box('3:size_gb').checked).toBe(true);
    expect(box('3:docs').checked).toBe(false);
    await change(box('3:size_gb'));
    expect(fixture.componentInstance.choices()).toEqual([]);
    expect(box('3:size_gb').checked).toBe(true);
  });

  it('applies another field only once it has a unit, and goes back to the default when the extra field is dropped', async () => {
    await change(box('3:docs'));
    expect(fixture.componentInstance.choices()).toEqual([]); // waiting for the unit
    const unit = el().querySelector<HTMLSelectElement>('[data-size-unit="3:docs"]')!;
    expect(unit.value).toBe('');
    await change(unit, 'Items');
    // The default field stays ticked and the extra one is added to it.
    expect(fixture.componentInstance.choices()).toEqual([
      { typeId: 3, key: 'size_gb', unit: null },
      { typeId: 3, key: 'docs', unit: 'Items' },
    ]);
    expect(el().querySelector('summary')!.textContent).toContain('2 fields');
    // Dropping the default leaves the extra one alone.
    await change(box('3:size_gb'));
    expect(fixture.componentInstance.choices()).toEqual([
      { typeId: 3, key: 'docs', unit: 'Items' },
    ]);
    // Dropping the extra one as well goes back to the default: nothing is chosen any more.
    await change(box('3:size_gb'));
    await change(box('3:docs'));
    expect(fixture.componentInstance.choices()).toEqual([]);
  });
});
