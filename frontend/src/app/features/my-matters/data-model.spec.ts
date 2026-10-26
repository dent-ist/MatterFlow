import type { AssetVolumePoint } from '../../api/generated/api-client';
import { assetsParams, monthLabel, sizeText, volumeChartRows, volumeRows } from './data-model';

const unit = (u: string, value: number, assets = 1) => ({ unit: u, value, assets });

describe('assetsParams', () => {
  it('opens a matter in the Data tab scope, whatever the list remembers, and counts every disposition by default', () => {
    expect(assetsParams('matterId=4', 'mine')).toEqual({
      scope: 'mine',
      matterId: '4',
      status: 'all',
    });
    expect(assetsParams('matterId=4', 'all', 'pending')).toEqual({
      scope: 'all',
      matterId: '4',
      status: 'pending',
    });
  });

  it('maps the managed flag, the role, the type and a single disposition of the API query', () => {
    expect(assetsParams('matterManagedByMe=true&role=primary&assetTypeId=7', 'mine')).toEqual({
      scope: 'mine',
      role: 'primary',
      typeId: '7',
      status: 'all',
    });
    expect(assetsParams('matterManagedByMe=true&disposition=PENDING_DISPOSITION', 'mine')).toEqual({
      scope: 'mine',
      status: 'pending',
    });
    // The role belongs to My matters only; role both is the default and is not carried.
    expect(assetsParams('role=primary', 'all')).toEqual({ scope: 'all', status: 'all' });
    expect(assetsParams('matterManagedByMe=true&role=both', 'mine')).toEqual({
      scope: 'mine',
      status: 'all',
    });
  });

  it('opens the inactive-but-linked warning on every status', () => {
    expect(assetsParams('matterManagedByMe=true&inactiveLinked=true', 'mine', 'active')).toEqual({
      scope: 'mine',
      inactiveLinked: 'true',
      status: 'all',
    });
  });
});

describe('sizeText', () => {
  it('shows each unit, leaves out units no asset had a value for, and is empty without a size', () => {
    expect(sizeText([unit('GB', 640.25), unit('Items', 26400)])).toBe('640.25 GB + 26,400 Items');
    expect(sizeText([unit('GB', 0, 0)])).toBe('');
    expect(sizeText([])).toBe('');
  });
});

describe('volume rows', () => {
  const points: AssetVolumePoint[] = [
    {
      month: '2026-09',
      assets: 2,
      held: [unit('GB', 10), unit('Items', 100)],
      added: [unit('GB', 10), unit('Items', 100)],
      removed: [unit('GB', 0, 0), unit('Items', 0, 0)],
    },
    {
      month: '2026-10',
      assets: 2,
      held: [unit('GB', 7), unit('Items', 100)],
      added: [unit('GB', 0, 0), unit('Items', 0, 0)],
      removed: [unit('GB', 3), unit('Items', 0, 0)],
    },
  ];

  it('picks one unit of a mixed result and labels the months', () => {
    expect(volumeRows(points, 'GB').map((r) => [r.label, r.held, r.added, r.removed])).toEqual([
      ['Sep 2026', 10, 10, 0],
      ['Oct 2026', 7, 0, 3],
    ]);
    expect(volumeChartRows(volumeRows(points, 'Items')).map((r) => r.value)).toEqual([100, 100]);
  });

  it('keeps a month it cannot read as it is', () => {
    expect(monthLabel('2026-03')).toBe('Mar 2026');
    expect(monthLabel('soon')).toBe('soon');
  });
});
