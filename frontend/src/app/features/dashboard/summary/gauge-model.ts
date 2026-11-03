import { ageText } from '../../../shared/work-queue/due-suffix';
import { UnassignedGauge } from '../dash-v4-contract';

/** The level words and the one "what to do" line per level, from the approved mockup. Index 0 is level 0 ("Normal"). */
export const LEVEL_WORDS = ['Normal', 'Warning', 'Elevated', 'High', 'Severe', 'Critical'] as const;
export const GAUGE_DO: readonly string[] = [
  'New work is arriving. Assign it within the hour.',
  'Waiting over an hour. Assign it soon.',
  'Two hours without an owner. Assign it now.',
  'Three hours. Assign it now, or ask a pod lead to take it.',
  'Four hours. Escalate: clear the oldest first and ask the team for help.',
  'Five hours or more. Escalate to the Director and clear the oldest first.',
];
export const GAUGE_CLEAR = 'Nothing is waiting for an owner.';
export const GAUGE_MAX_LEVEL = 5;

export function clampLevel(level: number): number {
  return Math.max(0, Math.min(GAUGE_MAX_LEVEL, Math.round(level)));
}

export interface GaugeView {
  /** Nothing is unassigned. */
  clear: boolean;
  /** 0 to 5; meaningless while `clear`. */
  level: number;
  word: string;
  /** The badge: `All clear`, `Normal`, `Level 3 · High`. */
  badge: string;
  count: number;
  /** `2 h 48 m`, or `-` while clear. */
  age: string;
  /** `working hours` or `clock hours`. */
  basis: string;
  /** `oldest, working hours`. */
  ageLabel: string;
  doLine: string;
  /** Needle angle in degrees from the left end of the half circle (0 to 180); clear parks it at the start. */
  needleDeg: number;
  /** The spoken name of the gauge. */
  ariaLabel: string;
  /** The polite message when the level changes. */
  announcement: string;
  /** Levels 4 and 5 pulse softly (unless the person asked for reduced motion). */
  pulses: boolean;
}

export function gaugeView(g: UnassignedGauge): GaugeView {
  const clear = g.count === 0;
  const level = clampLevel(g.level);
  const word = clear ? 'All clear' : LEVEL_WORDS[level];
  const basis = g.ageBasis === 'CLOCK' ? 'clock hours' : 'working hours';
  const age = clear ? '-' : ageText(g.oldestAgeMinutes);
  const badge = clear ? 'All clear' : level === 0 ? 'Normal' : `Level ${level} · ${word}`;
  const doLine = clear ? GAUGE_CLEAR : GAUGE_DO[level];
  const plural = g.count === 1 ? 'task' : 'tasks';
  const announcement = clear
    ? 'Unassigned wait: all clear. Nothing is unassigned.'
    : `Unassigned wait level is now ${level} of ${GAUGE_MAX_LEVEL}, ${word}. ${g.count} unassigned ${plural}.`;
  return {
    clear,
    level,
    word,
    badge,
    count: g.count,
    age,
    basis,
    ageLabel: `oldest, ${basis}`,
    doLine,
    needleDeg: clear ? 3 : level * 30 + 15,
    ariaLabel: clear
      ? 'Unassigned wait gauge, all clear'
      : `Unassigned wait gauge, level ${level} of ${GAUGE_MAX_LEVEL}, ${word}. ${g.count} unassigned ${plural}, oldest ${age}, ${basis}.`,
    announcement,
    pulses: !clear && level >= 4,
  };
}

/**
 * The level the last announcement was about is remembered by the component; a refresh that keeps the level says nothing
 * (aria-live polite only on a level change). Returns the message to announce, or null.
 */
export function levelChange(
  previous: number | null,
  g: UnassignedGauge,
): { key: number; message: string | null } {
  const view = gaugeView(g);
  const key = view.clear ? -1 : view.level;
  return { key, message: previous !== null && previous !== key ? view.announcement : null };
}
