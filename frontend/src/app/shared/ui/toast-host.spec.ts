import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../core/notify/notification.service';
import { UndoService } from '../../core/notify/undo.service';
import { MAX_VISIBLE_TOASTS, ToastHost } from './toast-host';

describe('ToastHost (#616)', () => {
  let notify: NotificationService;
  let undo: UndoService;

  function setup() {
    const fixture = TestBed.createComponent(ToastHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el };
  }
  const flush = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    notify = TestBed.inject(NotificationService);
    undo = TestBed.inject(UndoService);
  });
  afterEach(() => vi.useRealTimers());

  it('announces success and info politely and warnings and errors assertively', async () => {
    const { fixture, el } = setup();
    notify.success('Saved');
    notify.info('FYI');
    notify.error('Failed');
    await flush(fixture);
    const polite = el.querySelector('[role="status"]')!;
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect([...polite.querySelectorAll('[data-toast-summary]')].map((n) => n.textContent)).toEqual([
      'Saved',
      'FYI',
    ]);
    const alerts = [...el.querySelectorAll('[role="alert"]')];
    expect(alerts.map((n) => n.querySelector('[data-toast-summary]')?.textContent)).toEqual([
      'Failed',
    ]);
    expect(polite.querySelector('[role="alert"]')).toBeNull();
  });

  it('announces a warning assertively too', async () => {
    const { fixture, el } = setup();
    notify.warn('Careful');
    await flush(fixture);
    expect(el.querySelector('[role="alert"] [data-toast-summary]')?.textContent).toBe('Careful');
  });

  it('folds five identical errors into one toast with x5', async () => {
    const { fixture, el } = setup();
    for (let i = 0; i < 5; i++) notify.error('Something went wrong. Try again.');
    await flush(fixture);
    expect(el.querySelectorAll('[data-toast]').length).toBe(1);
    expect(el.querySelector('[data-toast-count]')?.textContent).toBe('x5');
  });

  it('shows at most three toasts, the newest, and the older ones come back when those close', async () => {
    const { fixture, el } = setup();
    for (const n of ['a', 'b', 'c', 'd', 'e']) notify.success(n);
    await flush(fixture);
    const texts = () => [...el.querySelectorAll('[data-toast-summary]')].map((n) => n.textContent);
    expect(MAX_VISIBLE_TOASTS).toBe(3);
    expect(texts()).toEqual(['c', 'd', 'e']);
    const close = el.querySelector<HTMLButtonElement>('[data-toast-close]')!;
    close.click();
    await flush(fixture);
    expect(texts()).toEqual(['b', 'd', 'e']);
  });

  it('removes a toast after its time (4 s, errors 8 s) and holds the time while the pointer is on it', async () => {
    const { fixture, el } = setup();
    notify.success('Saved');
    notify.error('Failed');
    await flush(fixture);
    vi.advanceTimersByTime(4001);
    await flush(fixture);
    expect(el.querySelectorAll('[data-toast]').length).toBe(1);
    el.querySelector('.th')!.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(20000);
    await flush(fixture);
    expect(el.querySelectorAll('[data-toast]').length).toBe(1);
    el.querySelector('.th')!.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(8001);
    await flush(fixture);
    expect(el.querySelectorAll('[data-toast]').length).toBe(0);
  });

  it('shows the Undo offer inside the same host as a polite toast with an Undo button', async () => {
    const { fixture, el } = setup();
    const run = vi.fn(async () => undefined);
    undo.offer('Assigned to you.', run);
    await flush(fixture);
    const toast = el.querySelector('[role="status"] [data-undo-toast]')!;
    expect(toast.querySelector('[data-undo-message]')?.textContent).toBe('Assigned to you.');
    toast.querySelector<HTMLButtonElement>('[data-undo]')!.click();
    await flush(fixture);
    expect(run).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-undo-toast]')).toBeNull();
  });

  it('an Undo offer shows a summary and one more line, and the long explanation is the Undo button tooltip (#617)', async () => {
    const { fixture, el } = setup();
    undo.offer('Assigned to you.', async () => undefined, {
      detail: 'Task moved to In Progress.',
      hint: 'Undo puts the assignee back; the status stays.',
    });
    await flush(fixture);
    const toast = el.querySelector('[data-undo-toast]')!;
    expect(toast.querySelector('[data-undo-message]')?.textContent).toBe('Assigned to you.');
    expect(toast.querySelector('[data-toast-detail]')?.textContent).toBe(
      'Task moved to In Progress.',
    );
    expect(toast.querySelector('[data-undo]')!.getAttribute('title')).toBe(
      'Undo (Alt+Z): Undo puts the assignee back; the status stays.',
    );
  });

  it('keeps the Undo offer visible when many other toasts are showing', async () => {
    const { fixture, el } = setup();
    undo.offer('Assigned to you.', async () => undefined);
    for (const n of ['a', 'b', 'c', 'd']) notify.error(n);
    await flush(fixture);
    expect(el.querySelectorAll('[data-toast]').length).toBe(3);
    expect(el.querySelector('[data-undo-toast]')).not.toBeNull();
  });

  describe('Alt+Z', () => {
    beforeEach(() => vi.useRealTimers());
    const altZ = () =>
      new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', altKey: true, cancelable: true });

    it('runs the Undo with Alt+Z while an offer is showing, and names the shortcut on the button', async () => {
      const { fixture, el } = setup();
      const run = vi.fn(async () => undefined);
      undo.offer('TSK-1 assigned. ', run);
      fixture.detectChanges();
      expect(el.querySelector('[data-undo]')!.getAttribute('aria-keyshortcuts')).toBe('Alt+Z');

      const event = altZ();
      document.dispatchEvent(event);
      await fixture.whenStable();
      expect(event.defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
      expect(undo.current()).toBeNull();
    });

    it('does nothing without an offer, and counts a finished run so other screens can read their data again', async () => {
      setup();
      const event = altZ();
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);

      const before = undo.settled();
      undo.offer('x', async () => undefined);
      await undo.run();
      expect(undo.settled()).toBe(before + 1);
    });
  });
});
