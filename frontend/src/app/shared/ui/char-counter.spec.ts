import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CharCounter } from './char-counter';

describe('CharCounter', () => {
  let fixture: ComponentFixture<CharCounter>;
  const text = (selector: string): string =>
    fixture.nativeElement.querySelector(selector).textContent.trim();

  function show(value: string, max: number, announceFrom: number | null = null): void {
    fixture = TestBed.createComponent(CharCounter);
    fixture.componentRef.setInput('countId', 'x-count');
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('max', max);
    fixture.componentRef.setInput('announceFrom', announceFrom);
    fixture.detectChanges();
  }

  it('shows "n / max" as text with the id the field points at', () => {
    show('abc', 100);
    expect(text('[data-char-count]')).toBe('3 / 100');
    expect(fixture.nativeElement.querySelector('#x-count')).not.toBeNull();
  });

  it('stays quiet below nine tenths of the limit and announces politely from 90 of 100', () => {
    show('a'.repeat(89), 100);
    expect(text('[data-char-count-live]')).toBe('');
    show('a'.repeat(90), 100);
    expect(text('[data-char-count-live]')).toBe('90 of 100 characters');
    expect(fixture.nativeElement.querySelector('[data-char-count-live]').getAttribute('role')).toBe(
      'status',
    );
  });

  it('announces a description from 900 of 1000 and honours an explicit start', () => {
    show('a'.repeat(899), 1000);
    expect(text('[data-char-count-live]')).toBe('');
    show('a'.repeat(900), 1000);
    expect(text('[data-char-count-live]')).toBe('900 of 1000 characters');
    show('a'.repeat(5), 1000, 5);
    expect(text('[data-char-count-live]')).toBe('5 of 1000 characters');
  });
});
