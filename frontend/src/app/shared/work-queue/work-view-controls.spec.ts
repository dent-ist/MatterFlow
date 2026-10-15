import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkViewControls } from './work-view-controls';

describe('WorkViewControls', () => {
  let fixture: ComponentFixture<WorkViewControls>;
  const el = () => fixture.nativeElement as HTMLElement;

  async function create(inputs: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(WorkViewControls);
    fixture.componentRef.setInput('columns', ['ref', 'title', 'status']);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('says "Sorted by Priority" and keeps the full default rule behind a keyboard-reachable info button', async () => {
    await create();
    const note = el().querySelector('[data-sort-note]')!;
    expect(note.textContent).toContain('Sorted by Priority');
    expect(note.textContent).not.toContain('Default order');
    expect(el().querySelector('[data-sort-rule]')).toBeNull();

    const info = note.querySelector<HTMLButtonElement>('.vc-info')!;
    expect(info.getAttribute('aria-label')).toBe('How the default order works');
    expect(info.getAttribute('aria-expanded')).toBe('false');
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

  it('shows the sorted column and direction for a header sort and offers the way back', async () => {
    await create({ sort: 'due', dir: 'desc' });
    const note = el().querySelector('[data-sort-note]')!;
    expect(note.textContent).toContain('Sorted by Due date');
    expect(note.textContent).toContain('(descending)');
    expect(note.querySelector('.vc-info')).toBeNull();
    let reset = 0;
    fixture.componentInstance.resetSort.subscribe(() => reset++);
    note.querySelector<HTMLButtonElement>('button')!.click();
    expect(reset).toBe(1);
  });

  it('changes columns and density through the column chooser, never offering to hide Ref or Title', async () => {
    await create();
    el().querySelector<HTMLButtonElement>('.cc-button')!.click();
    fixture.detectChanges();

    const checks = Array.from(el().querySelectorAll<HTMLLabelElement>('.cc-check'));
    const find = (label: string) =>
      checks.find((c) => c.textContent?.includes(label))!.querySelector('input')!;
    expect(find('Ref').disabled).toBe(true);
    expect(find('Title').disabled).toBe(true);
    expect(find('Ref').checked).toBe(true);

    const columns: string[][] = [];
    const densities: string[] = [];
    fixture.componentInstance.columnsChange.subscribe((c) => columns.push(c));
    fixture.componentInstance.densityChange.subscribe((d) => densities.push(d));
    find('Client').click();
    find('Compact').click();
    expect(columns[0]).toEqual(['ref', 'title', 'client', 'status']);
    expect(densities).toEqual(['compact']);
  });
});
