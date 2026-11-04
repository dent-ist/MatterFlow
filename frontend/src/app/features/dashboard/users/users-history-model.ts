import { UserHistoryType } from '../../../api/generated/api-client';

/** Fewer completed tasks than this and the server sends no median: the UI says "Not enough tasks yet". */
export const MIN_SAMPLE = 5;

/**
 * A duration in minutes as the UI says it: under an hour "45 min", otherwise hours with one decimal ("3.3 h"), over 100 hours whole hours. The
 * minutes are WORKING minutes by default (the server's `durationBasis`), so the screen says "working time" beside them.
 */
export function durationText(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return h >= 100 ? `${Math.round(h)} h` : `${(Math.round(h * 10) / 10).toString()} h`;
}

export interface Comparison {
  /** `1.3x firm median`, or empty without a comparison. */
  text: string;
  /** The short cell text (US-08): `1.3x longer`, `0.8x shorter`, `About the same`. */
  short: string;
  /** The coaching-neutral phrase: never "slow" or "fast". */
  word: string;
  icon: string;
  tone: 'longer' | 'shorter' | 'same' | 'none';
}

/**
 * How a person's median compares with the firm's for one task type. Wording is neutral (longer, shorter, about the same), shown with an icon and the
 * ratio, never colour alone and never a ranking: 1.25 and more is "Longer than the firm median", 0.8 and less "Shorter", otherwise "About the firm median".
 */
const fmt = (r: number): string => (Math.round(r * 10) / 10).toFixed(1);

export function comparisonOf(t: Pick<UserHistoryType, 'ratio'>): Comparison {
  const r = t.ratio;
  if (r === null || r === undefined)
    return { text: '', short: '', word: '', icon: '', tone: 'none' };
  const text = `${(Math.round(r * 10) / 10).toFixed(1)}x firm median`;
  if (r >= 1.25)
    return {
      text,
      short: `${fmt(r)}x longer`,
      word: 'Longer than the firm median',
      icon: 'pi-arrow-up-right',
      tone: 'longer',
    };
  if (r <= 0.8)
    return {
      text,
      short: `${fmt(r)}x shorter`,
      word: 'Shorter than the firm median',
      icon: 'pi-arrow-down-right',
      tone: 'shorter',
    };
  return {
    text,
    short: 'About the same',
    word: 'About the firm median',
    icon: 'pi-equals',
    tone: 'same',
  };
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `2026-11` becomes `Nov` (and `Nov 2026` for the long form). */
export function monthShort(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}
export function monthLong(month: string): string {
  return `${monthShort(month)} ${month.slice(0, 4)}`;
}

/** The on-time sentence, or "Not enough tasks yet" when the server sends no rate. */
export function onTimeText(o: {
  onTime: number;
  late: number;
  sampleSize: number;
  rate?: number | null;
}): string {
  if (o.rate === null || o.rate === undefined) return 'Not enough tasks yet';
  return `${o.onTime} of ${o.sampleSize} tasks on time (${Math.round(o.rate * 100)}%)`;
}
