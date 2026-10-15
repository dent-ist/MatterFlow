import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TagChips } from './tag-chips';
import { TagFilter, TagMatch, TagOption } from './tag-filter';

@Component({
  imports: [TagFilter, TagChips],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-tag-filter
      idPrefix="f"
      [options]="options"
      [selected]="selected()"
      [match]="match()"
      (selectedChange)="selected.set($event)"
      (matchChange)="match.set($event)"
    />
    <mf-tag-chips [tags]="chipTags" [max]="2" />
  `,
})
class Host {
  readonly options: TagOption[] = [
    { name: 'Relativity', count: 3 },
    { name: 'Processing', count: 2 },
    { name: 'QC', count: 1 },
  ];
  readonly selected = signal<string[]>([]);
  readonly match = signal<TagMatch>('all');
  readonly chipTags = ['One', 'Two', 'Three', 'Four'];
}

async function setup() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const flush = async () => {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, host: fixture.componentInstance, el, flush };
}

describe('mf-tag-filter', () => {
  it('opens a panel of labelled checkboxes with step counts', async () => {
    const { el, flush } = await setup();
    const button = el.querySelector<HTMLButtonElement>('#f-button')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    await flush();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe('f-panel');
    const options = Array.from(el.querySelectorAll('.tf__option')).map((o) =>
      o.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(options).toEqual(['Relativity (3)', 'Processing (2)', 'QC (1)']);
  });

  it('selects several tags as removable chips and reports each change', async () => {
    const { host, el, flush } = await setup();
    el.querySelector<HTMLButtonElement>('#f-button')!.click();
    await flush();
    el.querySelector<HTMLInputElement>('[data-tag-option="Relativity"]')!.click();
    await flush();
    el.querySelector<HTMLInputElement>('[data-tag-option="QC"]')!.click();
    await flush();
    expect(host.selected()).toEqual(['Relativity', 'QC']);
    const remove = Array.from(el.querySelectorAll<HTMLButtonElement>('.tf__chip-remove'));
    expect(remove.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove tag filter Relativity',
      'Remove tag filter QC',
    ]);
    expect(el.querySelector('[data-tag-filter-count]')?.textContent).toBe('2');
    remove[0].click();
    await flush();
    expect(host.selected()).toEqual(['QC']);
  });

  it('has a Match all / Match any choice that defaults to all', async () => {
    const { host, el, flush } = await setup();
    const radios = Array.from(el.querySelectorAll<HTMLInputElement>('.tf__radio input'));
    expect(radios.map((r) => r.parentElement!.textContent!.trim())).toEqual([
      'Match all',
      'Match any',
    ]);
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    expect(el.querySelector('legend')?.textContent).toContain('Tag matching');
    radios[1].click();
    await flush();
    expect(host.match()).toBe('any');
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
  });

  it('closes on Escape and returns focus to the button', async () => {
    const { el, flush } = await setup();
    const button = el.querySelector<HTMLButtonElement>('#f-button')!;
    button.click();
    await flush();
    el.querySelector('.tf__panel')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await flush();
    expect(el.querySelector('.tf__panel')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('shows read-only chips with +n more and spells the rest out for screen readers', async () => {
    const { el } = await setup();
    const chips = el.querySelector('[data-tags]')!;
    expect(chips.getAttribute('aria-label')).toBe('Tags');
    expect(
      Array.from(chips.querySelectorAll('[data-tag]')).map((c) => c.textContent!.trim()),
    ).toEqual(['One', 'Two']);
    expect(chips.querySelector('[data-tags-more]')!.textContent).toContain('+2 more');
    expect(chips.querySelector('[data-tags-more]')!.textContent).toContain(
      'and 2 more: Three, Four',
    );
  });
});
