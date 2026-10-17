import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { Permission } from '../../core/auth/permissions';
import { KeyboardShortcuts } from './keyboard-shortcuts';
import { GO_SEQUENCE_MS, ShortcutRegistry } from './shortcut-registry';

describe('KeyboardShortcuts (#181)', () => {
  let navigate: ReturnType<typeof vi.spyOn>;
  const press = (service: KeyboardShortcuts, key: string, target: EventTarget = document.body) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    return { consumed: service.handleGo(event), event };
  };

  async function create(permissions: Permission[] = ['Task.View', 'Pod.View']) {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideFakeMe(new FakeMeApi(withPermissions(...permissions)))],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return TestBed.inject(KeyboardShortcuts);
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('g then m, t and p go to My Work, Task Queue and Pod Work', async () => {
    const service = await create();
    for (const [second, path] of [
      ['m', '/my-work'],
      ['t', '/tasks'],
      ['p', '/pods/work'],
    ]) {
      expect(press(service, 'g').consumed).toBe(true);
      expect(service.sequencePending()).toBe(true);
      expect(press(service, second).consumed).toBe(true);
      expect(navigate).toHaveBeenLastCalledWith([path]);
      expect(service.sequencePending()).toBe(false);
    }
  });

  it('forgets the g after 1.5 s', async () => {
    const service = await create();
    press(service, 'g');
    vi.advanceTimersByTime(GO_SEQUENCE_MS - 1);
    expect(service.sequencePending()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(service.sequencePending()).toBe(false);
    expect(press(service, 'm').consumed).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('inside the time, another key cancels the sequence and is left alone', async () => {
    const service = await create();
    press(service, 'g');
    expect(press(service, 'x').consumed).toBe(false);
    expect(service.sequencePending()).toBe(false);
    expect(press(service, 'm').consumed).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not start in a text field, a select or a dialog', async () => {
    const service = await create();
    const input = document.body.appendChild(document.createElement('input'));
    expect(press(service, 'g', input).consumed).toBe(false);
    const select = document.body.appendChild(document.createElement('select'));
    expect(press(service, 'g', select).consumed).toBe(false);
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.className = 'p-dialog';
    expect(press(service, 'g').consumed).toBe(false);
    expect(service.sequencePending()).toBe(false);
  });

  it('ignores a g with Ctrl, Alt or Meta', async () => {
    const service = await create();
    const event = new KeyboardEvent('keydown', { key: 'g', ctrlKey: true });
    expect(service.handleGo(event)).toBe(false);
  });

  it('Pod Work needs Pod.View: g p does nothing without it, and is not listed', async () => {
    const service = await create(['Task.View']);
    service.listGoShortcuts();
    TestBed.tick();
    press(service, 'g');
    expect(press(service, 'p').consumed).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    const registry = TestBed.inject(ShortcutRegistry);
    const ids = registry.all().map((s) => s.id);
    expect(ids).toContain('go-my-work');
    expect(ids).not.toContain('go-pod-work');
  });

  it('the switch turns every sequence off, is remembered per user and starts on', async () => {
    const service = await create();
    expect(service.enabled()).toBe(true);
    service.setEnabled(false);
    expect(service.enabled()).toBe(false);
    expect(localStorage.getItem('mf.keyboard-shortcuts.v1.1')).toBe('0');
    expect(press(service, 'g').consumed).toBe(false);
    expect(service.sequencePending()).toBe(false);
    service.setEnabled(true);
    expect(service.enabled()).toBe(true);
    expect(press(service, 'g').consumed).toBe(true);
  });

  it('switching off in the middle of a sequence drops it', async () => {
    const service = await create();
    press(service, 'g');
    service.setEnabled(false);
    expect(service.sequencePending()).toBe(false);
  });

  it('reads an earlier choice back for the same user only', async () => {
    localStorage.setItem('mf.keyboard-shortcuts.v1.1', '0');
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideFakeMe(new FakeMeApi(withPermissions('Task.View')))],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    expect(TestBed.inject(KeyboardShortcuts).enabled()).toBe(false);
  });
});
