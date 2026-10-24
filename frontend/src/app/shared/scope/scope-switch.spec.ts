import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ScopeSwitch } from './scope-switch';
import { Scope } from './scope.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScopeSwitch],
  template: `<mf-scope-switch
    [scope]="scope()"
    [canAll]="canAll()"
    (scopeChange)="picked.push($event); scope.set($event)"
  />`,
})
class Host {
  readonly scope = signal<Scope | null>('mine');
  readonly canAll = signal(true);
  readonly picked: Scope[] = [];
}

describe('ScopeSwitch', () => {
  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (s: string) => el.querySelector<HTMLButtonElement>(`[data-scope="${s}"]`)!;
    return { fixture, el, button, host: fixture.componentInstance };
  }

  it('is a toggle group: text states the scope, aria-pressed marks it', () => {
    const { button } = setup();
    expect(button('mine').textContent?.trim()).toBe('My matters');
    expect(button('all').textContent?.trim()).toBe('All');
    expect(button('mine').getAttribute('aria-pressed')).toBe('true');
    expect(button('all').getAttribute('aria-pressed')).toBe('false');
  });

  it('emits the new scope and announces it politely, once per change', () => {
    const { fixture, el, button, host } = setup();
    button('all').click();
    fixture.detectChanges();
    expect(host.picked).toEqual(['all']);
    expect(el.querySelector('[data-scope-live]')?.textContent?.trim()).toBe('Showing all matters');
    expect(button('all').getAttribute('aria-pressed')).toBe('true');
    button('all').click(); // already pressed: nothing
    expect(host.picked).toEqual(['all']);
    button('mine').click();
    fixture.detectChanges();
    expect(el.querySelector('[data-scope-live]')?.textContent?.replace('\u200b', '')).toBe(
      'Showing matters you manage',
    );
  });

  it('is not shown without "All" (nothing to switch) or when the scope does not apply', () => {
    const { fixture, el, host } = setup();
    expect(el.querySelector('[data-scope-switch]')).not.toBeNull();
    host.canAll.set(false);
    fixture.detectChanges();
    expect(el.querySelector('[data-scope-switch]')).toBeNull();
    host.canAll.set(true);
    host.scope.set(null);
    fixture.detectChanges();
    expect(el.querySelector('[data-scope-switch]')).toBeNull();
  });
});
