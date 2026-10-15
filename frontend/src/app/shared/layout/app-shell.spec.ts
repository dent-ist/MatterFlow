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

  it('opens the shortcut list with ? and lists Ctrl+K, but not while typing', async () => {
    const fixture = await create(['Matter.View']);
    const input = fixture.nativeElement.querySelector('mf-global-search input') as HTMLInputElement;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await settle(fixture);
    expect(document.body.querySelector('[data-shortcut-help]')).toBeNull();

    (document.activeElement as HTMLElement).blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    // The list loads on first use.
    await vi.waitFor(() =>
      expect(document.body.querySelector('[data-shortcut-help]')).not.toBeNull(),
    );
    await settle(fixture);
    const help = document.body.querySelector('[data-shortcut-help]');
    expect(help).not.toBeNull();
    expect(help!.textContent).toContain('Ctrl');
    expect(help!.textContent).toContain('Search matters');
    expect(document.body.querySelector('[role=dialog]')!.textContent).toContain(
      'Keyboard shortcuts',
    );
  });

  it('has a Keyboard shortcuts button for people who do not know the key', async () => {
    const fixture = await create(['Matter.View']);
    const button = fixture.nativeElement.querySelector(
      '[data-shortcut-help-button]',
    ) as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Keyboard shortcuts');
  });
});
