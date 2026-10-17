import { DashboardPreviousPeriod } from '../../api/generated/api-client';

/**
 * Change since before on the Summary tiles (UX review 2, S3). Only Overdue and Open (against the end of yesterday) and Completed and
 * Created (against the previous period of equal length) have one: the other tiles have no history to compare with. The line is a glyph, a
 * signed number and words, never colour alone; only Overdue going up is styled as attention. A missing baseline (the API answers null or
 * leaves the field out) gives no line at all: never "NaN" and never a made-up "+0".
 */
export type DeltaDirection = 'up' | 'down' | 'same';

export interface TileDelta {
  direction: DeltaDirection;
  /** Glyph shown before the text (decorative, the words carry the meaning). */
  glyph: string;
  /** The visible words, for example "+8 vs yesterday". */
  text: string;
  /** What a screen reader says, for example "8 more than yesterday". */
  spoken: string;
  /** Only Overdue going up: the existing attention style. Everything else is neutral. */
  attention: boolean;
}

export const GLYPHS: Record<DeltaDirection, string> = { up: '▲', down: '▼', same: '=' };

/** The comparison named in words: "yesterday", "previous 30 days", "same days last month". */
export interface DeltaBasis {
  /** After "vs": "yesterday", "previous 30 days", "same days last month". */
  short: string;
  /** After "than": "yesterday", "in the previous 30 days", "in the same days last month". */
  spoken: string;
  /** After "compared with": "yesterday", "the previous 30 days", "the same days last month". */
  against: string;
}

export const YESTERDAY: DeltaBasis = {
  short: 'yesterday',
  spoken: 'yesterday',
  against: 'yesterday',
};

/** The words for the period a tile was compared with (null when the API gave none). */
export function previousBasis(
  previous: DashboardPreviousPeriod | null | undefined,
  days: number,
): DeltaBasis | null {
  if (!previous) return null;
  if (previous.kind === 'same-days-last-month') {
    return {
      short: 'same days last month',
      spoken: 'in the same days last month',
      against: 'the same days last month',
    };
  }
  const span = days === 1 ? 'previous day' : `previous ${days} days`;
  return { short: span, spoken: `in the ${span}`, against: `the ${span}` };
}

/**
 * The delta of one tile, or null when there is none to show. `baseline` is the value at the end of yesterday or in the previous period.
 * `attentionWhenUp` is true for Overdue only.
 */
export function tileDelta(
  current: number,
  baseline: number | null | undefined,
  basis: DeltaBasis | null,
  attentionWhenUp = false,
): TileDelta | null {
  if (basis === null || baseline === null || baseline === undefined) return null;
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null;
  const change = current - baseline;
  if (change === 0) {
    return {
      direction: 'same',
      glyph: GLYPHS.same,
      text: `no change vs ${basis.short}`,
      spoken: `No change compared with ${basis.against}`,
      attention: false,
    };
  }
  const size = Math.abs(change);
  const up = change > 0;
  return {
    direction: up ? 'up' : 'down',
    glyph: up ? GLYPHS.up : GLYPHS.down,
    text: `${up ? '+' : '-'}${size} vs ${basis.short}`,
    spoken: `${size} ${up ? 'more' : 'fewer'} than ${basis.spoken}`,
    attention: up && attentionWhenUp,
  };
}

/** The tooltip of a yesterday delta: what yesterday was, and the Trends caveat (the same approximation). */
export function yesterdayHint(baseline: number | null | undefined): string | null {
  if (baseline === null || baseline === undefined) return null;
  return `At the end of yesterday: ${baseline}. Same as the Trends tab: uses today's due dates and does not replay status changes, so it can drift after edits.`;
}
