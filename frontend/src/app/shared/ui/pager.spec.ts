import { TestBed } from '@angular/core/testing';
import { Pager } from './pager';

describe('Pager', () => {
  function create(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(Pager);
    fixture.componentRef.setInput('page', 1);
    fixture.componentRef.setInput('pageSize', 25);
    fixture.componentRef.setInput('total', 60);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the range and has no page size selector unless sizes are offered', () => {
    const fixture = create({});
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-range]')!.textContent).toBe('Showing 1-25 of 60');
    expect(el.querySelector('select')).toBeNull();
  });

  it('offers "Rows per page" and reports the chosen size', () => {
    const fixture = create({ pageSizes: [25, 50, 100], pageSize: 50 });
    const el: HTMLElement = fixture.nativeElement;
    const select = el.querySelector<HTMLSelectElement>('.mf-pager__size select')!;
    expect(el.querySelector('.mf-pager__size')!.textContent).toContain('Rows per page');
    expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual([
      '25',
      '50',
      '100',
    ]);
    expect(select.value).toBe('50');

    const sizes: number[] = [];
    fixture.componentInstance.pageSizeChange.subscribe((n) => sizes.push(n));
    select.value = '100';
    select.dispatchEvent(new Event('change'));
    expect(sizes).toEqual([100]);
  });

  it('disables Previous on the first page and Next on the last', () => {
    const fixture = create({ page: 1, pageSize: 50, total: 60 });
    const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'));
    expect(buttons.map((b) => b.disabled)).toEqual([true, false]);
    fixture.componentRef.setInput('page', 2);
    fixture.detectChanges();
    expect(buttons.map((b) => b.disabled)).toEqual([false, true]);
  });
});
