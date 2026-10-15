import { TestBed } from '@angular/core/testing';
import { UndoService } from '../../core/notify/undo.service';
import { UndoToast } from './undo-toast';

describe('UndoToast keyboard shortcut', () => {
  function setup() {
    const fixture = TestBed.createComponent(UndoToast);
    fixture.detectChanges();
    return { fixture, undo: TestBed.inject(UndoService) };
  }
  const altZ = () =>
    new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', altKey: true, cancelable: true });

  it('runs the Undo with Alt+Z while an offer is showing, and names the shortcut on the button', async () => {
    const { fixture, undo } = setup();
    const run = vi.fn(async () => undefined);
    undo.offer('TSK-1 assigned. ', run);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('[data-undo]')!;
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Alt+Z');

    const event = altZ();
    document.dispatchEvent(event);
    await fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(undo.current()).toBeNull();
  });

  it('does nothing without an offer, and counts a finished run so other screens can read their data again', async () => {
    const { undo } = setup();
    const event = altZ();
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    const before = undo.settled();
    undo.offer('x', async () => undefined);
    await undo.run();
    expect(undo.settled()).toBe(before + 1);
  });
});
