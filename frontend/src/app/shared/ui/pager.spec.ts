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
    expect(buttons.map((b) => b.disabled)).toEqual([true, true, false, false]);
    fixture.componentRef.setInput('page', 2);
    fixture.detectChanges();
    expect(buttons.map((b) => b.disabled)).toEqual([false, false, true, true]);
  });

  it('says "Page n of m" and First and Last go to page 1 and the last page (ceil(total / size))', () => {
    const fixture = create({ page: 3, pageSize: 50, total: 442 });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-page]')!.textContent).toBe('Page 3 of 9');
    expect(el.querySelector('[data-range]')!.textContent).toBe('Showing 101-150 of 442');
    const pages: number[] = [];
    fixture.componentInstance.pageChange.subscribe((n) => pages.push(n));
    const by = (name: string) =>
      Array.from<HTMLButtonElement>(el.querySelectorAll('button')).find(
        (b) => b.textContent!.trim() === name,
      )!;
    by('Last').click();
    by('First').click();
    by('Previous').click();
    by('Next').click();
    expect(pages).toEqual([9, 1, 2, 4]);
  });

  it('shows the last page of 442 rows at 50 per page as "Page 9 of 9", 401-442', () => {
    const fixture = create({ page: 9, pageSize: 50, total: 442 });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-page]')!.textContent).toBe('Page 9 of 9');
    expect(el.querySelector('[data-range]')!.textContent).toBe('Showing 401-442 of 442');
  });

  it('has one page for no rows and can drop First and Last', () => {
    const fixture = create({ page: 1, total: 0, edges: false });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-page]')!.textContent).toBe('Page 1 of 1');
    expect(el.querySelectorAll('button')).toHaveLength(2);
  });
});

describe('Pager layout groups (#280)', () => {
  it('keeps the controls in one group so they wrap together', () => {
    const fixture = TestBed.createComponent(Pager);
    fixture.componentRef.setInput('page', 1);
    fixture.componentRef.setInput('pageSize', 25);
    fixture.componentRef.setInput('total', 60);
    fixture.componentRef.setInput('pageSizes', [25, 50]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const nav = el.querySelector('.mf-pager__nav')!;
    expect(nav.querySelector('select')).toBeNull();
    expect(nav.querySelector('[data-range]')).toBeNull();
    expect(nav.querySelector('[data-page]')).not.toBeNull();
    expect(nav.querySelectorAll('button').length).toBe(4);
  });
});
