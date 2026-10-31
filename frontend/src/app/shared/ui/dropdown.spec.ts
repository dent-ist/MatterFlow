import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dropdown, DropdownItem } from './dropdown';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dropdown],
  template: `
    <mf-dropdown
      id="d1"
      label="Show"
      prefix="Show:"
      [items]="items"
      [(value)]="value"
      [countOnButton]="true"
      neutralValue="all"
    />
    <mf-dropdown
      id="d2"
      label="Shows"
      [items]="items"
      [multi]="true"
      [(values)]="values"
      placeholder="Nothing"
    />
    <mf-dropdown
      id="d3"
      label="Client"
      [items]="many"
      [(value)]="big"
      [search]="true"
      [limit]="3"
    />
  `,
})
class Host {
  readonly items: DropdownItem[] = [
    { value: 'all', label: 'Everything', count: 10 },
    { value: 'over', label: 'Overdue', count: 3 },
    { value: 'risk', label: 'At risk', count: 0 },
  ];
  readonly many: DropdownItem[] = Array.from({ length: 8 }, (_, i) => ({
    value: `c${i}`,
    label: `Client ${i}`,
  }));
  readonly value = signal('all');
  readonly values = signal<readonly string[]>([]);
  readonly big = signal('');
}

describe('Dropdown (UI-19)', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const flush = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      await Promise.resolve();
      fixture.detectChanges();
    };
    const btn = (id: string) =>
      fixture.nativeElement.querySelector(`#${id} button`) as HTMLButtonElement;
    const panel = () => document.body.querySelector('.dd-panel') as HTMLElement | null;
    const opts = () =>
      Array.from(document.body.querySelectorAll<HTMLElement>('.dd-panel li[role=option]'));
    const key = async (k: string, el?: HTMLElement) => {
      (el ?? (document.activeElement as HTMLElement)).dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
      await flush();
    };
    return { fixture, host: fixture.componentInstance, btn, panel, opts, key, flush };
  }
  afterEach(() => document.body.querySelectorAll('.dd-panel').forEach((e) => e.remove()));

  it('the button names the chosen row with its count and the list is a listbox with a check mark on the chosen row', async () => {
    const { btn, panel, opts, flush } = await setup();
    expect(btn('d1').textContent).toContain('Show:');
    expect(btn('d1').textContent).toContain('Everything');
    expect(btn('d1').textContent).toContain('(10)');
    expect(btn('d1').getAttribute('aria-haspopup')).toBe('listbox');
    btn('d1').click();
    await flush();
    expect(panel()!.querySelector('[role=listbox]')).not.toBeNull();
    expect(btn('d1').getAttribute('aria-expanded')).toBe('true');
    expect(opts().map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(opts()[0].querySelector('.tick .pi-check')).not.toBeNull();
    expect(opts()[1].querySelector('.n')!.textContent).toBe('3');
    expect(opts()[2].querySelector('.n')!.textContent).toBe('0');
  });

  it('keys: Down opens it, arrows, Home and End move, Enter chooses and focus returns to the button', async () => {
    const { host, btn, opts, key, flush } = await setup();
    btn('d1').focus();
    await key('ArrowDown', btn('d1'));
    expect(opts().length).toBe(3);
    await key('ArrowDown');
    expect(document.activeElement).toBe(opts()[1]);
    await key('End');
    expect(document.activeElement).toBe(opts()[2]);
    await key('Home');
    expect(document.activeElement).toBe(opts()[0]);
    await key('ArrowDown');
    await key('Enter');
    await flush();
    expect(host.value()).toBe('over');
    expect(document.body.querySelector('.dd-panel')).toBeNull();
    expect(document.activeElement).toBe(btn('d1'));
  });

  it('type-ahead jumps to the next label that starts with the letters, Escape closes and returns focus', async () => {
    const { btn, opts, key, flush, panel } = await setup();
    btn('d1').click();
    await flush();
    opts()[0].focus();
    await key('a');
    expect(document.activeElement).toBe(opts()[2]); // At risk
    await key('Escape');
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(btn('d1'));
  });

  it('a multi dropdown keeps the list open while you tick, says how many, and Done closes it', async () => {
    const { host, btn, opts, flush, panel } = await setup();
    btn('d2').click();
    await flush();
    expect(
      panel()!.getAttribute('aria-multiselectable') ??
        panel()!.querySelector('[role=listbox]')!.getAttribute('aria-multiselectable'),
    ).toBe('true');
    opts()[0].click();
    opts()[1].click();
    await flush();
    expect(host.values()).toEqual(['all', 'over']);
    expect(panel()).not.toBeNull();
    expect(btn('d2').textContent).toContain('+1');
    (document.body.querySelector('[data-dd-done]') as HTMLElement).click();
    await flush();
    expect(panel()).toBeNull();
  });

  it('a long list has a search box, narrows as you type, and cuts at the limit with "keep typing"', async () => {
    const { btn, opts, flush, panel } = await setup();
    btn('d3').click();
    await flush();
    expect(opts().length).toBe(3);
    expect(panel()!.textContent).toContain('5 more - keep typing to narrow');
    const input = panel()!.querySelector('input')!;
    input.value = 'client 7';
    input.dispatchEvent(new Event('input'));
    await flush();
    expect(opts().map((o) => o.textContent!.trim())).toEqual(['Client 7']);
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await flush();
    expect(panel()!.textContent).toContain('No match');
  });
});
