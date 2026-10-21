import { AvailabilityStateCode } from '../../../core/availability/availability';
import { availabilityShown } from './user-availability';

describe('availabilityShown (#434)', () => {
  const states: (AvailabilityStateCode | undefined)[] = [
    'AVAILABLE',
    'OFF_HOURS',
    'OUT_OF_OFFICE',
    undefined,
  ];
  const people = [
    { name: 'active', isActive: true, isPending: false },
    { name: 'pending', isActive: true, isPending: true },
    { name: 'inactive', isActive: false, isPending: false },
  ];

  for (const person of people) {
    for (const state of states) {
      const expected = (() => {
        if (person.name !== 'active') return 'none';
        return state === 'OFF_HOURS' || state === 'OUT_OF_OFFICE' ? 'chip' : 'plain';
      })();
      it(`${person.name} and ${state ?? 'no availability'} shows ${expected}`, () => {
        expect(availabilityShown({ ...person, availability: state ? { state } : undefined })).toBe(
          expected,
        );
      });
    }
  }
});
