import {
  DISPOSITIONS,
  DispositionCode,
  bulkImpactLine,
  bulkReason,
  dispositionLabel,
  impactLine,
  noteRequired,
  whyNot,
} from './asset-disposition';
import { formatSize } from './asset-size';

describe('dispositions', () => {
  it('has the four states in the order of a record life, each with its own label, tone and icon', () => {
    expect(DISPOSITIONS.map((d) => d.label)).toEqual([
      'Active',
      'Inactive',
      'Pending disposition',
      'Disposed',
    ]);
    expect(new Set(DISPOSITIONS.map((d) => d.icon)).size).toBe(4);
    expect(dispositionLabel('PENDING_DISPOSITION')).toBe('Pending disposition');
    expect(dispositionLabel(undefined)).toBe('Active');
    expect(dispositionLabel('SOMETHING_NEW')).toBe('Active');
  });

  it('mirrors the server rules for what a person may choose', () => {
    const codes: DispositionCode[] = ['ACTIVE', 'INACTIVE', 'PENDING_DISPOSITION', 'DISPOSED'];
    // An editor can switch between Active and Inactive but not retire an asset.
    expect(whyNot('ACTIVE', 'INACTIVE', true, false)).toBeNull();
    expect(whyNot('INACTIVE', 'ACTIVE', true, false)).toBeNull();
    expect(whyNot('ACTIVE', 'PENDING_DISPOSITION', true, false)).toContain('dispose');
    expect(whyNot('ACTIVE', 'DISPOSED', true, false)).toContain('dispose');
    // A disposer can retire it; Active and Inactive still need the edit permission.
    expect(whyNot('ACTIVE', 'DISPOSED', false, true)).toBeNull();
    expect(whyNot('PENDING_DISPOSITION', 'ACTIVE', false, true)).toContain('edit');
    // Disposed is final except for the correction back to Inactive by a disposer.
    for (const to of codes.filter((c) => c !== 'INACTIVE')) {
      expect(whyNot('DISPOSED', to, true, true)).toContain('only be moved back to Inactive');
    }
    expect(whyNot('DISPOSED', 'INACTIVE', true, true)).toBeNull();
    expect(whyNot('DISPOSED', 'INACTIVE', true, false)).toContain('dispose');
  });

  it('asks for a note to dispose of an asset and to correct a disposal', () => {
    expect(noteRequired('ACTIVE', 'DISPOSED')).toBe(true);
    expect(noteRequired('DISPOSED', 'INACTIVE')).toBe(true);
    expect(noteRequired('ACTIVE', 'PENDING_DISPOSITION')).toBe(false);
    expect(noteRequired('INACTIVE', 'ACTIVE')).toBe(false);
  });

  it('states the impact of open linked tasks, never as a block, and not for Active or an unknown count', () => {
    expect(impactLine('PENDING_DISPOSITION', 3)).toBe('3 open tasks keep this link.');
    expect(impactLine('DISPOSED', 1)).toBe('1 open task keeps this link.');
    expect(impactLine('INACTIVE', 0)).toBeNull();
    expect(impactLine('INACTIVE', null)).toBeNull();
    expect(impactLine('ACTIVE', 5)).toBeNull();
    expect(bulkImpactLine('DISPOSED', [2, 0, null, 1])).toBe(
      '2 of the 4 selected assets are linked to open tasks (3 in all). The links stay.',
    );
    expect(bulkImpactLine('DISPOSED', [1])).toContain('1 of the 1 selected asset is linked');
    expect(bulkImpactLine('ACTIVE', [2])).toBeNull();
    expect(bulkImpactLine('DISPOSED', [0, null])).toBeNull();
  });

  it('puts the reason of a failed bulk item in plain words', () => {
    expect(bulkReason('NOT_FOUND', undefined)).toBe('it no longer exists');
    expect(bulkReason('DISPOSED_IS_FINAL', undefined)).toContain('Inactive');
    expect(bulkReason('NOTE_REQUIRED', undefined)).toBe('a note is required');
    expect(bulkReason('SOMETHING', 'Custom text')).toBe('Custom text');
    expect(bulkReason(undefined, undefined)).toBe('it could not be changed');
  });
});

describe('formatSize', () => {
  it('shows whole numbers without decimals, others with at most two, and nothing without a value', () => {
    expect(formatSize(412, 'GB')).toBe('412 GB');
    expect(formatSize(412.456, 'GB')).toBe('412.46 GB');
    expect(formatSize(26400, 'Items')).toBe('26,400 Items');
    expect(formatSize(7, undefined)).toBe('7');
    expect(formatSize(undefined, 'GB')).toBe('');
    expect(formatSize(null, 'GB')).toBe('');
  });
});
