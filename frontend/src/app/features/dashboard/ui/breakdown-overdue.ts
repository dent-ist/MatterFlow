import { queueParams } from '../dashboard-links';

/**
 * The overdue part of a breakdown row (Breakdowns B1): its Task Queue query is the row's own query plus `overdue=true` (the queue's
 * Overdue filter, the same predicate as the Overdue tile), so the count and the list always agree.
 */
export function overdueParams(query: string | null | undefined) {
  return query ? queueParams(`${query}&overdue=true`) : null;
}

/** "11 overdue" (empty when nothing is overdue); the one wording of the segment, the row text and the table cell. */
export function overdueText(overdue: number): string {
  return overdue > 0 ? `${overdue} overdue` : '';
}

/** Width of the overdue segment as a share of its bar: proportional, in 0..100. A non-zero share keeps at least 2 px (CSS `min-width`). */
export function overdueShare(overdue: number, count: number): number {
  return count > 0 && overdue > 0 ? Math.min(100, (overdue / count) * 100) : 0;
}

/**
 * The stroke rules of the bars. Normal keeps a solid 1 px outline; Low gets a dashed 2 px outline and a lighter fill, so the two neutral
 * priorities differ without a new colour token (shape, not hue; it survives greyscale and forced colours).
 */
export interface BarStroke {
  style: 'solid' | 'dashed';
  width: number;
  /** Share of the priority's own fill that is kept (the rest is the card surface). */
  fillWeight: number;
}

export const NORMAL_STROKE: BarStroke = { style: 'solid', width: 1, fillWeight: 100 };
export const LOW_STROKE: BarStroke = { style: 'dashed', width: 2, fillWeight: 45 };

export function strokeFor(tone: string | null | undefined): BarStroke {
  return tone === 'low' ? LOW_STROKE : NORMAL_STROKE;
}

/** The fill of a bar for a stroke rule: the colour itself, or a mix with the card surface for the lighter Low fill. */
export function strokeFill(fill: string, stroke: BarStroke): string {
  return stroke.fillWeight >= 100
    ? fill
    : `color-mix(in srgb, ${fill} ${stroke.fillWeight}%, var(--mf-surface))`;
}

/**
 * Shared styles of the overdue segment and its legend sample: the existing overdue (danger) tokens, a diagonal hatch and a solid edge,
 * so colour is never the only cue (greyscale, forced colours). The pattern is the same in the bars, the age bar and the legend.
 */
export const OVERDUE_CSS = `
  .od {
    box-sizing: border-box;
    background: repeating-linear-gradient(
      135deg,
      var(--mf-danger) 0 3px,
      var(--mf-danger-bg) 3px 6px
    );
    border-left: 1px solid var(--mf-danger);
    min-width: 2px;
    forced-color-adjust: none;
  }
  a.od:hover,
  a.od:focus-visible {
    outline: 2px solid var(--mf-text);
    outline-offset: 1px;
  }
  .od-text {
    color: var(--mf-danger);
    font-size: var(--mf-fs-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-decoration: underline;
  }
  @media (forced-colors: active) {
    .od {
      background: repeating-linear-gradient(135deg, CanvasText 0 3px, Canvas 3px 6px);
      border-left-color: CanvasText;
    }
    .od-text {
      color: LinkText;
    }
  }
`;
