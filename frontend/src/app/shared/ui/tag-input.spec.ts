import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TagInput, hasControlCharacters, normalizeTagText } from './tag-input';

@Component({
  imports: [TagInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-tag-input
      inputId="t"
      label="Tags"
      help="Help text"
      [suggestions]="suggestions()"
      (queryChange)="queries.push($event)"
      [(value)]="tags"
    />
  `,
})
class Host {
  readonly tags = signal<string[]>([]);
  readonly suggestions = signal<string[]>([]);
  readonly queries: string[] = [];
}

async function setup(initial: string[] = [], suggestions: string[] = []) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.tags.set(initial);
  fixture.componentInstance.suggestions.set(suggestions);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const input = el.querySelector<HTMLInputElement>('#t')!;
  const flush = async () => {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const type = async (text: string) => {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await flush();
  };
  const key = async (name: string) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    await flush();
    return event;
  };
  const chips = () =>
    Array.from(el.querySelectorAll('.ti__chip')).map((c) =>
      c.querySelector('.ti__text')!.textContent!.trim(),
    );
  return { fixture, host: fixture.componentInstance, el, input, type, key, chips, flush };
}

describe('mf-tag-input', () => {
  it('turns typed text into a chip on Enter and on comma, trimming and collapsing whitespace', async () => {
    const { host, type, key, chips, input } = await setup();
    await type('  Relativity ');
    const enter = await key('Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(chips()).toEqual(['Relativity']);
    expect(input.value).toBe('');

    await type('Data   load');
    const comma = await key(',');
    expect(comma.defaultPrevented).toBe(true);
    expect(host.tags()).toEqual(['Relativity', 'Data load']);
  });

  it('splits pasted text with commas into several tags and keeps the unfinished part', async () => {
    const { host, type, input } = await setup();
    await type('a, b ,c,d');
    expect(host.tags()).toEqual(['a', 'b', 'c']);
    expect(input.value).toBe('d');
  });

  it('removes the last chip with Backspace on an empty box, but not while text is typed', async () => {
    const { host, type, key } = await setup(['One', 'Two']);
    await type('x');
    await key('Backspace');
    expect(host.tags()).toEqual(['One', 'Two']);
    await type('');
    const event = await key('Backspace');
    expect(event.defaultPrevented).toBe(true);
    expect(host.tags()).toEqual(['One']);
  });

  it('gives every chip a text label and a "Remove tag X" button that removes it', async () => {
    const { host, el, chips, fixture } = await setup(['Relativity', 'QC']);
    expect(chips()).toEqual(['Relativity', 'QC']);
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.ti__remove'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove tag Relativity',
      'Remove tag QC',
    ]);
    buttons[0].click();
    await fixture.whenStable();
    expect(host.tags()).toEqual(['QC']);
  });

  it('announces added and removed tags in a polite live region', async () => {
    const { el, type, key, flush } = await setup();
    const live = el.querySelector('[data-tag-announce]')!;
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    await type('Relativity');
    await key('Enter');
    await flush();
    expect(live.textContent).toContain('Added tag Relativity. 1 tag.');
    el.querySelector<HTMLButtonElement>('.ti__remove')!.click();
    await flush();
    expect(live.textContent).toContain('Removed tag Relativity. No tags.');
  });

  it('never adds the same tag twice, ignoring case, and says so', async () => {
    const { host, el, type, key, flush } = await setup(['Relativity']);
    await type('relativity');
    await key('Enter');
    await flush();
    expect(host.tags()).toEqual(['Relativity']);
    expect(el.querySelector('[data-tag-announce]')!.textContent).toContain('already added');
  });

  it('refuses a tag over 40 characters, a 21st tag and control characters with a message, keeping the text', async () => {
    const { host, el, type, key, input } = await setup();
    await type('x'.repeat(41));
    await key('Enter');
    expect(host.tags()).toEqual([]);
    expect(el.querySelector('.ti__error')?.textContent).toContain('at most 40 characters');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.value).toHaveLength(41);

    await type('x'.repeat(40));
    await key('Enter');
    expect(host.tags()).toEqual(['x'.repeat(40)]);
    expect(el.querySelector('.ti__error')).toBeNull();

    await type('bad\u0007tag');
    await key('Enter');
    expect(el.querySelector('.ti__error')?.textContent).toContain('control characters');
    expect(host.tags()).toHaveLength(1);
  });

  it('stops at 20 tags', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const { host, el, type, key } = await setup(twenty);
    await type('one more');
    await key('Enter');
    expect(host.tags()).toEqual(twenty);
    expect(el.querySelector('.ti__error')?.textContent).toContain('at most 20 tags');
  });

  it('commits the text that was typed when the box loses focus, so Save does not drop it', async () => {
    const { host, type, input, flush } = await setup();
    await type('Pending');
    input.dispatchEvent(new Event('blur'));
    await flush();
    expect(host.tags()).toEqual(['Pending']);
  });

  it('is a combobox with a listbox of suggestions it navigates with the arrow keys, using the suggestion spelling', async () => {
    const { host, el, type, key, input, flush } = await setup(
      ['QC'],
      ['Relativity', 'Review', 'QC'],
    );
    await type('re');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const options = Array.from(el.querySelectorAll('[role="option"]')).map((o) =>
      o.textContent!.trim(),
    );
    expect(options).toEqual(['Relativity', 'Review']); // QC is already chosen
    expect(el.querySelector('[data-tag-suggestions]')!.textContent).toContain(
      '2 suggestions available',
    );

    await key('ArrowDown');
    await key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('t-opt-1');
    await key('Enter');
    await flush();
    expect(host.tags()).toEqual(['QC', 'Review']);

    await type('RELATIVITY');
    await key('Enter');
    expect(host.tags()).toEqual(['QC', 'Review', 'Relativity']);
  });

  it('closes the suggestions with Escape and asks the page for suggestions as the text changes', async () => {
    const { host, type, key, input } = await setup([], ['Relativity']);
    await type('rel');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const esc = await key('Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(host.queries).toContain('rel');
  });

  it('labels the input and describes it with the help text', async () => {
    const { el, input } = await setup();
    expect(el.querySelector('label[for="t"]')?.textContent).toContain('Tags');
    expect(input.getAttribute('aria-describedby')).toContain('t-help');
    expect(el.querySelector('#t-help')?.textContent).toContain('Help text');
  });
});

describe('tag text helpers', () => {
  it('normalises whitespace and detects control characters', () => {
    expect(normalizeTagText('  a \t b\n c ')).toBe('a b c');
    expect(hasControlCharacters('a\u0000b')).toBe(true);
    expect(hasControlCharacters('a​b')).toBe(true);
    expect(hasControlCharacters('Über-QC 2')).toBe(false);
  });
});
