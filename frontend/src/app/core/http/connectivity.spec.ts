import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACK_ONLINE_MS,
  Connectivity,
  OFFLINE_AFTER_FAILURES,
  PROBE_EVERY_MS,
  retryWhenBackOnline,
} from './connectivity';

function setOnline(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

describe('Connectivity (#611)', () => {
  let c: Connectivity;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    c = TestBed.inject(Connectivity);
    TestBed.tick();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is online at first', () => {
    expect(c.offline()).toBe(false);
    expect(c.backOnline()).toBe(false);
  });

  it('the browser going offline turns it offline at once, and coming back counts one recovery and says "Back online." for a few seconds', () => {
    setOnline(false);
    TestBed.tick();
    expect(c.offline()).toBe(true);
    setOnline(true);
    TestBed.tick();
    expect(c.offline()).toBe(false);
    expect(c.recoveries()).toBe(1);
    expect(c.backOnline()).toBe(true);
    vi.advanceTimersByTime(BACK_ONLINE_MS + 1);
    expect(c.backOnline()).toBe(false);
  });

  it('one failed request is not enough; two in a row are, and an answer from the server resets the count', () => {
    c.unreachable();
    TestBed.tick();
    expect(c.offline()).toBe(false);
    c.reachable();
    c.unreachable();
    TestBed.tick();
    expect(c.offline()).toBe(false);
    for (let i = 1; i < OFFLINE_AFTER_FAILURES; i++) c.unreachable();
    TestBed.tick();
    expect(c.offline()).toBe(true);
    c.reachable();
    TestBed.tick();
    expect(c.offline()).toBe(false);
    expect(c.recoveries()).toBe(1);
  });

  it('while offline the server is asked every 15 seconds, and an answer ends the offline state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    c.unreachable();
    c.unreachable();
    TestBed.tick();
    expect(c.offline()).toBe(true);
    await vi.advanceTimersByTimeAsync(PROBE_EVERY_MS + 10);
    TestBed.tick();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/health\/live$/), {
      cache: 'no-store',
    });
    expect(c.offline()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('a check that cannot reach the server leaves the banner up and reports it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    c.unreachable();
    c.unreachable();
    TestBed.tick();
    expect(await c.check()).toBe(false);
    expect(c.offline()).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('retryWhenBackOnline (#611)', () => {
  @Component({
    selector: 'mf-retry-host',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  class Host {
    readonly failed = signal(true);
    readonly retried = vi.fn();
    protected readonly auto = retryWhenBackOnline(
      () => this.failed(),
      () => this.retried(),
    );
  }

  beforeEach(() => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  it('retries once when the connection returns, only while the screen shows its failure', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const c = TestBed.inject(Connectivity);
    setOnline(false);
    fixture.detectChanges();
    setOnline(true);
    fixture.detectChanges();
    expect(c.recoveries()).toBe(1);
    expect(fixture.componentInstance.retried).toHaveBeenCalledTimes(1);

    // A screen that loaded fine is left alone.
    fixture.componentInstance.failed.set(false);
    setOnline(false);
    fixture.detectChanges();
    setOnline(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.retried).toHaveBeenCalledTimes(1);
  });
});
