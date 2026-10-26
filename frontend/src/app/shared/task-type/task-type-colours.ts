/**
 * The Task Type colour palette: a named set of ten, never a free hex value (`contracts/task-type-colours.json`, validated by the API, kept in step
 * by `task-type-colours.spec.ts`). A missing colour is the neutral default. Colour is never the only signal: the icon and the name always show too.
 * Pure data, safe for any chunk (no api-client or lookup-store import).
 */
export interface TaskTypeColour {
  readonly key: string;
  readonly label: string;
  /** Tinted chip background (light theme, the only theme of Phase 1). */
  readonly bg: string;
  /** Icon and text colour on `bg`: at least 4.5:1 (text) and 3:1 (icon), checked by a unit test. */
  readonly fg: string;
}

export const TASK_TYPE_COLOURS: readonly TaskTypeColour[] = [
  { key: 'slate', label: 'Slate', bg: '#E3E7EE', fg: '#2F3846' },
  { key: 'blue', label: 'Blue', bg: '#DCE8FB', fg: '#173C79' },
  { key: 'teal', label: 'Teal', bg: '#D5F0EE', fg: '#0B4F4A' },
  { key: 'green', label: 'Green', bg: '#DDF1E2', fg: '#14532D' },
  { key: 'amber', label: 'Amber', bg: '#FDEBB8', fg: '#5C3B00' },
  { key: 'orange', label: 'Orange', bg: '#FFE0CC', fg: '#6B2A00' },
  { key: 'red', label: 'Red', bg: '#FBDAD6', fg: '#7A1B12' },
  { key: 'rose', label: 'Rose', bg: '#FADCEA', fg: '#7A1546' },
  { key: 'violet', label: 'Violet', bg: '#E9E0FA', fg: '#45248A' },
  { key: 'indigo', label: 'Indigo', bg: '#DFE3FA', fg: '#2A2F85' },
];

/** The neutral default (no colour chosen): the same quiet grey as the surfaces around it. */
export const TASK_TYPE_COLOUR_NEUTRAL = { bg: '#EEF0F4', fg: '#3B4350' } as const;

/** The label of the neutral default (no colour chosen). */
export const TASK_TYPE_COLOUR_DEFAULT_LABEL = 'Neutral (default)';

/** Smallest and largest allowed target turnaround, in calendar days. */
export const TASK_TYPE_TARGET_DAYS_MIN = 1;
export const TASK_TYPE_TARGET_DAYS_MAX = 365;

const KEYS: ReadonlySet<string> = new Set(TASK_TYPE_COLOURS.map((c) => c.key));

/** True when `key` is exactly one of the palette names. */
export function isTaskTypeColour(key: string | null | undefined): key is string {
  return key != null && KEYS.has(key);
}

/** The palette entry for `key`, or undefined for the neutral default and unknown names. */
export function taskTypeColour(key: string | null | undefined): TaskTypeColour | undefined {
  return TASK_TYPE_COLOURS.find((c) => c.key === key);
}

/** The chip colours of a palette name; the neutral pair for no colour or an unknown name. */
export function taskTypeChipColours(key: string | null | undefined): { bg: string; fg: string } {
  const c = taskTypeColour(key);
  return c ? { bg: c.bg, fg: c.fg } : TASK_TYPE_COLOUR_NEUTRAL;
}
