import { TYPE_STYLES } from '../../../shared/charts/chart-palette';
import {
  MAX_SLICES,
  groupSlices as groupSized,
  sharePercent,
} from '../../../shared/charts/pie-geometry';

export { sharePercent };

/** One slice of a breakdown pie: what the legend row says and how the slice is drawn. */
export interface PieSlice {
  label: string;
  count: number;
  /** How many of `count` are overdue (drawn as a hatched outer ring segment); undefined: no split. */
  overdue?: number;
  /** Task Queue query of the slice (null: not linkable). */
  query: string | null;
  /** CSS colours of the slice and of its outline. */
  fill: string;
  outline: string | null;
  /** Dashed outline (the Low priority, as in the bars). */
  dashed?: boolean;
}

/** The colour of a status code, as in the bars; null: no own colour (the pie takes a palette colour instead). */
export function toneColor(tone: string | null | undefined): string | null {
  switch (tone) {
    case 'NEW':
      return 'var(--mf-st-new-fg)';
    case 'IN_PROGRESS':
      return 'var(--mf-st-progress-fg)';
    case 'ON_HOLD':
      // Grey, like the pill (M9): the chart needs a mid grey that stays apart from New's dark slate; labels name every row.
      return 'var(--mf-border-strong)';
    default:
      return null;
  }
}

/** Categorical palette for slices without a colour of their own (task types): the Trends line colours, 3:1 on white. */
export function paletteColor(index: number): string {
  return TYPE_STYLES[index % TYPE_STYLES.length].color;
}

/**
 * Keeps the list to `max` slices (the largest stay, the rest become one grey "Other" slice that cannot be opened); see the shared grouping.
 * A list that already ends in a grouped row ("Other task types") keeps that row as it is when it is the only one left over.
 */
export function groupSlices(slices: readonly PieSlice[], max = MAX_SLICES): PieSlice[] {
  return groupSized(
    slices,
    (total) => ({
      label: 'Other',
      count: total.count,
      overdue: total.overdue,
      query: null,
      fill: 'var(--mf-border-strong)',
      outline: 'var(--mf-text-muted)',
    }),
    max,
  );
}
