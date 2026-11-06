import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, profileOf, provideFakeMe } from '../../../core/auth/auth-testing';
import { AccessPendingPage } from './access-pending-page';

describe('AccessPendingPage copy (#428)', () => {
  async function render(
    profile = profileOf({ displayName: 'Pat Pending', status: 'ACCESS_PENDING' }),
  ) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideFakeMe(new FakeMeApi(profile))],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(AccessPendingPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const flat = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');

  it('has no space before the full stop after the account name', async () => {
    const el = await render(
      profileOf({
        displayName: 'Pat Pending',
        windowsAccount: 'KE\\pend01',
        status: 'ACCESS_PENDING',
      }),
    );
    const text = flat(el);
    expect(text).toContain('Pat Pending (KE\\pend01). An administrator needs to give you a role');
    expect(text).not.toMatch(/\) \./);
  });

  it('has no space before the full stop when the account repeats the name', async () => {
    const el = await render(
      profileOf({
        displayName: 'KE\\pend01',
        windowsAccount: 'KE\\pend01',
        status: 'ACCESS_PENDING',
      }),
    );
    expect(flat(el)).toContain('KE\\pend01. An administrator needs to give you a role');
  });

  it('is the shared state-page card with one sentence, the account with a copy button and one button (#1193)', async () => {
    const el = await render(
      profileOf({
        displayName: 'Pat Pending',
        windowsAccount: 'KE\\pend01',
        status: 'ACCESS_PENDING',
      }),
    );
    expect(el.querySelector('[data-state-page]')).not.toBeNull();
    expect(el.querySelectorAll('h1')).toHaveLength(1);
    expect(el.querySelector('[data-pending-account] button')!.getAttribute('aria-label')).toBe(
      'Copy Windows account name',
    );
    const buttons = el.querySelectorAll('[data-state-actions] .mf-btn');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('Check Again');
    expect(flat(el)).not.toContain('Contact:');
  });

  it('the disabled page says "disabled" once and what to do, with the name and account written once (#610)', async () => {
    const el = await render(
      profileOf({ displayName: 'Dee Sabled', windowsAccount: 'KE\\dsabled', status: 'DISABLED' }),
    );
    const text = flat(el);
    expect(text.match(/account is disabled/gi)).toHaveLength(1);
    expect(text).toContain('Contact the administrator to have it enabled again.');
    expect(text).toContain("You're signed in as Dee Sabled (KE\\dsabled).");
    expect(el.querySelector('h1')!.getAttribute('tabindex')).toBe('-1');
  });

  it('the disabled page does not repeat an account that only repeats the name (#610)', async () => {
    const el = await render(
      profileOf({ displayName: 'KE\\dsabled', windowsAccount: 'ke\\DSABLED', status: 'DISABLED' }),
    );
    expect(flat(el)).toContain("You're signed in as KE\\dsabled.");
  });
});
