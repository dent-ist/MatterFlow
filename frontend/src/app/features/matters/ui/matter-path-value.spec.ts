import { TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MatterPathValue } from './matter-path-value';
import { settle } from '../../../shared/testing/org-testing';

@Component({
  imports: [MatterPathValue],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-matter-path-value label="DMS Path" [value]="value()" />`,
})
class Host {
  readonly value = signal<string | undefined>(undefined);
}

describe('MatterPathValue (UI spec 2.3, 2.4)', () => {
  async function show(value: string | undefined) {
    const f = TestBed.createComponent(Host);
    f.componentInstance.value.set(value);
    await settle(f);
    return f.nativeElement as HTMLElement;
  }

  it('shows a web address as a link that opens in a new tab, with a Copy button named for the field', async () => {
    const el = await show('https://dfs.example.com/matters/1234/0056');
    const link = el.querySelector<HTMLAnchorElement>('[data-path-link]')!;
    expect(link.getAttribute('href')).toBe('https://dfs.example.com/matters/1234/0056');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.textContent).toContain('(opens in a new tab)');
    expect(el.querySelector('.pi-external-link')).not.toBeNull();
    const copy = el.querySelector<HTMLButtonElement>('button.mf-copy')!;
    expect(copy.getAttribute('aria-label')).toBe('Copy DMS Path');
    expect(copy.textContent!.trim()).toBe('Copy');
  });

  it('shows a UNC path as plain text, not a link, and copies the exact stored text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const el = await show('\\\\fs01\\dms\\Matters\\1234');
    expect(el.querySelector('a')).toBeNull();
    expect(el.querySelector('[data-path-unc]')!.textContent).toBe('\\\\fs01\\dms\\Matters\\1234');
    el.querySelector<HTMLButtonElement>('button.mf-copy')!.click();
    expect(writeText).toHaveBeenCalledWith('\\\\fs01\\dms\\Matters\\1234');
  });

  it('says "Not set" without a Copy button when there is no value', async () => {
    const el = await show(undefined);
    expect(el.querySelector('[data-path-none]')!.textContent).toBe('Not set');
    expect(el.querySelector('button')).toBeNull();
  });
});
