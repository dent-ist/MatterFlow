import { AvailabilityLike } from '../../../core/availability/availability';

/** What the Availability cell of a person shows (#434). */
export type AvailabilityShown = 'none' | 'plain' | 'chip';

/** The parts of a person the rule needs. */
export interface AvailabilitySubject {
  isActive: boolean;
  isPending: boolean;
  availability?: AvailabilityLike | null;
}

/**
 * Availability informs only where it can change what you do (#434, U6):
 *  - nothing for a person who is Pending access or Inactive (they take no work, so "Off hours" there is noise);
 *  - the chip for Out of office (with the end date) and for Off hours (the server reports it only when work hours are set);
 *  - plain muted text "Available" for an active person with nothing to report, so the Availability filter still has a visible answer.
 * The chip text is the one of the shared availability chip (Dashboard, My Work); colour is never the only signal.
 */
export function availabilityShown(person: AvailabilitySubject): AvailabilityShown {
  if (person.isPending || !person.isActive) return 'none';
  const state = person.availability?.state;
  return state === 'OUT_OF_OFFICE' || state === 'OFF_HOURS' ? 'chip' : 'plain';
}
