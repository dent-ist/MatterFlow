import { ChangeDetectionStrategy, Component, Injector, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Badge } from '../../shared/ui/badge';
import {
  expectStatusFocus,
  focusListAfterAction,
  focusStatusAfterAction,
  restoreStatusFocus,
} from './after-action';

@Component({
  selector: 'mf-test-record',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1 data-page-title>Billing <mf-badge data-title-badge>Active</mf-badge></h1>
      <div data-record-badges><mf-badge data-state-badge>Published v2</mf-badge></div>
      <button type="button" aria-label="Actions for Billing">...</button>
    </main>
  `,
})
class RecordHost {
  readonly injector = inject(Injector);
  readonly loaded = signal<number | false>(false);
  constructor() {
    restoreStatusFocus(() => this.loaded());
  }
}

describe('focus after an action (TY-K, #414)', () => {
  let fixture: ComponentFixture<RecordHost>;
  const find = (selector: string): HTMLElement =>
    fixture.nativeElement.querySelector(selector) as HTMLElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
  };

  beforeEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    fixture = TestBed.createComponent(RecordHost);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.nativeElement.remove();
    document.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
  });

  it('puts focus on the status badge of the title, made focusable on the way', async () => {
    focusStatusAfterAction(fixture.componentInstance.injector);
    await settle();
    expect(document.activeElement).toBe(find('[data-title-badge]'));
    expect(find('[data-title-badge]').getAttribute('tabindex')).toBe('-1');
  });

  it('prefers the badge the caller names (the Published badge after a version was retired)', async () => {
    focusStatusAfterAction(fixture.componentInstance.injector, '[data-state-badge]');
    await settle();
    expect(document.activeElement).toBe(find('[data-state-badge]'));
  });

  it('waits until the closing dialog has left the page', async () => {
    const mask = document.createElement('div');
    mask.className = 'p-dialog-mask';
    document.body.appendChild(mask);
    focusStatusAfterAction(fixture.componentInstance.injector);
    await settle();
    expect(document.activeElement).not.toBe(find('[data-title-badge]'));
    mask.remove();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.activeElement).toBe(find('[data-title-badge]'));
  });

  it('a list goes back to the row menu that was used, or to the heading when the row has left', async () => {
    focusListAfterAction(fixture.componentInstance.injector, 'Actions for Billing');
    await settle();
    expect(document.activeElement).toBe(find('button[aria-label="Actions for Billing"]'));
    focusListAfterAction(fixture.componentInstance.injector, 'Actions for Gone');
    await settle();
    expect(document.activeElement).toBe(find('[data-page-title]'));
  });

  it('a page opened by an action takes the request once, when it has loaded', async () => {
    expectStatusFocus('[data-state-badge]');
    fixture.componentInstance.loaded.set(7);
    await settle();
    expect(document.activeElement).toBe(find('[data-state-badge]'));
    // Not again for the same page, and a later page without a request gets nothing.
    find('button').focus();
    fixture.componentInstance.loaded.set(8);
    await settle();
    expect(document.activeElement).toBe(find('button'));
  });

  it('ignores a request that is older than ten seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      expectStatusFocus();
      vi.setSystemTime(Date.now() + 11_000);
      fixture.componentInstance.loaded.set(1);
      await settle();
      expect(document.activeElement).not.toBe(find('[data-title-badge]'));
    } finally {
      vi.useRealTimers();
    }
  });
});
