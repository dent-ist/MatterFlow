import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ColumnUserFilter } from './user-filter';

describe('user column filter', () => {
  let fixture: ComponentFixture<ColumnUserFilter>;
  const el = (): HTMLElement => fixture.nativeElement;

  function create(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(ColumnUserFilter);
    fixture.componentRef.setInput('label', 'Assignee');
    fixture.componentRef.setInput('users', [
      { value: '7', label: 'Ada Lovelace' },
      { value: '8', label: 'Grace Hopper' },
      { value: '9', label: 'Alan Turing' },
    ]);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  const labels = () =>
    Array.from(el().querySelectorAll('mf-filter-popover .ms-opt')).map((o) =>
      o.textContent!.replace(/\s+/g, ' ').trim(),
    );

  function openPanel() {
    el().querySelector<HTMLButtonElement>('button.ft-btn')!.click();
    fixture.detectChanges();
  }

  it('is named for its column and says Any when nobody is chosen', () => {
    create();
    const button = el().querySelector('button.ft-btn')!;
    expect(button.getAttribute('aria-label')).toBe('Filter by Assignee, Any');
  });

  it('lists Me first, then the special choices, then the people', () => {
    create({
      meValue: '8',
      specials: [{ value: 'unassigned', label: 'Unassigned' }],
    });
    openPanel();
    expect(labels()).toEqual(['Me (Grace Hopper)', 'Unassigned', 'Ada Lovelace', 'Alan Turing']);
  });

  it('marks inactive people but keeps them selectable', () => {
    create({ inactive: ['9'] });
    openPanel();
    expect(labels()).toContain('Alan Turing (inactive)');
    expect(el().querySelector<HTMLInputElement>('input[data-option="9"]')!.disabled).toBe(false);
  });

  it('reports the chosen ids', () => {
    create({ value: ['7'] });
    const emitted: string[][] = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    openPanel();
    [...el().querySelectorAll<HTMLButtonElement>('mf-filter-popover button')]
      .find((b) => b.textContent?.trim() === 'Clear')!
      .click();
    expect(emitted).toEqual([[]]);
  });
});
