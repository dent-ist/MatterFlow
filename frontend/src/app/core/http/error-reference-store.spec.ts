import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorReferenceStore } from './error-reference-store';

function mount(html: string): HTMLElement {
  const host = TestBed.inject(DOCUMENT).createElement('div');
  host.innerHTML = html;
  TestBed.inject(DOCUMENT).body.appendChild(host);
  return host;
}

describe('ErrorReferenceStore.inlineErrorShown', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(DOCUMENT).body.innerHTML = '';
  });

  it('is false on a page with no failure block', () => {
    mount('<p>Clients</p><div data-state-block="empty">No clients yet.</div>');
    expect(TestBed.inject(ErrorReferenceStore).inlineErrorShown()).toBe(false);
  });

  it.each([
    ['a load fault', '<div data-state-block="error" role="alert">Couldn\'t load clients.</div>'],
    ['a refresh fault', '<div role="alert">Couldn’t refresh the summary.</div>'],
    [
      'the no-access block of a list (403)',
      '<div data-state-block="empty" role="alert">You don\'t have access to clients.</div>',
    ],
    [
      'a no-access block that is not announced',
      '<div data-state-block="empty">You don’t have access to tasks.</div>',
    ],
    ['a no-access note', '<p data-no-access="tasks">You don\'t have access to tasks.</p>'],
  ])('recognises %s', (_name, html) => {
    mount(html);
    expect(TestBed.inject(ErrorReferenceStore).inlineErrorShown()).toBe(true);
  });

  it('drops the held toast of a forbidden list when the no-access block is on the page', () => {
    vi.useFakeTimers();
    mount(
      '<div data-forbidden><div data-state-block="empty" role="alert">You don\'t have access to clients.</div></div>',
    );
    const toast = vi.fn();
    TestBed.inject(ErrorReferenceStore).report('00-ref', toast);
    vi.advanceTimersByTime(1000);
    expect(toast).not.toHaveBeenCalled();
  });

  it('still shows the toast when no block is on the page', () => {
    vi.useFakeTimers();
    const toast = vi.fn();
    TestBed.inject(ErrorReferenceStore).report('00-ref', toast);
    vi.advanceTimersByTime(1000);
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
