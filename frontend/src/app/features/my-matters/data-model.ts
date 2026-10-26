import { Params } from '@angular/router';
import type { AssetUnitValue, AssetVolumePoint } from '../../api/generated/api-client';
import { formatSize } from '../assets/disposition/asset-size';
import type { ChartRow } from '../../shared/charts/chart-types';

/** The units a size field can be measured in (the same six as the asset type's size card). */
export const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'Items'] as const;

/** The disposition choices of the Assets list (`?status=`) that a Data tab count opens. */
export type DataStatus = 'active' | 'inactive' | 'pending' | 'disposed' | 'all';

const STATUS_OF_CODE: Record<string, DataStatus> = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING_DISPOSITION: 'pending',
  DISPOSED: 'disposed',
};

/**
 * The address of the Assets list for a count or a warning of the Data tab. The API hands out the list query that lists exactly the assets counted
 * (`matterId=4`, `assetTypeId=2`, `disposition=PENDING_DISPOSITION`, `inactiveLinked=true`, with `matterManagedByMe=true` and `role=` for My matters);
 * the list page speaks `scope`, `typeId` and `status`, so this maps one to the other. The scope is always the Data tab's own, so a matter row of a
 * matter the person does not manage still opens (the list's remembered scope never decides). `status` names the disposition a cell counts; `all` when
 * the count is of every asset. The list shows Active only by default, so a link never leaves the status out.
 */
export function assetsParams(
  query: string,
  scope: 'mine' | 'all',
  status: DataStatus | null = null,
): Params {
  const q = new URLSearchParams(query);
  const params: Params = { scope };
  if (scope === 'mine' && q.get('role') && q.get('role') !== 'both') params['role'] = q.get('role');
  const matterId = q.get('matterId');
  if (matterId) params['matterId'] = matterId;
  const typeId = q.get('assetTypeId');
  if (typeId) params['typeId'] = typeId;
  const codes = q.getAll('disposition');
  const fromQuery = codes.length === 1 ? STATUS_OF_CODE[codes[0]] : undefined;
  if (q.get('inactiveLinked') === 'true') {
    params['inactiveLinked'] = 'true';
    params['status'] = 'all';
  } else {
    params['status'] = status ?? fromQuery ?? 'all';
  }
  return params;
}

/** "640.2 GB", "26,400 Items", "640.2 GB + 26,400 Items"; an empty string when no asset has a size. */
export function sizeText(size: readonly AssetUnitValue[]): string {
  return size
    .filter((s) => s.assets > 0)
    .map((s) => formatSize(s.value, s.unit))
    .join(' + ');
}

const MONTH = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "2026-03" becomes "Mar 2026". */
export function monthLabel(month: string): string {
  const at = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? month : MONTH.format(at);
}

/** One month of the volume table. */
export interface VolumeRow {
  month: string;
  label: string;
  assets: number;
  held: number;
  added: number;
  removed: number;
}

function valueOf(list: readonly AssetUnitValue[], unit: string): number {
  return list.find((u) => u.unit === unit)?.value ?? 0;
}

/** The months of one unit as table rows. */
export function volumeRows(points: readonly AssetVolumePoint[], unit: string): VolumeRow[] {
  return points.map((p) => ({
    month: p.month,
    label: monthLabel(p.month),
    assets: p.assets,
    held: valueOf(p.held, unit),
    added: valueOf(p.added, unit),
    removed: valueOf(p.removed, unit),
  }));
}

/** The rows of the column chart: the size held at the end of each month. */
export function volumeChartRows(rows: readonly VolumeRow[]): ChartRow[] {
  return rows.map((r) => ({ label: r.label, value: Math.max(0, r.held) }));
}
