import { pickListItemsMulti } from './matter-form';

describe('pickListItemsMulti: the choices of the Matter Types multi-select (epic #1368)', () => {
  const view = (id: number, name: string, sortOrder: number, isActive = true) => ({
    id,
    name,
    sortOrder,
    isActive,
    rowVersion: 'x',
    inUseCount: 0,
  });
  const list = [view(3, 'Arbitration', 3), view(1, 'Litigation', 1), view(2, 'Old', 2, false)];

  it('offers the active items in the administrator order and no Not Set row', () => {
    expect(pickListItemsMulti(list, [], [])).toEqual([
      { value: '1', label: 'Litigation' },
      { value: '3', label: 'Arbitration' },
    ]);
  });

  it('keeps a deactivated type the matter has, marked inactive, only while it stays chosen', () => {
    const current = [{ id: 2, name: 'Old', isActive: false }];
    expect(pickListItemsMulti(list, current, ['2'])[0]).toEqual({
      value: '2',
      label: 'Old (inactive)',
    });
    expect(pickListItemsMulti(list, current, []).map((i) => i.value)).toEqual(['1', '3']);
  });

  it('keeps a chosen type that the list could not be loaded for', () => {
    const current = [{ id: 7, name: 'Kept', isActive: true }];
    expect(pickListItemsMulti([], current, ['7'])).toEqual([{ value: '7', label: 'Kept' }]);
  });
});
