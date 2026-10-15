import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EntityPicker, PickerOption } from './entity-picker';

describe('mf-entity-picker', () => {
  let fixture: ComponentFixture<EntityPicker>;
  let search: ReturnType<typeof vi.fn>;
  const el = (): HTMLElement => fixture.nativeElement;
  const input = (): HTMLInputElement => el().querySelector('input')!;
  const acme: PickerOption = { id: 1, label: '00343 Acme Corp' };
  const beta: PickerOption = { id: 2, label: '00001 Beta LLC', inactive: true };

  async function type(value: string): Promise<void> {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 5));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    search = vi.fn().mockResolvedValue([acme, beta]);
    fixture = TestBed.createComponent(EntityPicker);
    fixture.componentRef.setInput('label', 'Client');
    fixture.componentRef.setInput('inputId', 'pick');
    fixture.componentRef.setInput('search', search);
    fixture.componentRef.setInput('debounceMs', 0);
    await fixture.whenStable();
  });

  it('searches as the user types and lists matches, marking inactive records', async () => {
    await type('343');

    expect(search).toHaveBeenCalledWith('343');
    const options = Array.from(el().querySelectorAll('[role=option]'));
    expect(options.map((o) => o.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      '00343 Acme Corp',
      '00001 Beta LLC Inactive',
    ]);
  });

  it('selects an option with the mouse and shows it with a Change action', async () => {
    await type('acme');
    el()
      .querySelector('[role=option]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.selected()).toEqual(acme);
    expect(el().querySelector('[data-chosen]')?.textContent).toContain('00343 Acme Corp');
    el().querySelector<HTMLButtonElement>('.mf-picker__change')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toBeNull();
    expect(el().querySelector('input')).not.toBeNull();
  });

  it('supports the keyboard: arrows move, Enter selects, Escape closes', async () => {
    await type('a');
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(input().getAttribute('aria-activedescendant')).toBe('pick-opt-1');

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(beta);
  });

  it('shows "No matches." and survives a failing search', async () => {
    search.mockResolvedValue([]);
    await type('zzz');
    expect(el().textContent).toContain('No matches.');

    search.mockRejectedValue(new Error('boom'));
    await type('zzzz');
    expect(el().textContent).toContain('No matches.');
  });

  it('hides Change when locked and shows a required error', async () => {
    fixture.componentRef.setInput('selected', acme);
    fixture.componentRef.setInput('locked', true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('.mf-picker__change')).toBeNull();

    fixture.componentRef.setInput('selected', null);
    fixture.componentRef.setInput('locked', false);
    fixture.componentRef.setInput('error', 'Select a client.');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[role=alert]')?.textContent).toContain('Select a client.');
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  describe('focus (UAT2-03)', () => {
    const later = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

    it('keeps keyboard focus in the picker after a keyboard pick: it lands on Change', async () => {
      document.body.appendChild(el());
      try {
        await type('a');
        input().focus();
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        fixture.detectChanges();
        await later();

        expect(fixture.componentInstance.selected()).toEqual(acme);
        expect(document.activeElement).toBe(el().querySelector('.mf-picker__change'));
      } finally {
        el().remove();
      }
    });

    it('returns focus to the search box after Change', async () => {
      document.body.appendChild(el());
      try {
        fixture.componentRef.setInput('selected', acme);
        fixture.detectChanges();
        el().querySelector<HTMLButtonElement>('.mf-picker__change')!.click();
        fixture.detectChanges();
        await later();

        expect(document.activeElement).toBe(input());
      } finally {
        el().remove();
      }
    });
  });
});
