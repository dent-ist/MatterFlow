import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ColumnSelectFilter,
  ColumnTextFilter,
  FiltersToggle,
  readFlag,
  writeFlag,
} from './column-filters';
import { SEARCH_DEBOUNCE_MS } from './search-box';

describe('column filters', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('text filter', () => {
    let fixture: ComponentFixture<ColumnTextFilter>;
    let emitted: string[];
    const el = (): HTMLElement => fixture.nativeElement;
    const box = () => el().querySelector<HTMLInputElement>('input')!;
    const type = (text: string) => {
      box().value = text;
      box().dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    beforeEach(() => {
      vi.useFakeTimers();
      fixture = TestBed.createComponent(ColumnTextFilter);
      fixture.componentRef.setInput('label', 'Name');
      emitted = [];
      fixture.componentInstance.valueChange.subscribe((t) => emitted.push(t));
      fixture.detectChanges();
    });

    it('is named for its column', () => {
      expect(box().getAttribute('aria-label')).toBe('Filter by Name');
      expect(box().classList).toContain('mf-control--compact');
    });

    it('filters 300 ms after the last key press, once, with the trimmed text, even for one letter', () => {
      type('a');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50);
      type(' ac ');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      expect(emitted).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(emitted).toEqual(['ac']);
    });

    it('applies at once on Enter and does not repeat the same text', () => {
      type('merger');
      box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(emitted).toEqual(['merger']);
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      expect(emitted).toEqual(['merger']);
    });

    it('has a clear button only while there is text, which empties the filter', () => {
      expect(el().querySelector('.cf__clear')).toBeNull();
      type('x');
      const clear = el().querySelector<HTMLButtonElement>('.cf__clear')!;
      expect(clear.getAttribute('aria-label')).toBe('Clear Name filter');
      clear.click();
      fixture.detectChanges();
      expect(emitted).toEqual([]); // nothing was committed yet, so there is nothing to clear
      expect(box().value).toBe('');

      fixture.componentRef.setInput('value', 'acme');
      fixture.detectChanges();
      expect(box().value).toBe('acme');
      el().querySelector<HTMLButtonElement>('.cf__clear')!.click();
      expect(emitted).toEqual(['']);
    });

    it('follows a change of the committed value from outside (Clear filters, Back)', () => {
      fixture.componentRef.setInput('value', 'old');
      fixture.detectChanges();
      expect(box().value).toBe('old');
      fixture.componentRef.setInput('value', '');
      fixture.detectChanges();
      expect(box().value).toBe('');
    });

    it('Escape clears a filled box and keeps the event from the page; an empty box lets it through', () => {
      fixture.componentRef.setInput('value', 'acme');
      fixture.detectChanges();
      const filled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      const stop = vi.spyOn(filled, 'stopPropagation');
      box().dispatchEvent(filled);
      expect(stop).toHaveBeenCalled();
      expect(emitted).toEqual(['']);

      const empty = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      const stopEmpty = vi.spyOn(empty, 'stopPropagation');
      box().dispatchEvent(empty);
      expect(stopEmpty).not.toHaveBeenCalled();
    });

    it('drops a pending filter when it is destroyed', () => {
      type('late');
      fixture.destroy();
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      expect(emitted).toEqual([]);
    });
  });

  describe('select filter', () => {
    it('is named for its column, shows the current value and emits the chosen one', () => {
      const fixture = TestBed.createComponent(ColumnSelectFilter);
      fixture.componentRef.setInput('label', 'Status');
      fixture.componentRef.setInput('options', [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
        { value: 'all', label: 'All' },
      ]);
      fixture.componentRef.setInput('value', 'inactive');
      const emitted: string[] = [];
      fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
      fixture.detectChanges();

      const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
      expect(select.getAttribute('aria-label')).toBe('Filter by Status');
      expect(select.value).toBe('inactive');
      select.value = 'all';
      select.dispatchEvent(new Event('change'));
      expect(emitted).toEqual(['all']);
    });
  });

  describe('Filters toggle', () => {
    it('is a pressed / expanded toggle with the number of active filters', () => {
      const fixture = TestBed.createComponent(FiltersToggle);
      fixture.componentRef.setInput('controls', 'row');
      const toggled = vi.fn();
      fixture.componentInstance.toggled.subscribe(toggled);
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

      expect(button.textContent).toContain('Filters');
      expect(button.querySelector('.pi-filter')).not.toBeNull();
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.title).toBe('Show filters');
      expect(fixture.nativeElement.querySelector('[data-filter-count]')).toBeNull();

      fixture.componentRef.setInput('open', true);
      fixture.componentRef.setInput('count', 2);
      fixture.detectChanges();
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(button.getAttribute('aria-controls')).toBe('row');
      expect(button.title).toBe('Hide filters');
      expect(fixture.nativeElement.querySelector('[data-filter-count]')?.textContent).toBe('(2)');
      button.click();
      expect(toggled).toHaveBeenCalledOnce();
    });
  });

  describe('remembered flag', () => {
    beforeEach(() => localStorage.clear());

    it('reads what was written and falls back when nothing was', () => {
      expect(readFlag('k')).toBe(false);
      expect(readFlag('k', true)).toBe(true);
      writeFlag('k', true);
      expect(readFlag('k')).toBe(true);
      writeFlag('k', false);
      expect(readFlag('k', true)).toBe(false);
    });

    it('survives storage that throws (private window, blocked site data)', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(readFlag('k')).toBe(false);
      expect(() => writeFlag('k', true)).not.toThrow();
    });
  });
});
