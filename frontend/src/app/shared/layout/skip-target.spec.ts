import { TestBed } from '@angular/core/testing';
import { DEFAULT_SKIP_ID, SkipTarget, skipId } from './skip-target';

describe('SkipTarget (#586)', () => {
  it('defaults the id to mf-list and lets a page name its own', () => {
    expect(skipId({ label: 'x', focus: () => undefined })).toBe(DEFAULT_SKIP_ID);
    expect(skipId({ label: 'x', id: 'results', focus: () => undefined })).toBe('results');
  });

  it('gives the element its id and tabindex while current, and takes both back on release', () => {
    const skip = TestBed.inject(SkipTarget);
    const el = document.createElement('div');
    const off = skip.register({ label: 'Skip to table', element: el, focus: () => undefined });
    expect(el.id).toBe('mf-list');
    expect(el.getAttribute('tabindex')).toBe('-1');
    expect(skip.target()?.label).toBe('Skip to table');
    off();
    expect(el.hasAttribute('id')).toBe(false);
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(skip.target()).toBeNull();
  });

  it('hands the id to the newest registrant so the document never holds two', () => {
    const skip = TestBed.inject(SkipTarget);
    const a = document.createElement('div');
    const b = document.createElement('div');
    const offA = skip.register({ label: 'A', element: a, focus: () => undefined });
    const offB = skip.register({ label: 'B', element: b, focus: () => undefined });
    expect(a.hasAttribute('id')).toBe(false);
    expect(b.id).toBe('mf-list');
    offA();
    expect(skip.target()?.label).toBe('B');
    expect(b.id).toBe('mf-list');
    offB();
  });

  it('gives an element its own id back on release', () => {
    const skip = TestBed.inject(SkipTarget);
    const el = document.createElement('div');
    el.id = 'root0';
    const off = skip.register({ label: 'x', element: el, focus: () => undefined });
    expect(el.id).toBe('mf-list');
    off();
    expect(el.id).toBe('root0');
  });
});
