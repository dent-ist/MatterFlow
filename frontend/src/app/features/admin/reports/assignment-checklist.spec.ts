import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AssignmentChecklist, ChecklistItem, diffMessage } from './assignment-checklist';

describe('diffMessage', () => {
  it('says what the owner has now and what changed', () => {
    expect(diffMessage('Pod Lead', 3, 'report', ['Tasks per matter'], [])).toBe(
      'Pod Lead now has 3 reports (added Tasks per matter).',
    );
    expect(diffMessage('Pod Lead', 1, 'report', ['A', 'B'], ['C'])).toBe(
      'Pod Lead now has 1 report (added A, B; removed C).',
    );
    expect(diffMessage('Overdue', 0, 'role', [], ['Director'])).toBe(
      'Overdue now has 0 roles (removed Director).',
    );
    expect(diffMessage('X', 2, 'role', [], [])).toBe('X now has 2 roles.');
  });
});

const items = (): ChecklistItem[] => [
  {
    id: 1,
    name: 'Overdue tasks',
    group: 'Task follow-up',
    detail: 'Tasks past due',
    assigned: true,
  },
  { id: 2, name: 'Tasks per matter', group: 'Task follow-up', assigned: false },
  { id: 3, name: 'Open tasks by client', group: 'Finance', flag: 'Inactive', assigned: false },
];

@Component({
  imports: [AssignmentChecklist],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-assignment-checklist
    #c
    noun="report"
    legend="Reports of Pod Lead"
    [items]="items()"
    [busy]="busy()"
    (save)="saved = $event"
  />`,
})
class Host {
  readonly items = signal(items());
  readonly busy = signal(false);
  saved: number[] | null = null;
}

describe('AssignmentChecklist', () => {
  function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const box = (id: number) => el.querySelector<HTMLInputElement>(`[data-item="${id}"] input`)!;
    const click = (sel: string) => el.querySelector<HTMLButtonElement>(sel)!.click();
    return { fixture, el, box, click };
  }

  it('lists the items under their group headings, flags the inactive ones in text and counts the assigned', () => {
    const { el, box } = create();
    expect(
      [...el.querySelectorAll('[data-checklist-group]')].map((g) => g.textContent!.trim()),
    ).toEqual(['Task follow-up', 'Finance']);
    expect(el.querySelector('[data-item="3"] [data-flag]')!.textContent).toBe('Inactive');
    expect(box(1).checked).toBe(true);
    expect(box(2).checked).toBe(false);
    expect(el.querySelector('[data-checklist-count]')!.textContent).toContain(
      '1 of 3 reports assigned',
    );
    expect(el.querySelector('legend')!.textContent).toBe('Reports of Pod Lead');
  });

  it('changes nothing until Save, then emits the checked ids; Discard goes back', () => {
    const { fixture, el, box, click } = create();
    expect(el.querySelector<HTMLButtonElement>('[data-checklist-save]')!.disabled).toBe(true);

    box(2).click();
    box(1).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-checklist-count]')!.textContent).toContain('1 of 3');
    expect(el.querySelector<HTMLButtonElement>('[data-checklist-save]')!.disabled).toBe(false);
    click('[data-checklist-reset]');
    fixture.detectChanges();
    expect(box(1).checked).toBe(true);
    expect(box(2).checked).toBe(false);

    box(2).click();
    fixture.detectChanges();
    click('[data-checklist-save]');
    expect(fixture.componentInstance.saved).toEqual([1, 2]);
  });

  it('filters by name, category or description without losing the checked state', () => {
    const { fixture, el, box } = create();
    box(2).click();
    const search = el.querySelector<HTMLInputElement>('[data-checklist-search]')!;
    search.value = 'finance';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect([...el.querySelectorAll('[data-item]')].map((i) => i.getAttribute('data-item'))).toEqual(
      ['3'],
    );
    search.value = 'past due';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect([...el.querySelectorAll('[data-item]')].map((i) => i.getAttribute('data-item'))).toEqual(
      ['1'],
    );
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-checklist-empty]')!.textContent).toContain('No reports match');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(box(2).checked).toBe(true);
  });

  it('takes a new list as the saved state and disables everything while busy', () => {
    const { fixture, el, box } = create();
    box(2).click();
    fixture.detectChanges();
    fixture.componentInstance.items.set([
      { id: 1, name: 'Overdue tasks', assigned: true },
      { id: 2, name: 'Tasks per matter', assigned: true },
    ]);
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('[data-checklist-save]')!.disabled).toBe(true);
    expect(el.querySelector('[data-checklist-clean]')).not.toBeNull();
    fixture.componentInstance.busy.set(true);
    fixture.detectChanges();
    expect(el.querySelector('fieldset')!.disabled).toBe(true);
  });
});
