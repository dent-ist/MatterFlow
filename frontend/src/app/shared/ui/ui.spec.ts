import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CopyButton } from './copy-button';
import { MatterRef } from './matter-ref';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatterRef],
  template: `<mf-matter-ref [value]="{ clientNumber: '343', matterNumber: '12' }" />`,
})
class Host {}

describe('mf-matter-ref and mf-copy-button', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('renders the padded reference in monospace and copies it', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.mf-ref')?.textContent).toBe('00343-00012');

    (el.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith('00343-00012');
    expect(el.querySelector('[role=status]')?.textContent).toBe('Copied');
  });

  it('links to the Matter with the themed link colour and can hide the copy button', async () => {
    const fixture = TestBed.createComponent(MatterRef);
    fixture.componentRef.setInput('value', '343-12');
    fixture.componentRef.setInput('link', ['/matters', 5]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector('a.mf-ref') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/matters/5');
    expect(link.textContent).toBe('00343-00012');
    expect(el.querySelector('mf-copy-button')).not.toBeNull();

    fixture.componentRef.setInput('copy', false);
    await fixture.whenStable();
    expect(el.querySelector('mf-copy-button')).toBeNull();
  });

  it('has an accessible name and stays unchanged if the clipboard is blocked', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const fixture = TestBed.createComponent(CopyButton);
    fixture.componentRef.setInput('text', 'KE\\kekim');
    fixture.componentRef.setInput('label', 'Windows account name');
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Copy Windows account name');
    button.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=status]').textContent).toBe('');
  });
});
