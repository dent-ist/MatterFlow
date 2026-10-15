import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ColumnTristateFilter } from './tristate-filter';

describe('tri-state column filter', () => {
  let fixture: ComponentFixture<ColumnTristateFilter>;
  const select = () => (fixture.nativeElement as HTMLElement).querySelector('select')!;

  beforeEach(() => {
    fixture = TestBed.createComponent(ColumnTristateFilter);
    fixture.componentRef.setInput('label', 'Overdue');
    fixture.componentRef.setInput('yesLabel', 'Overdue only');
    fixture.componentRef.setInput('noLabel', 'Not overdue');
    fixture.detectChanges();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('is named for its column and offers Any, Yes and No in domain wording', () => {
    expect(select().getAttribute('aria-label')).toBe('Filter by Overdue');
    expect(select().classList).toContain('mf-control--compact');
    expect(Array.from(select().options).map((o) => [o.value, o.textContent!.trim()])).toEqual([
      ['', 'Any'],
      ['true', 'Overdue only'],
      ['false', 'Not overdue'],
    ]);
    expect(select().value).toBe('');
  });

  it('shows the current value and reports a change at once', () => {
    fixture.componentRef.setInput('value', 'false');
    fixture.detectChanges();
    expect(select().value).toBe('false');
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    select().value = 'true';
    select().dispatchEvent(new Event('change'));
    expect(emitted).toEqual(['true']);
  });
});
