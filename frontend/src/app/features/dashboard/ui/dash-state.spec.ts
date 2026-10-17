import { ChangeDetectionStrategy, Component, Injector, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ErrorReferenceStore } from '../../../core/http/error-reference-store';
import { DashState, DashStateVariant, focusAfterRetry } from './dash-state';

@Component({
  imports: [DashState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-dash-state
      [variant]="variant()"
      message="The thing could not be loaded."
      updated="10:42 AM"
      (retry)="retries = retries + 1"
      (clear)="clears = clears + 1"
    />
    <button id="after">after</button>
  `,
})
class Host {
  readonly variant = signal<DashStateVariant>('error');
  retries = 0;
  clears = 0;
  readonly injector = inject(Injector);
}

async function render(variant: DashStateVariant, reference?: string) {
  TestBed.configureTestingModule({});
  if (reference) TestBed.inject(ErrorReferenceStore).reference.set(reference);
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.variant.set(variant);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('mf-dash-state', () => {
  it('error: one role=alert with the message, a text Retry that emits', async () => {
    const { fixture, el } = await render('error');
    const block = el.querySelector('[data-dash-state="error"]')!;
    expect(block.getAttribute('role')).toBe('alert');
    expect(el.querySelectorAll('[role="alert"]').length).toBe(1);
    expect(block.textContent).toContain('The thing could not be loaded.');
    const retry = el.querySelector<HTMLButtonElement>('[data-dash-retry]')!;
    expect(retry.textContent!.trim()).toBe('Retry');
    retry.click();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it('error: shows the error reference when the API sent one', async () => {
    const { el } = await render('error', 'trace-42');
    expect(el.querySelector('[data-error-reference]')?.textContent).toContain('trace-42');
  });

  it('stale: a status with the time of the figures on screen and a text Retry', async () => {
    const { el } = await render('stale');
    const block = el.querySelector('[data-dash-state="stale"]')!;
    expect(block.getAttribute('role')).toBe('status');
    expect(block.textContent).toContain('Could not refresh.');
    expect(block.textContent).toContain('Showing data from 10:42 AM.');
    expect(el.querySelector('[data-dash-retry]')?.textContent!.trim()).toBe('Retry');
    expect(el.querySelectorAll('[role="alert"]').length).toBe(0);
  });

  it('empty-filtered: Clear filters emits; empty shows the tab message', async () => {
    const { fixture, el } = await render('empty-filtered');
    expect(el.querySelector('[data-dash-state="empty"]')!.textContent).toContain(
      'Nothing matches these filters',
    );
    el.querySelector<HTMLButtonElement>('[data-dash-clear]')!.click();
    expect(fixture.componentInstance.clears).toBe(1);
    fixture.componentInstance.variant.set('empty');
    fixture.detectChanges();
    expect(el.querySelector('[data-dash-state="empty"]')!.textContent).toContain(
      'The thing could not be loaded.',
    );
    expect(el.querySelector('[data-dash-clear]')).toBeNull();
  });

  it("empty-filtered can say the tab's own sentence, and empty can offer one action that widens the view", () => {
    const filtered = TestBed.createComponent(DashState);
    filtered.componentRef.setInput('variant', 'empty-filtered');
    filtered.componentRef.setInput('filteredText', 'No unassigned tasks match these filters.');
    filtered.detectChanges();
    expect((filtered.nativeElement as HTMLElement).textContent).toContain(
      'No unassigned tasks match these filters.',
    );
    const empty = TestBed.createComponent(DashState);
    empty.componentRef.setInput('variant', 'empty');
    empty.componentRef.setInput('message', 'Nothing is unassigned in My pods.');
    empty.detectChanges();
    const el = empty.nativeElement as HTMLElement;
    expect(el.querySelector('[data-dash-action]')).toBeNull();
    empty.componentRef.setInput('actionLabel', 'Show all pods');
    empty.detectChanges();
    let actions = 0;
    empty.componentInstance.action.subscribe(() => actions++);
    el.querySelector<HTMLButtonElement>('[data-dash-action]')!.click();
    expect(actions).toBe(1);
    expect(el.querySelector('[data-dash-action]')!.textContent!.trim()).toBe('Show all pods');
  });

  it('focusAfterRetry: Retry after a failure, the first control of the content after success', async () => {
    const { fixture, el } = await render('error');
    focusAfterRetry(el, fixture.componentInstance.injector, 'failed');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(el.querySelector('[data-dash-retry]'));
  });

  it('focusAfterRetry: after success the focus goes past the state block to the content', async () => {
    const { fixture, el } = await render('error');
    document.body.appendChild(el);
    fixture.componentInstance.variant.set('empty');
    fixture.detectChanges();
    focusAfterRetry(el, fixture.componentInstance.injector, 'ready');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement?.id).toBe('after');
    el.remove();
  });
});
