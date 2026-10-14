import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SearchClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { ok, settle } from '../testing/org-testing';
import { AppShell } from './app-shell';

describe('AppShell header search', () => {
  async function create(permissions: Permission[]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        {
          provide: SearchClient,
          useValue: { search: vi.fn().mockReturnValue(ok({ query: '', groups: [] })) },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(AppShell);
    await settle(fixture);
    return fixture;
  }

  it('shows the global search combobox to anyone who may view a searchable type', async () => {
    const fixture = await create(['Task.View']);
    const box = fixture.nativeElement.querySelector('mf-global-search input[role=combobox]');
    expect(box).not.toBeNull();
    expect(box.getAttribute('placeholder')).toContain('Ctrl+K');
  });

  it('hides the search when the user may view none of the searchable types', async () => {
    const fixture = await create(['Pod.View']);
    expect(fixture.nativeElement.querySelector('mf-global-search')).toBeNull();
  });

  it('focuses the search with Ctrl+K', async () => {
    const fixture = await create(['Matter.View']);
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('mf-global-search input'),
    );
  });
});
