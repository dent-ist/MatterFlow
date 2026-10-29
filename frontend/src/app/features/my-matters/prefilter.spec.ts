import {
  MmPrefilter,
  PREFILTERS,
  PREFILTER_KEYS,
  parsePrefilter,
  prefilterParams,
} from './prefilter';

describe('prefilter (#942)', () => {
  it('has the six choices in the order of the old tiles, All open first', () => {
    expect(PREFILTER_KEYS).toEqual([
      'open',
      'overdue',
      'atRisk',
      'unassigned',
      'onHold',
      'dueSoon',
    ]);
    expect(PREFILTER_KEYS.map((k) => PREFILTERS[k].label)).toEqual([
      'All open',
      'Overdue',
      'At risk',
      'Unassigned',
      'On hold',
      'Due soon (within 7 days)',
    ]);
  });

  it('maps every choice to one filter of the Task Queue, On hold being the one status', () => {
    const params = (k: MmPrefilter) => prefilterParams(k);
    expect(params('open')).toEqual({});
    expect(params('overdue')).toEqual({ overdue: 'true' });
    expect(params('atRisk')).toEqual({ atRisk: 'true' });
    expect(params('unassigned')).toEqual({ unassigned: 'true' });
    expect(params('onHold')).toEqual({ status: ['ON_HOLD'] });
    expect(params('dueSoon')).toEqual({ dueWithin: '7' });
  });

  it('reads the address, and takes anything unknown for All open', () => {
    expect(parsePrefilter('atRisk')).toBe('atRisk');
    expect(parsePrefilter('nonsense')).toBe('open');
    expect(parsePrefilter(null)).toBe('open');
  });

  it('says what the grid shows, in the singular too', () => {
    expect(PREFILTERS.overdue.noun).toBe('overdue tasks');
    expect(PREFILTERS.overdue.one).toBe('overdue task');
    expect(PREFILTERS.dueSoon.noun).toBe('tasks due within 7 days');
  });
});
