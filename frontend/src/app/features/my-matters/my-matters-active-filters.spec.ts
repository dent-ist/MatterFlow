import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_FILTERS, MmFilters } from './my-matters-filters';
import { MyMattersActiveFilters } from './my-matters-active-filters';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MyMattersActiveFilters],
  template: `<mf-mm-active-filters
    [filters]="filters()"
    clientName="10001 Acme"
    managerName="Dana Rao"
    (remove)="removed.push($event)"
  />`,
})
class Host {
  readonly filters = signal<MmFilters>({ ...DEFAULT_FILTERS });
  readonly removed: Partial<MmFilters>[] = [];
}

describe('MyMattersActiveFilters (issue #899)', () => {
  function setup(filters: Partial<MmFilters> = {}) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.filters.set({ ...DEFAULT_FILTERS, ...filters });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, host: fixture.componentInstance };
  }

  it('draws nothing when no filter is in force', () => {
    const { el } = setup();
    expect(el.querySelector('[data-active-filters]')).toBeNull();
  });

  it('draws one removable chip per filter in force, in plain words', () => {
    const { el } = setup({ clientId: 7, role: 'secondary' });
    const chips = Array.from(el.querySelectorAll('[data-active-filter]'));
    expect(chips.map((c) => c.querySelector('.af__text')!.textContent!.trim())).toEqual([
      'Client: 10001 Acme',
      'I am: Secondary',
    ]);
    expect(el.querySelector('button')!.getAttribute('aria-label')).toBe(
      'Remove the filter Client: 10001 Acme',
    );
  });

  it('each chip removes only its own filter', () => {
    const { el, host } = setup({ clientId: 7, role: 'primary' });
    el.querySelector<HTMLButtonElement>('[data-active-filter=role] button')!.click();
    el.querySelector<HTMLButtonElement>('[data-active-filter=client] button')!.click();
    expect(host.removed).toEqual([{ role: 'both' }, { clientId: null }]);
  });

  it('in the All matters scope a role belongs to the named manager, and removing the manager resets it', () => {
    const { el, host } = setup({ scope: 'all', managerId: 4, role: 'primary' });
    const texts = Array.from(el.querySelectorAll('.af__text')).map((t) => t.textContent!.trim());
    expect(texts).toEqual(['Project manager: Dana Rao', 'Their role: Primary']);
    el.querySelector<HTMLButtonElement>('[data-active-filter=manager] button')!.click();
    expect(host.removed).toEqual([{ managerId: null, role: 'both' }]);
  });

  it('a role is not a filter in the All scope until a manager is named', () => {
    const { el } = setup({ scope: 'all', role: 'primary' });
    expect(el.querySelector('[data-active-filters]')).toBeNull();
  });
});
