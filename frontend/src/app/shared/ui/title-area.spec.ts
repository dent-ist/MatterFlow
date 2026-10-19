import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { COUNTER_ANNOUNCE_FROM, TitleArea, stripLineBreaks } from './title-area';

@Component({
  imports: [TitleArea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-title-area
    inputId="t"
    label="Title"
    [required]="true"
    [error]="error()"
    [(value)]="value"
  />`,
})
class Host {
  readonly value = signal('');
  readonly error = signal<string | null>(null);
}

async function mount() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host: fixture.componentInstance,
    area: () => el.querySelector('textarea') as HTMLTextAreaElement,
    count: () => el.querySelector('[data-title-count]')!.textContent!.trim(),
    live: () => el.querySelector('[data-title-count-live]')!.textContent!.trim(),
    type: async (text: string) => {
      const t = el.querySelector('textarea') as HTMLTextAreaElement;
      t.value = text;
      t.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      fixture.detectChanges();
    },
  };
}

describe('TitleArea', () => {
  it('is a 2 row textarea with the label, the required marker and a visible n / 200 counter', async () => {
    const m = await mount();
    expect(m.area().tagName).toBe('TEXTAREA');
    expect(m.area().rows).toBe(2);
    expect(m.area().getAttribute('maxlength')).toBe('200');
    expect(m.area().labels?.[0]?.textContent).toContain('Title');
    expect(m.area().labels?.[0]?.textContent).toContain('(required)');
    expect(m.count()).toBe('0 / 200');
    await m.type('Hello');
    expect(m.host.value()).toBe('Hello');
    expect(m.count()).toBe('5 / 200');
  });

  it('strips line breaks from typed and pasted text, and Enter does nothing', async () => {
    const m = await mount();
    await m.type('first line\r\n  second\nthird');
    expect(m.host.value()).toBe('first line second third');
    expect(m.area().value).toBe('first line second third');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    m.area().dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  });

  it('announces the count politely only from 180 characters and on an error', async () => {
    const m = await mount();
    await m.type('x'.repeat(COUNTER_ANNOUNCE_FROM - 1));
    expect(m.live()).toBe('');
    await m.type('x'.repeat(COUNTER_ANNOUNCE_FROM));
    expect(m.live()).toBe('180 of 200 characters');
    expect(
      m.fixture.nativeElement.querySelector('[data-title-count-live]').getAttribute('aria-live'),
    ).toBe('polite');
    await m.type('');
    expect(m.live()).toBe('');
    m.host.error.set('Enter a title.');
    m.fixture.detectChanges();
    await m.fixture.whenStable();
    m.fixture.detectChanges();
    expect(m.live()).toBe('0 of 200 characters');
  });

  it('links the textarea to its error and counter and marks it invalid', async () => {
    const m = await mount();
    m.host.error.set('Enter a title.');
    m.fixture.detectChanges();
    await m.fixture.whenStable();
    m.fixture.detectChanges();
    expect(m.area().getAttribute('aria-invalid')).toBe('true');
    expect(m.area().getAttribute('aria-describedby')).toBe('t-error t-count');
    expect(m.fixture.nativeElement.querySelector('#t-error').textContent).toContain(
      'Enter a title.',
    );
  });
});

describe('stripLineBreaks', () => {
  it('turns every run of line breaks and the spaces around it into one space', () => {
    expect(stripLineBreaks('a\n\n b\r\nc')).toBe('a b c');
    expect(stripLineBreaks('no breaks')).toBe('no breaks');
  });
});
