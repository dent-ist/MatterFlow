import { loudPriority, loudStatus } from './quiet-badges';

describe('quiet badges (My Matters grids)', () => {
  it('a priority is loud only when it is High or Critical (by tone or by label)', () => {
    expect(loudPriority({ label: 'Normal', color: 'normal' })).toBe(false);
    expect(loudPriority({ label: 'Low', color: 'low' })).toBe(false);
    expect(loudPriority({ label: 'High', color: 'high' })).toBe(true);
    expect(loudPriority({ label: 'Critical', color: 'critical' })).toBe(true);
    expect(loudPriority({ label: 'Urgent high', color: '#ff0000' })).toBe(true);
    expect(loudPriority({ label: 'Highlight', color: '#888888' })).toBe(false);
  });

  it('a status is loud only when On hold, or At risk on an open task', () => {
    expect(loudStatus({ status: 'IN_PROGRESS', atRisk: false })).toBeNull();
    expect(loudStatus({ status: 'NEW', atRisk: false })).toBeNull();
    expect(loudStatus({ status: 'ON_HOLD', atRisk: false })).toBe('hold');
    expect(loudStatus({ status: 'ON_HOLD', atRisk: true })).toBe('hold');
    expect(loudStatus({ status: 'IN_PROGRESS', atRisk: true })).toBe('risk');
    expect(loudStatus({ status: 'COMPLETED', atRisk: true })).toBeNull();
  });
});
