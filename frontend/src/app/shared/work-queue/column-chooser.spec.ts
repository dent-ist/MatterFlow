import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ColumnChooser } from './column-chooser';

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
});
