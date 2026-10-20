import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService, TOAST_DEDUPE_MS } from './notification.service';

describe('NotificationService de-duplication (BUG-4)', () => {
  let messages: { add: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  let notify: NotificationService;

  beforeEach(() => {
    vi.useFakeTimers();
    messages = { add: vi.fn(), clear: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: MessageService, useValue: messages }],
    });
    notify = TestBed.inject(NotificationService);
  });
  afterEach(() => vi.useRealTimers());

  it('shows a burst of the same error once', () => {
    for (let i = 0; i < 3; i++) notify.error('You do not have permission', 'Ask an admin.');
    expect(messages.add).toHaveBeenCalledTimes(1);
  });

  it('still stacks different messages', () => {
    notify.error('One');
    notify.error('Two');
    notify.success('One');
    notify.error('One', 'with detail');
    expect(messages.add).toHaveBeenCalledTimes(4);
  });

  it('drops an identical message less than five seconds after it was shown, even after it closed', () => {
    notify.success('Saved');
    vi.advanceTimersByTime(4000);
    notify.success('Saved');
    expect(messages.add).toHaveBeenCalledTimes(1);
  });

  it('shows an identical message again after five seconds', () => {
    notify.success('Saved');
    vi.advanceTimersByTime(TOAST_DEDUPE_MS + 1);
    notify.success('Saved');
    expect(messages.add).toHaveBeenCalledTimes(2);
  });

  it('keeps an identical error that is still on screen folded past five seconds', () => {
    notify.error('Down');
    vi.advanceTimersByTime(6000);
    notify.error('Down');
    expect(messages.add).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    notify.error('Down');
    expect(messages.add).toHaveBeenCalledTimes(2);
  });

  it('a toast with the same key replaces the previous one and keeps the others', () => {
    notify.error('Other');
    notify.success('You are out of office', undefined, { key: 'availability' });
    notify.success('Welcome back', undefined, { key: 'availability' });
    expect(messages.clear).toHaveBeenCalledTimes(1);
    const shown = messages.add.mock.calls.map((c) => (c[0] as { summary: string }).summary);
    // Other, out of office, then (after the clear) Other again and Welcome back.
    expect(shown.slice(2)).toEqual(['Other', 'Welcome back']);
  });
});
