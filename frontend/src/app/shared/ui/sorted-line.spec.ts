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
  labels = { clientNumber: 'Client Number', name: 'Name', openTasks: 'Open tasks' };
  resets = 0;
}

describe('sorted line', () => {
  it('words a sort', () => {
    expect(sortSentence('name', 'desc', { name: 'Name' })).toBe('Sorted by Name, Z to A');
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
