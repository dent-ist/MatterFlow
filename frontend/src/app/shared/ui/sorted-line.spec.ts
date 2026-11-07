import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SortedLine, sortSentence } from './sorted-line';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SortedLine],
  template: `
    <mf-sorted-line
      [sort]="sort()"
      defaultSort="clientNumber"
      [labels]="labels"
      (resetSort)="resets = resets + 1"
    />
  `,
})
class Host {
  sort = signal<string | null>(null);
  labels = { clientNumber: 'Client Number', name: 'Name', openTasks: 'Open Tasks' };
  resets = 0;
}

describe('sorted line', () => {
  it('words a sort', () => {
    expect(sortSentence('name', 'desc', { name: 'Name' })).toBe('Sorted by Name, Z to A');
  });

  it('words a sort by the kind of its column when the list says it (#1289)', () => {
    const labels = { c0: 'Open Tasks', c1: 'Opened', c2: 'Active', c3: 'Matter' };
    const kinds = { c0: 'number', c1: 'date', c2: 'yesno', c3: 'text' } as const;
    expect(sortSentence('c0', 'asc', labels, kinds)).toBe('Sorted by Open Tasks, lowest first');
    expect(sortSentence('c0', 'desc', labels, kinds)).toBe('Sorted by Open Tasks, highest first');
    expect(sortSentence('c1', 'desc', labels, kinds)).toBe('Sorted by Opened, newest first');
    expect(sortSentence('c1', 'asc', labels, kinds)).toBe('Sorted by Opened, oldest first');
    expect(sortSentence('c2', 'asc', labels, kinds)).toBe('Sorted by Active, no first');
    expect(sortSentence('c2', 'desc', labels, kinds)).toBe('Sorted by Active, yes first');
    expect(sortSentence('c3', 'asc', labels, kinds)).toBe('Sorted by Matter, A to Z');
    // a field the kinds do not name keeps the work-list reading
    expect(sortSentence('name', 'asc', { name: 'Name' }, kinds)).toBe('Sorted by Name, A to Z');
  });

  it('states the default sort and offers no reset', async () => {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Sorted by Client Number');
    expect(el.querySelector('[data-sorted-text]')?.getAttribute('title')).toBe(
      'Sorted by Client Number, lowest first',
    );
    expect(el.querySelector('[data-reset-sort]')).toBeNull();
  });

  it('names the chosen column and direction and resets', async () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.sort.set('-name');
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-sorted-text]')?.textContent).toBe('Sorted by Name');
    expect(el.querySelector('[data-sorted-text]')?.getAttribute('title')).toBe(
      'Sorted by Name, Z to A',
    );
    el.querySelector<HTMLButtonElement>('[data-reset-sort]')!.click();
    expect(f.componentInstance.resets).toBe(1);
  });
});
