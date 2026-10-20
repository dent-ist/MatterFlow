import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService, TOAST_DEDUPE_MS } from './notification.service';

describe('NotificationService (BUG-4 de-duplication, #616 list)', () => {
  let notify: NotificationService;
  const summaries = () => notify.toasts().map((t) => t.summary);

  beforeEach(() => {
    vi.useFakeTimers();
    notify = TestBed.inject(NotificationService);
  });
  afterEach(() => vi.useRealTimers());

  it('folds a burst of the same error into one toast with a count', () => {
    for (let i = 0; i < 3; i++) notify.error('You do not have permission', 'Ask an admin.');
    expect(notify.toasts().length).toBe(1);
    expect(notify.toasts()[0].count).toBe(3);
  });

  it('still stacks different messages', () => {
    notify.error('One');
    notify.error('Two');
    notify.success('One');
    notify.error('One', 'with detail');
    expect(notify.toasts().length).toBe(4);
  });

  it('keeps the durations: 4 s for success and info, 8 s for warnings and errors', () => {
    notify.success('s');
    notify.info('i');
    notify.warn('w');
    notify.error('e');
    expect(notify.toasts().map((t) => t.life)).toEqual([4000, 4000, 8000, 8000]);
    vi.advanceTimersByTime(4001);
    expect(summaries()).toEqual(['w', 'e']);
    vi.advanceTimersByTime(4000);
    expect(summaries()).toEqual([]);
  });

  it('drops an identical message less than five seconds after it was shown, even after it closed', () => {
    notify.success('Saved');
    vi.advanceTimersByTime(4001);
    expect(notify.toasts().length).toBe(0);
    notify.success('Saved');
    expect(notify.toasts().length).toBe(0);
  });

  it('shows an identical message again after five seconds', () => {
    notify.success('Saved');
    vi.advanceTimersByTime(TOAST_DEDUPE_MS + 1);
    notify.success('Saved');
    expect(summaries()).toEqual(['Saved']);
  });

  it('an identical message while the toast shows restarts its time', () => {
    notify.error('Down');
    vi.advanceTimersByTime(6000);
    notify.error('Down');
    vi.advanceTimersByTime(6000);
    expect(notify.toasts().length).toBe(1);
    vi.advanceTimersByTime(2001);
    expect(notify.toasts().length).toBe(0);
  });

  it('a toast with the same key replaces the previous one and keeps the others', () => {
    notify.error('Other');
    notify.success('You are out of office', undefined, { key: 'availability' });
    notify.success('Welcome back', undefined, { key: 'availability' });
    expect(summaries()).toEqual(['Other', 'Welcome back']);
  });

  it('hold keeps the toasts and release starts the full time again', () => {
    notify.success('Saved');
    notify.hold();
    vi.advanceTimersByTime(60000);
    expect(summaries()).toEqual(['Saved']);
    notify.release();
    vi.advanceTimersByTime(3999);
    expect(summaries()).toEqual(['Saved']);
    vi.advanceTimersByTime(2);
    expect(summaries()).toEqual([]);
  });

  it('dismiss removes one toast', () => {
    notify.error('A');
    notify.error('B');
    notify.dismiss(notify.toasts()[0].id);
    expect(summaries()).toEqual(['B']);
  });
});
