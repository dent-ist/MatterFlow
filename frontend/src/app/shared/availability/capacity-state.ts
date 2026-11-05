/**
 * The six states of a person's capacity (Dashboard v4, epic #1063, decision AS items 5 and 6): by open assigned tasks (New, In progress; On hold does not
 * count) 0 Available, 1 Occupied, 2 Busy, 3 or more Overloaded; Out of office and Off hours people are unavailable. The legend of the battery, the People list and
 * the assign picker all read the words and icons from here, so colour is never the only signal.
 */
export const CAPACITY_STATES = [
  'AVAILABLE',
  'OCCUPIED',
  'BUSY',
  'OVERLOADED',
  'OUT_OF_OFFICE',
  'OFF_HOURS',
] as const;
export type CapacityState = (typeof CAPACITY_STATES)[number];

export interface StateMeta {
  label: string;
  /** PrimeIcons class. */
  icon: string;
  /** The `--mf-cap-*` step (0 lightest) or the neutral kinds of a person who adds no free capacity. */
  swatch: 'cap-0' | 'cap-1' | 'cap-2' | 'cap-3' | 'out' | 'off';
}

export const STATE_META: Record<CapacityState, StateMeta> = {
  AVAILABLE: { label: 'Available', icon: 'pi-check-circle', swatch: 'cap-0' },
  OCCUPIED: { label: 'Occupied', icon: 'pi-circle', swatch: 'cap-1' },
  BUSY: { label: 'Busy', icon: 'pi-minus-circle', swatch: 'cap-2' },
  OVERLOADED: { label: 'Overloaded', icon: 'pi-exclamation-triangle', swatch: 'cap-3' },
  OUT_OF_OFFICE: { label: 'Out of Office', icon: 'pi-ban', swatch: 'out' },
  OFF_HOURS: { label: 'Off Hours', icon: 'pi-moon', swatch: 'off' },
};

export function isCapacityState(value: unknown): value is CapacityState {
  return typeof value === 'string' && (CAPACITY_STATES as readonly string[]).includes(value);
}

/** `Busy, 2 open`: the muted text after a person's name in the assign picker. */
export function stateHint(state: CapacityState, load: number): string {
  return `${STATE_META[state].label}, ${load} open`;
}
