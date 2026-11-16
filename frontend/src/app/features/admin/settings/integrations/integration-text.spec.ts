import {
  LOOKUP_UNAVAILABLE,
  SECRET_WARN_DAYS,
  lifetimeText,
  secretExpiry,
  testCopy,
  testToast,
} from './integration-text';

const NOW = new Date('2026-11-16T15:30:00Z');
const ZONE = 'America/New_York';

describe('Integrations copy (#1395)', () => {
  describe('secretExpiry', () => {
    it('no secret is "Not Set"', () => {
      expect(secretExpiry(false, undefined, NOW, ZONE)).toMatchObject({
        state: 'none',
        chip: 'SECRET_NOT_SET',
        label: 'Not Set',
      });
    });

    it('a secret with time left says how many days', () => {
      expect(secretExpiry(true, '2027-03-18', NOW, ZONE)).toMatchObject({
        state: 'ok',
        days: 122,
        label: 'Expires in 122 days',
      });
    });

    it('warns at 30 days or less, in the singular and on the day itself', () => {
      expect(secretExpiry(true, '2026-12-16', NOW, ZONE)).toMatchObject({
        state: 'soon',
        days: SECRET_WARN_DAYS,
      });
      expect(secretExpiry(true, '2026-12-17', NOW, ZONE).state).toBe('ok');
      expect(secretExpiry(true, '2026-11-17', NOW, ZONE).label).toBe('Expires in 1 day');
      expect(secretExpiry(true, '2026-11-16', NOW, ZONE)).toMatchObject({
        state: 'soon',
        label: 'Expires today',
      });
    });

    it('an expired secret is red and counts the days since', () => {
      expect(secretExpiry(true, '2026-11-10', NOW, ZONE)).toMatchObject({
        state: 'expired',
        chip: 'SECRET_EXPIRED',
        label: 'Expired 6 days ago',
      });
      expect(secretExpiry(true, '2026-11-15', NOW, ZONE).label).toBe('Expired 1 day ago');
    });

    it("today is the day in the person's zone, not in UTC", () => {
      const lateEvening = new Date('2026-11-17T02:00:00Z'); // 9 PM on 11/16 in New York
      expect(secretExpiry(true, '2026-11-16', lateEvening, ZONE).label).toBe('Expires today');
      expect(secretExpiry(true, '2026-11-16', lateEvening, 'UTC').state).toBe('expired');
    });
  });

  describe('testCopy', () => {
    it('has a title and a reason for every outcome, and no outcome shows technical text', () => {
      const outcomes = [
        'OK',
        'NOT_SET_UP',
        'ENTRA_UNREACHABLE',
        'CREDENTIALS_REFUSED',
        'SECRET_EXPIRED',
        'SCOPE_REFUSED',
        'API_UNREACHABLE',
        'API_REFUSED',
        'SOMETHING_NEW',
      ];
      for (const o of outcomes) {
        const c = testCopy(o, 'Matter Lookup', {
          scope: 'api://x/.default',
          baseUrl: 'https://x.test',
        });
        expect(c.title.length, o).toBeGreaterThan(5);
        expect(c.detail.length, o).toBeGreaterThan(10);
        expect(c.title + c.detail, o).not.toMatch(/AADSTS|_REFUSED|_UNREACHABLE|undefined|null/);
      }
    });

    it('success names the token lifetime; not set up is information, not a failure', () => {
      expect(testCopy('OK', 'Matter Lookup', { tokenSeconds: 3599 }).detail).toContain(
        '60 minutes',
      );
      expect(testCopy('NOT_SET_UP', null).tone).toBe('info');
      expect(testCopy('SECRET_EXPIRED', null).tone).toBe('bad');
    });

    it('names the scope and the Base URL it is about', () => {
      expect(testCopy('SCOPE_REFUSED', 'X', { scope: 'api://abc/.default' }).detail).toContain(
        'api://abc/.default',
      );
      expect(
        testCopy('API_UNREACHABLE', 'X', { baseUrl: 'https://matters.example.test' }).detail,
      ).toContain('https://matters.example.test');
    });

    it('the Entra ID test talks about the credentials only', () => {
      expect(testCopy('OK', null).detail).toBe('Entra ID accepted the credentials.');
    });
  });

  it('lifetimeText reads in seconds, minutes and hours', () => {
    expect(lifetimeText(45)).toBe('45 seconds');
    expect(lifetimeText(3599)).toBe('60 minutes');
    expect(lifetimeText(7200)).toBe('2 hours');
    expect(lifetimeText(undefined)).toBe('a short while');
  });

  it("a toast names the thing: success is short, a failure says Couldn't connect", () => {
    const ok = testToast('OK', 'Matter Lookup', testCopy('OK', 'Matter Lookup'));
    expect(ok).toMatchObject({ ok: true, summary: 'Matter Lookup is connected.' });
    const bad = testToast(
      'SCOPE_REFUSED',
      'Matter Lookup',
      testCopy('SCOPE_REFUSED', 'Matter Lookup'),
    );
    expect(bad).toMatchObject({
      ok: false,
      summary: "Couldn't connect Matter Lookup.",
      detail: 'Entra ID refused the scope.',
    });
    expect(testToast('NOT_SET_UP', null, testCopy('NOT_SET_UP', null)).summary).toBe(
      'Microsoft Entra ID is not set up yet.',
    );
  });

  it('every unavailable Lookup state has a tooltip that says who can fix it and a sentence for the field', () => {
    for (const state of ['NOT_SET_UP', 'DISABLED', 'FAILED']) {
      expect(LOOKUP_UNAVAILABLE[state].tip).toContain('Settings > Integrations');
      expect(LOOKUP_UNAVAILABLE[state].sentence).toContain('Enter the details yourself');
    }
    expect(LOOKUP_UNAVAILABLE['READY']).toBeUndefined();
  });
});
