import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SEARCH_DEBOUNCE_MS, SearchBox } from './search-box';

describe('SearchBox', () => {
  let fixture: ComponentFixture<SearchBox>;
  let emitted: string[];

  const el = (): HTMLElement => fixture.nativeElement;
  const box = () => el().querySelector<HTMLInputElement>('#sb')!;
  const type = (text: string) => {
    box().value = text;
    box().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(SearchBox);
    fixture.componentRef.setInput('inputId', 'sb');
    emitted = [];
    fixture.componentInstance.searchChange.subscribe((t) => emitted.push(t));
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('searches 300 ms after the last key press, once, with the trimmed text', () => {
    type('ac');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50);
    type(' acme ');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual(['acme']);
  });

  it('searches at once on Enter and does not repeat the same text', () => {
    type('343');
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(emitted).toEqual(['343']);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    expect(emitted).toEqual(['343']);
  });

  it('has a hint line that says it searches as you type', () => {
    expect(el().querySelector('[data-search-hint]')!.textContent).toContain('Searches as you type');
    expect(box().getAttribute('aria-describedby')).toBe('sb-hint');
  });

  it('does not search live on one letter, says why, and still searches it on Enter (UAT2-08)', () => {
    type('a');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    expect(emitted).toEqual([]);
    expect(el().querySelector('[data-search-hint]')!.textContent).toContain('one more character');
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(emitted).toEqual(['a']);
  });

  it('searches live on one digit, because numbers can be one digit long', () => {
    type('7');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(emitted).toEqual(['7']);
  });

  it('clears with the x button, which searches for nothing at once and refocuses nothing else', () => {
    type('acme');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    const clear = el().querySelector<HTMLButtonElement>('.sb__clear')!;
    expect(clear.getAttribute('aria-label')).toBe('Clear search');
    clear.click();
    fixture.detectChanges();
    expect(emitted).toEqual(['acme', '']);
    expect(box().value).toBe('');
    expect(el().querySelector('.sb__clear')).toBeNull();
  });

  it('follows the committed value when it changes from outside (Clear filters, back button)', () => {
    fixture.componentRef.setInput('value', 'zzz');
    fixture.detectChanges();
    expect(box().value).toBe('zzz');
    fixture.componentRef.setInput('value', '');
    fixture.detectChanges();
    expect(box().value).toBe('');
  });
});
