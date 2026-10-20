import { TestBed } from '@angular/core/testing';
import { NavigationError } from '@angular/router';
import { MessageService } from 'primeng/api';
import { NotificationService } from '../../core/notify/notification.service';
import {
  destinationLabel,
  handleNavigationError,
  hardNavigation,
  isLoadFailure,
  resetNavigationErrorMemory,
} from './nav-error';

describe('navigation error handler (#590)', () => {
  const chunk = new TypeError('Failed to fetch dynamically imported module: http://x/chunk.js');
  let toasts: ReturnType<typeof vi.fn>;
  const run = (url: string, error: unknown) =>
    TestBed.runInInjectionContext(() => handleNavigationError(new NavigationError(1, url, error)));

  let online: ReturnType<typeof vi.spyOn>;
  let go: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetNavigationErrorMemory();
    online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    go = vi.spyOn(hardNavigation, 'go').mockImplementation(() => undefined);
    toasts = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: MessageService, useValue: { add: toasts } }, NotificationService],
    });
  });

  it('tells chunk and network errors from real route errors', () => {
    expect(isLoadFailure(chunk)).toBe(true);
    expect(isLoadFailure(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isLoadFailure({ status: 0 })).toBe(true);
    expect(isLoadFailure(new Error('Cannot match any routes'))).toBe(false);
    expect(isLoadFailure(undefined)).toBe(false);
  });

  it('names the destination by its rail label', () => {
    expect(destinationLabel('/tasks')).toBe('Task Queue');
    expect(destinationLabel('/pods/work?x=1')).toBe('Pod Work');
    expect(destinationLabel('/clients/5')).toBe('Clients');
    expect(destinationLabel('/nowhere')).toBe('that page');
  });

  it('shows one message for a load failure and holds back an identical repeat', () => {
    run('/tasks', chunk);
    run('/tasks', chunk);
    expect(toasts).toHaveBeenCalledTimes(1);
    expect(toasts.mock.calls[0][0].detail ?? toasts.mock.calls[0][0].summary).toBe(
      "Couldn't open Task Queue. Check your connection and try again.",
    );
    run('/clients', chunk);
    expect(toasts).toHaveBeenCalledTimes(2);
  });

  it('loads the address afresh once when the connection is back, then falls back to the message', () => {
    online.mockReturnValue(true);
    run('/tasks', chunk);
    expect(go).toHaveBeenCalledWith('/tasks');
    expect(toasts).not.toHaveBeenCalled();
    run('/tasks', chunk);
    expect(go).toHaveBeenCalledTimes(1);
    expect(toasts).toHaveBeenCalledTimes(1);
  });

  it('throws any other error again and shows nothing', () => {
    const bug = new Error('resolver blew up');
    expect(() => run('/tasks', bug)).toThrow(bug);
    expect(toasts).not.toHaveBeenCalled();
  });
});
