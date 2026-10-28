import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PickerOption } from './entity-picker';
import { SearchSelect } from './search-select';

describe('mf-search-select (issue #928)', () => {
  let fixture: ComponentFixture<SearchSelect>;
  const el = (): HTMLElement => fixture.nativeElement;
  const input = (): HTMLInputElement => el().querySelector('input')!;
  const acme: PickerOption = { id: 1, label: '00343 Acme Corp' };
  const beta: PickerOption = { id: 2, label: '00001 Beta LLC' };
  const gamma: PickerOption = { id: 3, label: '00200 Gamma Ltd' };

  const labels = (): string[] =>
    Array.from(el().querySelectorAll('[role=option]')).map((o) => o.textContent!.trim());
  const key = (k: string): void => {
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  };
  async function type(value: string): Promise<void> {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 5));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function make(options: PickerOption[] | null, search?: ReturnType<typeof vi.fn>) {
    fixture = TestBed.createComponent(SearchSelect);
    fixture.componentRef.setInput('label', 'Client');
    fixture.componentRef.setInput('inputId', 'sel');
    fixture.componentRef.setInput('allLabel', 'All clients');
    fixture.componentRef.setInput('options', options);
    if (search) fixture.componentRef.setInput('search', search);
    fixture.componentRef.setInput('debounceMs', 0);
    await fixture.whenStable();
  }

  it('says "All clients" while nothing is chosen and lists every option when it is opened', async () => {
    await make([acme, beta, gamma]);
    expect(input().value).toBe('All clients');
    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-expanded')).toBe('false');

    input().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(el().querySelector('[role=listbox]')).not.toBeNull();
    expect(labels()).toEqual(['All clients', acme.label, beta.label, gamma.label]);
    expect(el().querySelector('[role=option][aria-selected=true]')!.textContent).toContain(
      'All clients',
    );
  });

  it('narrows the list as the person types and reports the number of matches', async () => {
    await make([acme, beta, gamma]);
    input().dispatchEvent(new Event('focus'));
    await type('ltd');
    expect(labels()).toEqual([gamma.label]);
    expect(el().querySelector('[role=status]')!.textContent).toContain('1 match');
    await type('zzz');
    expect(el().querySelector('[role=listbox]')).toBeNull();
    expect(el().querySelector('[data-search-note]')!.textContent).toContain('No matches');
  });

  it('chooses with the keyboard: arrows move, Enter chooses, and the box then shows the choice', async () => {
    await make([acme, beta, gamma]);
    input().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    key('ArrowDown'); // from "All clients" to the first client
    key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe('sel-opt-2');
    key('Enter');
    expect(fixture.componentInstance.selected()).toEqual(beta);
    expect(input().value).toBe(beta.label);
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes with Escape and changes nothing; typed text is dropped', async () => {
    await make([acme, beta]);
    fixture.componentInstance.selected.set(acme);
    input().dispatchEvent(new Event('focus'));
    await type('bet');
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input().dispatchEvent(esc);
    fixture.detectChanges();
    expect(esc.defaultPrevented).toBe(true);
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().value).toBe(acme.label);
    expect(fixture.componentInstance.selected()).toEqual(acme);
  });

  it('chooses "All clients" to clear the filter', async () => {
    await make([acme, beta]);
    fixture.componentInstance.selected.set(acme);
    input().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(el().querySelector('[role=option][aria-selected=true]')!.textContent).toContain(
      acme.label,
    );
    el()
      .querySelector('[data-option=all]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toBeNull();
    expect(input().value).toBe('All clients');
  });

  it('asks for the options when the list is not given: the first ones on open, the matches as the person types', async () => {
    const search = vi.fn().mockImplementation(async (q: string) => (q ? [beta] : [acme, beta]));
    await make(null, search);
    input().dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 5));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(search).toHaveBeenCalledWith('');
    expect(labels()).toEqual(['All clients', acme.label, beta.label]);
    await type('beta');
    expect(search).toHaveBeenCalledWith('beta');
    expect(labels()).toEqual([beta.label]);
  });
});
