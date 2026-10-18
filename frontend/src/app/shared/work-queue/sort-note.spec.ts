import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SortNote } from './sort-note';

describe('SortNote', () => {
  let fixture: ComponentFixture<SortNote>;
  const el = () => fixture.nativeElement as HTMLElement;

  async function create(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(SortNote);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('says "Sorted by Priority (default order)" with the rule behind a keyboard-reachable info button', async () => {
    await create();
    const note = el().querySelector('[data-sort-note]')!;
    expect(note.textContent).toContain('Sorted by Priority (default order)');
    expect(el().querySelector('[data-sort-rule]')).toBeNull();
    const info = note.querySelector<HTMLButtonElement>('.sn-info')!;
    expect(info.getAttribute('aria-label')).toBe('How the default order works');
    info.click();
    fixture.detectChanges();
    expect(info.getAttribute('aria-expanded')).toBe('true');
    expect(el().querySelector('[data-sort-rule]')!.textContent).toContain(
      'Default order: Priority, ASAP first, Due date, Oldest',
    );
    info.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el().querySelector('[data-sort-rule]')).toBeNull();
  });

  it('names the sorted column and the direction for a header sort, with no info button', async () => {
    await create({ sort: 'due', dir: 'desc' });
    const note = el().querySelector('[data-sort-note]')!;
    expect(note.textContent).toContain('Sorted by Due date');
    expect(note.textContent).toContain('(descending)');
    expect(note.textContent).not.toContain('default order');
    expect(note.querySelector('.sn-info')).toBeNull();
  });
});
