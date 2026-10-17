import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkTab, WorkTabs } from './work-tabs';

describe('WorkTabs counts', () => {
  let fixture: ComponentFixture<WorkTabs>;
  const tab = (key: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`#t-tab-${key}`)!;

  function create(tabs: WorkTab[]) {
    fixture = TestBed.createComponent(WorkTabs);
    fixture.componentRef.setInput('tabs', tabs);
    fixture.componentRef.setInput('selected', 'a');
    fixture.componentRef.setInput('idPrefix', 't');
    fixture.detectChanges();
  }

  it('reserves "(--)" while a count is unknown and replaces it with the number (G4)', () => {
    create([{ key: 'a', label: 'Active', count: null }]);
    const pending = tab('a').querySelector('[data-count-pending]')!;
    expect(pending.textContent).toBe('(--)');
    expect(pending.getAttribute('aria-hidden')).toBe('true');

    fixture.componentRef.setInput('tabs', [{ key: 'a', label: 'Active', count: 14 }]);
    fixture.detectChanges();
    expect(tab('a').querySelector('[data-count-pending]')).toBeNull();
    expect(tab('a').querySelector('.count')!.textContent).toBe('(14)');
  });

  it('shows no count for a tab that has none', () => {
    create([{ key: 'a', label: 'Active' }]);
    expect(tab('a').querySelector('.count')).toBeNull();
  });
});
