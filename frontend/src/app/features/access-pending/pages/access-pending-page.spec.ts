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

  it('says the administrator is already notified and who to ask for faster access', async () => {
    const el = await render();
    const text = flat(el);
    expect(text).toContain(
      'An administrator is notified through the Users page: you do not need to resend this.',
    );
    expect(text).toContain('Ask your Pod Lead or manager if you need access sooner.');
    expect(text).not.toContain('Contact:');
  });
});
