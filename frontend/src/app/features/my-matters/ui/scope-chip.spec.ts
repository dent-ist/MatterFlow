import { TestBed } from '@angular/core/testing';
import { MmScopeChip } from './scope-chip';

describe('MmScopeChip (MM-20, #1053)', () => {
  function make(label: string) {
    const fixture = TestBed.createComponent(MmScopeChip);
    fixture.componentRef.setInput('label', label);
    fixture.detectChanges();
    return fixture;
  }

  it('draws nothing while the scope is everything', () => {
    expect(make('').nativeElement.querySelector('[data-scope-chip]')).toBeNull();
  });

  it('shows the scope with the whole text as tooltip and a named x that clears it', () => {
    const fixture = make('Acme Corp › Smith v. Jones');
    const el = fixture.nativeElement as HTMLElement;
    const chip = el.querySelector('[data-scope-chip]')!;
    expect(chip.getAttribute('title')).toBe('Acme Corp › Smith v. Jones');
    const x = el.querySelector<HTMLButtonElement>('[data-clear-scope]')!;
    expect(x.getAttribute('aria-label')).toBe('Clear scope: Acme Corp › Smith v. Jones');
    let cleared = 0;
    fixture.componentInstance.clear.subscribe(() => cleared++);
    x.click();
    expect(cleared).toBe(1);
  });
});
