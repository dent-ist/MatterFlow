import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StillLoading, STILL_LOADING_MS } from './still-loading';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StillLoading],
  template: `<mf-still-loading (retry)="retried = retried + 1" />`,
})
class Host {
  retried = 0;
}

/** S17 (#615): a skeleton that stays more than 8 seconds says "Still loading... Retry" once, in a polite live region. */
describe('StillLoading', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }
  const text = (f: ReturnType<typeof render>) =>
    (f.nativeElement as HTMLElement).querySelector('[data-still-loading]');

  it('is silent for the first 8 seconds, then says so in the polite region', () => {
    const f = render();
    const region = (f.nativeElement as HTMLElement).querySelector('[aria-live]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    vi.advanceTimersByTime(STILL_LOADING_MS - 1);
    f.detectChanges();
    expect(text(f)).toBeNull();
    vi.advanceTimersByTime(1);
    f.detectChanges();
    expect(text(f)!.textContent).toContain('Still loading...');
    expect(region.contains(text(f))).toBe(true);
  });

  it('Retry emits, hides the line and counts another 8 seconds', () => {
    const f = render();
    vi.advanceTimersByTime(STILL_LOADING_MS);
    f.detectChanges();
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-still-loading-retry]')!
      .click();
    f.detectChanges();
    expect(f.componentInstance.retried).toBe(1);
    expect(text(f)).toBeNull();
    vi.advanceTimersByTime(STILL_LOADING_MS);
    f.detectChanges();
    expect(text(f)).not.toBeNull();
  });

  it('never fires after it is destroyed (the data arrived)', () => {
    const f = render();
    f.destroy();
    expect(() => vi.advanceTimersByTime(STILL_LOADING_MS * 2)).not.toThrow();
  });
});
