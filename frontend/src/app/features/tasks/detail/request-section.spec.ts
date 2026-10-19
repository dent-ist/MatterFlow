import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { settle } from '../../../shared/testing/org-testing';
import { RequestSection, requestHeadingText } from './request-section';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RequestSection],
  template: `
    <mf-request-section heading="Request details (X, form 1)" [count]="n()" [(open)]="open"
      ><input id="inside"
    /></mf-request-section>
  `,
})
class Host {
  readonly n = signal(14);
  readonly open = signal(false);
}

describe('RequestSection', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('is a heading button with aria-expanded and aria-controls, a count, and a body that is hidden, not removed', async () => {
    const f = TestBed.createComponent(Host);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    const button = el.querySelector<HTMLButtonElement>('h3 > button')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toContain('14 fields');
    const body = el.querySelector<HTMLElement>('[data-request-body]')!;
    expect(button.getAttribute('aria-controls')).toBe(body.id);
    expect(body.hidden).toBe(true);
    expect(el.querySelector('#inside')).not.toBeNull();

    button.focus();
    button.click();
    await settle(f);
    expect(f.componentInstance.open()).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('says one field in the singular', async () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.n.set(1);
    await settle(f);
    expect((f.nativeElement as HTMLElement).querySelector('h3 button')!.textContent).toContain(
      '1 field',
    );
    expect((f.nativeElement as HTMLElement).querySelector('h3 button')!.textContent).not.toContain(
      '1 fields',
    );
  });
});

describe('requestHeadingText', () => {
  it('names the task type and the form', () => {
    expect(requestHeadingText({ taskType: { name: 'Search and Culling' }, formVersionNo: 1 })).toBe(
      'Request details (Search and Culling, form 1)',
    );
    expect(requestHeadingText({ taskType: { name: 'Search and Culling' } })).toBe(
      'Request details (Search and Culling)',
    );
  });
});
