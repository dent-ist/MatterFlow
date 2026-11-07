import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MmNoMatters } from './no-matters';

describe('My Matters, no matter managed (issue #976)', () => {
  it('shows the shared empty block with the list sentence and one link to Matters, no error and no grid', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(MmNoMatters);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const block = el.querySelector('[data-state-block]');
    expect(block?.getAttribute('data-state-block')).toBe('empty');
    expect(block?.getAttribute('role')).toBeNull();
    expect(el.querySelector('.sb__text')?.textContent?.trim()).toBe(
      'You do not manage any matter yet.',
    );
    const link = el.querySelector<HTMLAnchorElement>('[data-go-matters]');
    expect(link?.textContent?.trim()).toBe('Go to Matters');
    expect(link?.getAttribute('href')).toBe('/matters');
    expect(el.querySelector('table, [role="grid"], [data-page-error]')).toBeNull();
  });
});
