import { sameIdentity } from './same-identity';

describe('sameIdentity (#592)', () => {
  it('ignores case and surrounding spaces, including the DOMAIN\\ prefix', () => {
    expect(sameIdentity('KE\\kekim', 'ke\\kekim')).toBe(true);
    expect(sameIdentity(' ke\\pending ', 'KE\\pending')).toBe(true);
  });
  it('keeps different names apart and never matches an empty side', () => {
    expect(sameIdentity('Kim Lee', 'ke\\kekim')).toBe(false);
    expect(sameIdentity('', '')).toBe(false);
    expect(sameIdentity(undefined, 'a')).toBe(false);
    expect(sameIdentity('a', null)).toBe(false);
  });
});
