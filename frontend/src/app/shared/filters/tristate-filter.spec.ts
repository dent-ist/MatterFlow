import { ddSelect } from '../../testing/dropdown-testing.spec-util';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ColumnTristateFilter } from './tristate-filter';

describe('tri-state column filter', () => {
  let fixture: ComponentFixture<ColumnTristateFilter>;
  const select = () => ddSelect(fixture.nativeElement as HTMLElement);

  beforeEach(() => {
    fixture = TestBed.createComponent(ColumnTristateFilter);
    fixture.componentRef.setInput('label', 'Overdue');
    fixture.componentRef.setInput('yesLabel', 'Overdue Only');
    fixture.componentRef.setInput('noLabel', 'Not Overdue');
    fixture.detectChanges();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('is named for its column and offers Any, Yes and No in domain wording', () => {
    expect(select().button.getAttribute('aria-label')).toMatch(/^Filter by Overdue:/);
    expect(Array.from(select().options).map((o) => [o.value, o.textContent!.trim()])).toEqual([
      ['', 'Any'],
      ['true', 'Overdue Only'],
      ['false', 'Not Overdue'],
    ]);
    expect(select().value).toBe('');
  });

  it('shows the current value and reports a change at once', () => {
    fixture.componentRef.setInput('value', 'false');
    fixture.detectChanges();
    expect(select().value).toBe('false');
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    const choice = select();
    choice.value = 'true';
    choice.dispatchEvent(new Event('change'));
    expect(emitted).toEqual(['true']);
  });
});
