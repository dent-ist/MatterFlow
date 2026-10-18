import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ColumnChooser } from './column-chooser';
import { WORK_COLUMNS } from './column-prefs';

describe('ColumnChooser', () => {
  let fixture: ComponentFixture<ColumnChooser>;
  const el = () => fixture.nativeElement as HTMLElement;
  const button = () => el().querySelector<HTMLButtonElement>('.cc-button')!;
  const panel = () => el().querySelector<HTMLElement>('[data-columns-panel]');

  async function create(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(ColumnChooser);
    fixture.componentRef.setInput('columns', ['ref', 'title', 'status']);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    button().click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('closes on Esc and gives the Columns button focus back', async () => {
    await create();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    el().querySelector<HTMLInputElement>('.cc-check input:not([disabled])')!.focus();
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(panel()).toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button());
  });

  it('closes on a press outside and on Done', async () => {
    await create();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(panel()).toBeNull();
    button().click();
    fixture.detectChanges();
    el().querySelector<HTMLButtonElement>('[data-columns-close]')!.click();
    fixture.detectChanges();
    expect(panel()).toBeNull();
  });

  it('keeps the list scrollable inside a capped panel with the buttons outside the scroll area', async () => {
    await create();
    const body = el().querySelector<HTMLElement>('[data-columns-scroll]')!;
    expect(getComputedStyle(body).overflowY).toBe('auto');
    expect(getComputedStyle(panel()!).maxHeight).not.toBe('none');
    expect(body.contains(el().querySelector('[data-columns-close]'))).toBe(false);
  });

  it('offers Reset columns only when it is given a default set, and applies it politely', async () => {
    await create();
    expect(el().querySelector('[data-columns-reset]')).toBeNull();
    fixture.destroy();

    await create({ defaults: ['ref', 'title', 'matter', 'status'] });
    const emitted: string[][] = [];
    fixture.componentInstance.columnsChange.subscribe((c) => emitted.push(c));
    const reset = el().querySelector<HTMLButtonElement>('[data-columns-reset]')!;
    expect(reset.disabled).toBe(false);
    reset.click();
    fixture.detectChanges();
    expect(emitted).toEqual([['ref', 'title', 'matter', 'status']]);
    expect(el().querySelector('[data-columns-live]')!.textContent).toContain('reset');

    fixture.componentRef.setInput('columns', ['ref', 'title', 'matter', 'status']);
    fixture.detectChanges();
    expect(el().querySelector<HTMLButtonElement>('[data-columns-reset]')!.disabled).toBe(true);
  });

  it('groups the list under Task, Where, Who, When and State and lists every column once', async () => {
    await create();
    const legends = Array.from(el().querySelectorAll('[data-columns-group] legend')).map((l) =>
      l.textContent?.trim(),
    );
    expect(legends).toEqual(['Task', 'Where', 'Who', 'When', 'State']);
    const labels = Array.from(el().querySelectorAll('[data-columns-group] .cc-check')).map((l) =>
      l.textContent?.replace('(always shown)', '').trim(),
    );
    expect(labels.length).toBe(WORK_COLUMNS.length);
    expect(new Set(labels).size).toBe(WORK_COLUMNS.length);
    expect(
      el().querySelectorAll('[data-columns-group] input[type=checkbox][disabled]').length,
    ).toBe(2);
  });

  it('shows Column widths and Reset all widths only for a grid whose widths can be edited', async () => {
    await create();
    expect(el().querySelector('[data-widths-set]')).toBeNull();
    expect(el().querySelector('[data-widths-reset]')).toBeNull();
    fixture.destroy();

    localStorage.clear();
    await create({ widthScope: 'taskQueue', widthUser: 3 });
    expect(el().querySelector('[data-widths-set]')).not.toBeNull();
    const all = el().querySelector<HTMLElement>('[data-widths-reset]')!;
    expect(all.getAttribute('aria-disabled')).toBe('true');
    el().querySelector<HTMLElement>('[data-width-row="status"] [data-width-plus]')!.click();
    fixture.detectChanges();
    expect(all.getAttribute('aria-disabled')).toBeNull();
    all.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(all.getAttribute('aria-disabled')).toBe('true');
    expect(el().querySelector('[data-columns-live]')!.textContent).toContain('widths reset');
    localStorage.clear();
  });
});
