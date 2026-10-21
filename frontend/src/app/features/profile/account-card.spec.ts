import { TestBed } from '@angular/core/testing';
import { FakeMeApi, profileOf, provideFakeMe } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { MeProfile } from '../../core/auth/me.models';
import { settle } from '../../shared/testing/org-testing';
import { AccountCard } from './account-card';

describe('AccountCard', () => {
  async function create(overrides: Partial<MeProfile> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(
          new FakeMeApi(
            profileOf({
              displayName: 'Kim Admin',
              windowsAccount: 'KE\\kekim',
              email: 'kim@example.test',
              roles: ['Pod Lead', 'Data Technician', 'Director'],
              pods: [
                { podId: 3, name: 'Zeta Pod', isActive: true, isPrimary: false },
                { podId: 1, name: 'Alpha Pod', isActive: true, isPrimary: false },
                { podId: 2, name: 'Main Pod', isActive: true, isPrimary: true },
              ],
              ...overrides,
            }),
          ),
        ),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(AccountCard);
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  }
  const text = (root: HTMLElement, sel: string) => root.querySelector(sel)?.textContent?.trim();
  const all = (root: HTMLElement, sel: string) =>
    [...root.querySelectorAll(sel)].map((e) => e.textContent!.replace(/\s+/g, ' ').trim());

  afterEach(() => TestBed.resetTestingModule());

  it('is a labelled region with a definition list: name, account, email, roles, pods', async () => {
    const root = await create();
    const region = root.querySelector('section')!;
    expect(region.getAttribute('aria-labelledby')).toBe('ac-title');
    expect(text(root, '#ac-title')).toBe('Account');
    expect(root.querySelector('dl')).not.toBeNull();
    expect(all(root, 'dt')).toEqual(['Name', 'Windows account', 'Email', 'Roles', 'Pods']);
    expect(text(root, '[data-ac-name]')).toBe('Kim Admin');
    expect(text(root, '[data-ac-account]')).toBe('KE\\kekim');
    expect(text(root, '[data-ac-email]')).toBe('kim@example.test');
    expect(text(root, '[data-ac-note]')).toBe('Managed by your administrator.');
  });

  it('lists every role by name and the Pods with the primary one first and marked', async () => {
    const root = await create();
    expect(all(root, '[data-ac-role]')).toEqual(['Data Technician', 'Director', 'Pod Lead']);
    expect(all(root, '[data-ac-pod]')).toEqual(['Main Pod Primary', 'Alpha Pod', 'Zeta Pod']);
    expect(root.querySelectorAll('[data-ac-pod][data-primary]').length).toBe(1);
  });

  it('has a real copy button for the Windows account and no edit controls', async () => {
    const root = await create();
    const copy = root.querySelector<HTMLButtonElement>('mf-copy-button button')!;
    expect(copy.getAttribute('aria-label')).toBe('Copy Windows account');
    expect(root.querySelectorAll('input, select, textarea, a').length).toBe(0);
    expect(root.querySelectorAll('button').length).toBe(1);
  });

  it('says Not set for a missing email, No pods yet for no Pods, and uses the singular labels', async () => {
    const root = await create({ email: undefined, pods: [], roles: ['Read-Only Observer'] });
    expect(text(root, '[data-ac-email]')).toBe('Not set');
    expect(text(root, '[data-ac-pods-none]')).toBe('No pods yet');
    expect(all(root, 'dt')).toEqual(['Name', 'Windows account', 'Email', 'Role', 'Pods']);
    expect(all(root, '[data-ac-role]')).toEqual(['Read-Only Observer']);
  });

  it('keeps a 66-character name whole (it wraps in the card instead of being cut)', async () => {
    const name = 'Persona Featherstonehaugh Cholmondeley Wolfeschlegelstein Montgome';
    expect(name.length).toBe(66);
    const root = await create({ displayName: name, email: undefined });
    expect(text(root, '[data-ac-name]')).toBe(name);
  });

  it('shows 5 pods and 3 roles without a limit', async () => {
    const pods = [1, 2, 3, 4, 5].map((i) => ({
      podId: i,
      name: `Pod ${i}`,
      isActive: true,
      isPrimary: i === 4,
    }));
    const root = await create({ pods });
    expect(all(root, '[data-ac-pod]')).toEqual([
      'Pod 4 Primary',
      'Pod 1',
      'Pod 2',
      'Pod 3',
      'Pod 5',
    ]);
    expect(all(root, '[data-ac-role]').length).toBe(3);
  });
});
